import type { Pr, PrStatus } from "@portfolio/core";
import type { PrEventDraft } from "@portfolio/db";
import { applyIgnored, checksSummary, diffPr } from "./diff.ts";
import { parsePrNode, watchedNodes } from "./parse.ts";
import type { ListsResponse, PrNode, WatchedResponse } from "./parse.ts";
import { listsQuery, watchedQuery } from "./query.ts";
import type { PrRef } from "./query.ts";

/** The subset of @portfolio/db's Store this poller needs. Duck-typed so tests can pass a fake. */
export interface PollerDb {
  github: {
    findPrByUrl(url: string): Pr | null;
    upsertPr(input: Omit<Pr, "id">): number;
    listPrs(filter?: { watched?: boolean }): Pr[];
    insertEvents(events: PrEventDraft[]): void;
  };
  settings: {
    getGithubIgnoredChecks(): string[];
    getGithubPollMinutes(): number;
  };
}

export interface GhClient {
  graphql(query: string): Promise<unknown>;
}

export interface PollerOptions {
  db: PollerDb;
  gh: GhClient;
  now?: () => Date;
  log?: (message: string) => void;
  login?: string | null;
  ghOk?: boolean;
}

const RATE_LIMIT_FLOOR = 200;
const NO_WATCHED_MINUTES = 10;
const REFRESH_MIN_GAP_MS = 30_000;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export class PollTooSoonError extends Error {
  status = 429;
  constructor(retryInMs: number) {
    super(`refresh again in ${Math.ceil(retryInMs / 1000)}s`);
  }
}

/** One cycle's request(s), the diff, and the schedule around it. Never more than 2 GraphQL requests per tick. */
export function createPrPoller(options: PollerOptions) {
  const { db, gh } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});

  const state = {
    lastPollAt: null as string | null,
    nextPollAt: null as string | null,
    rate: null as { remaining: number; reset_at: string } | null,
    error: null as string | null,
    login: options.login ?? null,
    ghOk: options.ghOk ?? true,
    backoffMs: BASE_BACKOFF_MS,
    skipUntil: 0,
    lastRefreshAt: 0,
    ticking: false,
    timer: null as ReturnType<typeof setTimeout> | null,
  };

  function refPr(pr: Pr): PrRef {
    return { owner: pr.owner, repo: pr.repo, number: pr.number };
  }

  function finalize(parsed: Omit<Pr, "id">, globalIgnored: string[]): Omit<Pr, "id"> {
    const patterns = [...globalIgnored, ...parsed.ignored_checks];
    const checks = applyIgnored(parsed.checks, patterns);
    return { ...parsed, checks, checks_summary: checksSummary(checks, patterns) };
  }

  async function processNode(node: PrNode, lists: string[], globalIgnored: string[], fetchedAt: string, events: PrEventDraft[]): Promise<void> {
    const previous = db.github.findPrByUrl(node.url);
    const parsed = finalize(parsePrNode(node, { ignored_checks: previous?.ignored_checks ?? [], watched: previous?.watched ?? false, item_id: previous?.item_id ?? null, lists }, fetchedAt), globalIgnored);
    const id = db.github.upsertPr(parsed);
    const next: Pr = { ...parsed, id };
    events.push(...diffPr(previous, next, globalIgnored, fetchedAt));
  }

  async function tick(): Promise<void> {
    if (state.ticking) return;
    const nowMs = now().getTime();
    if (state.skipUntil > nowMs) {
      state.nextPollAt = new Date(state.skipUntil).toISOString();
      return;
    }
    state.ticking = true;
    try {
      const fetchedAt = now().toISOString();
      const globalIgnored = db.settings.getGithubIgnoredChecks();
      const events: PrEventDraft[] = [];
      const seenUrls = new Set<string>();

      const listsData = (await gh.graphql(listsQuery())) as ListsResponse;
      for (const node of listsData.mine.nodes) { seenUrls.add(node.url); }
      for (const node of listsData.review_requested.nodes) { seenUrls.add(node.url); }
      const byUrl = new Map<string, { node: PrNode; lists: string[] }>();
      for (const node of listsData.mine.nodes) byUrl.set(node.url, { node, lists: [...(byUrl.get(node.url)?.lists ?? []), "mine"] });
      for (const node of listsData.review_requested.nodes) byUrl.set(node.url, { node, lists: [...(byUrl.get(node.url)?.lists ?? []), "review_requested"] });
      for (const { node, lists } of byUrl.values()) await processNode(node, lists, globalIgnored, fetchedAt, events);

      let rate = listsData.rateLimit;

      if (rate.remaining >= RATE_LIMIT_FLOOR) {
        const watched = db.github.listPrs({ watched: true }).filter(pr => !seenUrls.has(pr.url)).slice(0, 25);
        if (watched.length) {
          const watchedData = (await gh.graphql(watchedQuery(watched.map(refPr)))) as WatchedResponse;
          for (const node of watchedNodes(watchedData)) await processNode(node, [], globalIgnored, fetchedAt, events);
          rate = watchedData.rateLimit;
        }
      } else {
        state.skipUntil = new Date(rate.resetAt).getTime();
      }

      db.github.insertEvents(events);

      state.lastPollAt = fetchedAt;
      state.rate = { remaining: rate.remaining, reset_at: rate.resetAt };
      state.error = null;
      state.backoffMs = BASE_BACKOFF_MS;
      if (rate.remaining < RATE_LIMIT_FLOOR) state.skipUntil = new Date(rate.resetAt).getTime();
      state.nextPollAt = new Date(now().getTime() + cadenceMs()).toISOString();
    } catch (err) {
      state.error = (err as Error).message;
      state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
      state.nextPollAt = new Date(now().getTime() + state.backoffMs).toISOString();
      log(`poll error: ${state.error}`);
    } finally {
      state.ticking = false;
    }
  }

  function cadenceMs(): number {
    const hasWatched = db.github.listPrs({ watched: true }).length > 0;
    const minutes = hasWatched ? db.settings.getGithubPollMinutes() : NO_WATCHED_MINUTES;
    return minutes * 60_000;
  }

  function scheduleNext(): void {
    if (state.timer) clearTimeout(state.timer);
    const delay = state.error ? state.backoffMs : cadenceMs();
    state.timer = setTimeout(async () => { await tick(); scheduleNext(); }, delay);
  }

  return {
    async tick() { await tick(); },
    start(): void {
      if (state.timer) return;
      void tick().then(scheduleNext);
    },
    stop(): void {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
    },
    status(): PrStatus {
      return {
        last_poll_at: state.lastPollAt,
        next_poll_at: state.nextPollAt,
        rate: state.rate,
        polling: state.timer !== null,
        error: state.error,
        gh_ok: state.ghOk,
        login: state.login,
      };
    },
    async refresh(): Promise<PrStatus> {
      const nowMs = now().getTime();
      if (nowMs - state.lastRefreshAt < REFRESH_MIN_GAP_MS) throw new PollTooSoonError(REFRESH_MIN_GAP_MS - (nowMs - state.lastRefreshAt));
      state.lastRefreshAt = nowMs;
      await tick();
      return this.status();
    },
  };
}

export type PrPoller = ReturnType<typeof createPrPoller>;
