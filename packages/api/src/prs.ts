import type { PrStatus } from "@portfolio/core";
import type { Ctx } from "./context.ts";
import { error, json, notFound, num, readJson } from "./http.ts";

const IDLE_STATUS: PrStatus = { last_poll_at: null, next_poll_at: null, rate: null, polling: false, error: null, gh_ok: false, login: null };

const PULL_URL = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

function prsView(ctx: Ctx) {
  if (!ctx.prPoller) return { mine: [], review_requested: [], watched: [], ignored: [], status: IDLE_STATUS };
  return {
    mine: ctx.store.github.listPrs({ list: "mine", hidden: false }),
    review_requested: ctx.store.github.listPrs({ list: "review_requested", hidden: false }),
    watched: ctx.store.github.listPrs({ watched: true, hidden: false }),
    // Hidden by their own flag (pr.ignored) or by settings.github_ignored_repos, so they can be un-ignored.
    ignored: ctx.store.github.listPrs({ hidden: true }),
    status: ctx.prPoller.status(),
  };
}

export async function listPrsRoute(ctx: Ctx): Promise<Response> {
  return json(prsView(ctx));
}

export async function refreshPrsRoute(ctx: Ctx): Promise<Response> {
  if (!ctx.prPoller) return json(prsView(ctx));
  try {
    await ctx.prPoller.refresh();
  } catch (err) {
    if ((err as { status?: number }).status === 429) return error(429, (err as Error).message);
    throw err;
  }
  return json(prsView(ctx));
}

export async function watchPrRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  const url = String(body.url ?? "");
  const watched = Boolean(body.watched);
  const match = url.match(PULL_URL);
  if (!match) return error(422, "url must look like https://github.com/owner/repo/pull/123");
  const [, owner, repo, numberText] = match;

  let pr = ctx.store.github.findPrByUrl(url);
  if (!pr) {
    if (!ctx.prPoller) return error(503, "GitHub polling is not available");
    try {
      pr = await ctx.prPoller.fetchOne({ owner, repo, number: Number(numberText) });
    } catch (err) {
      return error(404, (err as Error).message);
    }
  }
  if (pr.watched !== watched) pr = ctx.store.github.setWatched(pr.id, watched);
  return json(pr);
}

export async function patchPrRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  if (!ctx.store.github.getPr(id)) return notFound();
  const body = await readJson(request);
  if ("ignored_checks" in body) ctx.store.github.setIgnoredChecks(id, Array.isArray(body.ignored_checks) ? body.ignored_checks.map(String) : []);
  if ("ignored" in body) ctx.store.github.setIgnored(id, Boolean(body.ignored));
  return json(ctx.store.github.getPr(id));
}

export async function listPrEventsRoute(ctx: Ctx, request: Request): Promise<Response> {
  const since = num(new URL(request.url).searchParams.get("since")) ?? 0;
  return json({ events: ctx.store.github.listUnseenEvents(since) });
}

export async function markPrEventsSeenRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  ctx.store.github.markEventsSeen(ids);
  return json({ ok: true });
}
