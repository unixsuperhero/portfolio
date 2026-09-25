import { describe, expect, test } from "bun:test";
import { openStore } from "@portfolio/db";
import type { PrStatus } from "@portfolio/core";
import { createApi } from "../src/index.ts";
import type { ApiOptions } from "../src/context.ts";

const get = (api: (r: Request) => Promise<Response>, path: string) => api(new Request(`http://x${path}`));
const send = (api: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown) =>
  api(new Request(`http://x${path}`, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }));

const idleStatus: PrStatus = { last_poll_at: null, next_poll_at: "soon", rate: { remaining: 4999, reset_at: "t" }, polling: true, error: null, gh_ok: true, login: "jearsh" };

function fakePoller(store: ReturnType<typeof openStore>) {
  let refreshCalls = 0;
  return {
    calls: { refresh: () => refreshCalls, fetchOne: 0 },
    status: () => idleStatus,
    async refresh() {
      refreshCalls++;
      if (refreshCalls === 2) { const err = new Error("refresh again in 30s"); (err as Error & { status: number }).status = 429; throw err; }
    },
    async fetchOne(ref: { owner: string; repo: string; number: number }) {
      const url = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
      const id = store.github.upsertPr({
        url, owner: ref.owner, repo: ref.repo, number: ref.number, title: "Fetched PR", author: "jearsh",
        is_draft: false, state: "open", review_decision: null, updated_at: "t", comments: 0, checks: [],
        checks_summary: "none", watched: false, ignored_checks: [], lists: [], item_id: null, source_dir: null, fetched_at: "t",
      });
      return store.github.getPr(id)!;
    },
  } as unknown as ApiOptions["prPoller"];
}

