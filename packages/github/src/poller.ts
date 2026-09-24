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
    getGithubDirs(): string[];
  };
}

export interface GhClient {
  /** `options.cwd` is the settings.github_dirs entry to run gh from; omitted for the API's own cwd. */
  graphql(query: string, options?: { cwd?: string }): Promise<unknown>;
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

/** One cycle's request(s), the diff, and the schedule around it. Never more than 2 GraphQL requests per directory per tick. */
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
    inflight: null as Promise<void> | null,
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

  /** settings.github_dirs, or [null] for the API's own cwd, so every tick has at least one target. */
  function targetDirs(): (string | null)[] {
    const dirs = db.settings.getGithubDirs();
    return dirs.length ? dirs : [null];
  }

  const ghOptions = (dir: string | null) => (dir === null ? undefined : { cwd: dir });

  async function processNode(node: PrNode, lists: string[], globalIgnored: string[], fetchedAt: string, events: PrEventDraft[], dir: string | null): Promise<void> {
    const previous = db.github.findPrByUrl(node.url);
    const parsed = finalize(parsePrNode(node, { ignored_checks: previous?.ignored_checks ?? [], watched: previous?.watched ?? false, item_id: previous?.item_id ?? null, lists, source_dir: dir }, fetchedAt), globalIgnored);
    const id = db.github.upsertPr(parsed);
    const next: Pr = { ...parsed, id };
    events.push(...diffPr(previous, next, globalIgnored, fetchedAt));
  }

  async function tick(): Promise<void> {
    if (state.inflight) return state.inflight;
    state.inflight = runTick().finally(() => { state.inflight = null; });
    return state.inflight;
  }

  async function runTick(): Promise<void> {
    const nowMs = now().getTime();
    if (state.skipUntil > nowMs) {
      state.nextPollAt = new Date(state.skipUntil).toISOString();
      return;
    }
    try {
      const fetchedAt = now().toISOString();
      const globalIgnored = db.settings.getGithubIgnoredChecks();
      const events: PrEventDraft[] = [];
      const seenUrls = new Set<string>();

      // The lists request runs once per directory. A directory that fails is reported and
      // skipped; the tick only counts as failed (and backs off) when every directory fails.
      const dirs = targetDirs();
      const failures: string[] = [];
      let rate: ListsResponse["rateLimit"] | null = null;
      const lowestRate = (next: ListsResponse["rateLimit"]) => { if (!rate || next.remaining < rate.remaining) rate = next; };
      for (const dir of dirs) {
        let listsData: ListsResponse;
        try {
          listsData = (await gh.graphql(listsQuery(), ghOptions(dir))) as ListsResponse;
        } catch (err) {
          failures.push(`${dir ?? "default dir"}: ${(err as Error).message}`);
          continue;
        }
        const byUrl = new Map<string, { node: PrNode; lists: string[] }>();
        for (const node of listsData.mine.nodes) byUrl.set(node.url, { node, lists: [...(byUrl.get(node.url)?.lists ?? []), "mine"] });
        for (const node of listsData.review_requested.nodes) byUrl.set(node.url, { node, lists: [...(byUrl.get(node.url)?.lists ?? []), "review_requested"] });
        for (const { node, lists } of byUrl.values()) {
          if (seenUrls.has(node.url)) continue; // first directory to return a PR owns it
          seenUrls.add(node.url);
          await processNode(node, lists, globalIgnored, fetchedAt, events, dir);
        }
        lowestRate(listsData.rateLimit);
      }
      if (!rate || failures.length === dirs.length) throw new Error(failures.join("; "));

      if ((rate as ListsResponse["rateLimit"]).remaining >= RATE_LIMIT_FLOOR) {
        // Watched PRs outside the lists, batched by the directory they were fetched from.
        const watched = db.github.listPrs({ watched: true }).filter(pr => !seenUrls.has(pr.url));
        const groups = new Map<string | null, Pr[]>();
        for (const pr of watched) groups.set(pr.source_dir, [...(groups.get(pr.source_dir) ?? []), pr]);
        for (const [dir, prs] of groups) {
          const batch = prs.slice(0, 25);
          const watchedData = (await gh.graphql(watchedQuery(batch.map(refPr)), ghOptions(dir))) as WatchedResponse;
          for (const node of watchedNodes(watchedData)) await processNode(node, [], globalIgnored, fetchedAt, events, dir);
          lowestRate(watchedData.rateLimit);
        }
      } else {
        state.skipUntil = new Date((rate as ListsResponse["rateLimit"]).resetAt).getTime();
      }

      db.github.insertEvents(events);

      const finalRate = rate as ListsResponse["rateLimit"];
      state.lastPollAt = fetchedAt;
      state.rate = { remaining: finalRate.remaining, reset_at: finalRate.resetAt };
      state.error = failures.length ? failures.join("; ") : null;
      state.backoffMs = BASE_BACKOFF_MS;
      if (finalRate.remaining < RATE_LIMIT_FLOOR) state.skipUntil = new Date(finalRate.resetAt).getTime();
      state.nextPollAt = new Date(now().getTime() + cadenceMs()).toISOString();
    } catch (err) {
      state.error = (err as Error).message;
      state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
      state.nextPollAt = new Date(now().getTime() + state.backoffMs).toISOString();
      log(`poll error: ${state.error}`);
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
      // A poll already in flight is awaited rather than skipped, so the caller
      // always gets fresh data; the schedule then restarts from now.
      await tick();
      if (state.timer) scheduleNext();
      return this.status();
    },
    /** Fetches and stores exactly one PR (one GraphQL request per directory until one returns it),
     * e.g. when watching a URL not already tracked. The directory that finds it becomes its source_dir. */
    async fetchOne(ref: PrRef): Promise<Pr> {
      const fetchedAt = now().toISOString();
      const globalIgnored = db.settings.getGithubIgnoredChecks();
      let node: PrNode | undefined;
      let foundIn: string | null = null;
      const failures: string[] = [];
      for (const dir of targetDirs()) {
        let data: WatchedResponse;
        try {
          data = (await gh.graphql(watchedQuery([ref]), ghOptions(dir))) as WatchedResponse;
        } catch (err) {
          failures.push(`${dir ?? "default dir"}: ${(err as Error).message}`);
          continue;
        }
        if (data.rateLimit) state.rate = { remaining: data.rateLimit.remaining, reset_at: data.rateLimit.resetAt };
        [node] = watchedNodes(data);
        if (node) { foundIn = dir; break; }
      }
      if (!node) throw new Error(failures.length ? failures.join("; ") : "PR not found");
      const previous = db.github.findPrByUrl(node.url);
      const parsed = finalize(parsePrNode(node, { ignored_checks: previous?.ignored_checks ?? [], watched: previous?.watched ?? false, item_id: previous?.item_id ?? null, lists: previous?.lists ?? [], source_dir: previous?.source_dir ?? foundIn }, fetchedAt), globalIgnored);
      const id = db.github.upsertPr(parsed);
      const next: Pr = { ...parsed, id };
      db.github.insertEvents(diffPr(previous, next, globalIgnored, fetchedAt));
      return next;
    },
  };
}

export type PrPoller = ReturnType<typeof createPrPoller>;