describe("prs", () => {
  test("GET /api/prs with no poller: empty lists, idle status", async () => {
    const store = openStore(":memory:");
    const api = createApi(store, {});
    const res = await get(api, "/api/prs");
    expect(await res.json()).toEqual({ mine: [], review_requested: [], watched: [], ignored: [], status: { last_poll_at: null, next_poll_at: null, rate: null, polling: false, error: null, gh_ok: false, login: null } });
  });

  test("GET /api/prs with a poller reflects the store and poller status", async () => {
    const store = openStore(":memory:");
    store.github.upsertPr({ url: "https://github.com/acme/app/pull/1", owner: "acme", repo: "app", number: 1, title: "A", author: "x", is_draft: false, state: "open", review_decision: null, updated_at: "t", comments: 0, checks: [], checks_summary: "none", watched: false, ignored_checks: [], lists: ["mine"], item_id: null, source_dir: null, fetched_at: "t" });
    const api = createApi(store, { prPoller: fakePoller(store) });
    const res = await get(api, "/api/prs");
    const body = await res.json();
    expect(body.mine).toHaveLength(1);
    expect(body.status).toEqual(idleStatus);
  });

  test("POST /api/prs/refresh returns 429 the second time within the window", async () => {
    const store = openStore(":memory:");
    const api = createApi(store, { prPoller: fakePoller(store) });
    expect((await send(api, "POST", "/api/prs/refresh")).status).toBe(200);
    const res = await send(api, "POST", "/api/prs/refresh");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("refresh") });
  });

  test("POST /api/prs/watch: 422 on a non-PR url", async () => {
    const store = openStore(":memory:");
    const api = createApi(store, { prPoller: fakePoller(store) });
    const res = await send(api, "POST", "/api/prs/watch", { url: "https://github.com/acme/app", watched: true });
    expect(res.status).toBe(422);
  });

  test("POST /api/prs/watch: fetches an unknown PR once and watches it", async () => {
    const store = openStore(":memory:");
    const api = createApi(store, { prPoller: fakePoller(store) });
    const res = await send(api, "POST", "/api/prs/watch", { url: "https://github.com/acme/app/pull/7", watched: true });
    expect(res.status).toBe(200);
    const pr = await res.json();
    expect(pr).toMatchObject({ owner: "acme", repo: "app", number: 7, watched: true });
    expect(pr.item_id).not.toBeNull();
  });

  test("POST /api/prs/watch: unwatching an already-known PR doesn't refetch", async () => {
    const store = openStore(":memory:");
    const id = store.github.upsertPr({ url: "https://github.com/acme/app/pull/9", owner: "acme", repo: "app", number: 9, title: "B", author: "x", is_draft: false, state: "open", review_decision: null, updated_at: "t", comments: 0, checks: [], checks_summary: "none", watched: true, ignored_checks: [], lists: [], item_id: null, source_dir: null, fetched_at: "t" });
    const api = createApi(store, { prPoller: fakePoller(store) });
    const res = await send(api, "POST", "/api/prs/watch", { url: "https://github.com/acme/app/pull/9", watched: false });
    expect(res.status).toBe(200);
    expect((await res.json()).watched).toBe(false);
    expect(store.github.getPr(id)?.watched).toBe(false);
  });

  test("PATCH settings applies repository check rules to existing PRs", async () => {
    const store = openStore(":memory:");
    const id = store.github.upsertPr({ url: "https://github.com/acme/app/pull/3", owner: "acme", repo: "app", number: 3, title: "C", author: "x", is_draft: false, state: "open", review_decision: null, updated_at: "t", comments: 0, checks: [{ name: "codecov/patch", status: "failure", url: "", ignored: false }], checks_summary: "failure", watched: false, ignored_checks: [], lists: ["mine"], item_id: null, source_dir: null, fetched_at: "t" });
    const api = createApi(store, { prPoller: fakePoller(store) });
    const rules = [{ repo: "acme/app", check: "codecov/patch" }];
    const res = await send(api, "PATCH", "/api/settings", { github_ignored_check_rules: rules });
    expect(res.status).toBe(200);
    expect((await res.json()).github_ignored_check_rules).toEqual(rules);
    const pr = store.github.getPr(id)!;
    expect(pr.checks[0].ignored).toBe(true);
    expect(pr.checks_summary).toBe("none");
  });

  test("PATCH /api/prs/:id { ignored } moves a PR between the lists and the ignored list", async () => {
    const store = openStore(":memory:");
    const poller = fakePoller(store);
    const api = createApi(store, { prPoller: poller });
    const pr = await poller!.fetchOne({ owner: "acme", repo: "app", number: 12 });
    store.github.setWatched(pr.id, true);

    let res = await send(api, "PATCH", `/api/prs/${pr.id}`, { ignored: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: pr.id, ignored: true, watched: true });
    let view = await (await get(api, "/api/prs")).json();
    expect(view.watched).toEqual([]);
    expect(view.ignored.map((p: { id: number }) => p.id)).toEqual([pr.id]);

    res = await send(api, "PATCH", `/api/prs/${pr.id}`, { ignored: false });
    expect((await res.json()).ignored).toBe(false);
    view = await (await get(api, "/api/prs")).json();
    expect(view.watched.map((p: { id: number }) => p.id)).toEqual([pr.id]);
    expect(view.ignored).toEqual([]);
  });

  test("settings github_ignored_repos hides a whole repo from the lists; the ignored list still shows its PRs", async () => {
    const store = openStore(":memory:");
    const poller = fakePoller(store);
    const api = createApi(store, { prPoller: poller });
    const app = await poller!.fetchOne({ owner: "acme", repo: "app", number: 1 });
    const other = await poller!.fetchOne({ owner: "acme", repo: "other", number: 2 });
    for (const pr of [app, other]) store.github.setWatched(pr.id, true);

    let res = await send(api, "PATCH", "/api/settings", { github_ignored_repos: ["acme/app"] });
    expect((await res.json()).github_ignored_repos).toEqual(["acme/app"]);
    const view = await (await get(api, "/api/prs")).json();
    expect(view.watched.map((p: { id: number }) => p.id)).toEqual([other.id]);
    expect(view.ignored.map((p: { id: number; ignored: boolean }) => [p.id, p.ignored])).toEqual([[app.id, false]]);

    res = await get(api, "/api/settings");
    expect((await res.json()).github_ignored_repos).toEqual(["acme/app"]);
  });

  test("events: list unseen since an id, then mark seen", async () => {
    const store = openStore(":memory:");
    const id = store.github.upsertPr({ url: "https://github.com/acme/app/pull/4", owner: "acme", repo: "app", number: 4, title: "D", author: "x", is_draft: false, state: "open", review_decision: null, updated_at: "t", comments: 0, checks: [], checks_summary: "none", watched: false, ignored_checks: [], lists: [], item_id: null, source_dir: null, fetched_at: "t" });
    store.github.insertEvents([{ pr_id: id, kind: "state", message: "acme/app#4 merged", at: "t" }]);
    const api = createApi(store, {});
    let res = await get(api, "/api/prs/events");
    const { events } = await res.json();
    expect(events).toHaveLength(1);
    res = await send(api, "POST", "/api/prs/events/seen", { ids: [events[0].id] });
    expect(await res.json()).toEqual({ ok: true });
    res = await get(api, "/api/prs/events");
    expect((await res.json()).events).toHaveLength(0);
  });

  test("settings GET/PATCH exposes repository check rules, PR views, default view, and poll cadence", async () => {
    const store = openStore(":memory:");
    const api = createApi(store, {});
    let res = await get(api, "/api/settings");
    expect(await res.json()).toMatchObject({ github_ignored_check_rules: [], github_pr_views: [], github_pr_default_view: "all", github_poll_minutes: 2 });
    res = await send(api, "PATCH", "/api/settings", {
      github_ignored_check_rules: [{ repo: "acme/app", check: "codecov/*" }],
      github_pr_views: [{ id: "reviews", label: "Reviews", query: "collection=review_requested" }],
      github_pr_default_view: "reviews",
      github_poll_minutes: 5,
    });
    expect(await res.json()).toMatchObject({
      github_ignored_check_rules: [{ repo: "acme/app", check: "codecov/*" }],
      github_pr_views: [{ id: "reviews", label: "Reviews", query: "collection=review_requested" }],
      github_pr_default_view: "reviews",
      github_poll_minutes: 5,
    });
  });
});
