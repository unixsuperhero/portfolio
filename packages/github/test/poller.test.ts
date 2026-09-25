import { describe, expect, test } from "bun:test";
import type { Pr } from "@portfolio/core";
import { openStore } from "@portfolio/db";
import { createPrPoller } from "../src/poller.ts";
import listsFixture from "./fixtures/lists-response.json";
import watchedFixture from "./fixtures/watched-response.json";

function fakeGh(responses: unknown[]) {
  const calls: string[] = [];
  return { graphql: async (query: string) => { calls.push(query); return responses[calls.length - 1]; }, calls };
}

const seedWatched = (store: ReturnType<typeof openStore>, overrides: Partial<Pr> = {}): number =>
  store.github.upsertPr({
    url: "https://github.com/acme/app/pull/40", owner: "acme", repo: "app", number: 40, title: "Refactor storage",
    author: "jearsh", is_draft: false, state: "open", review_decision: null, updated_at: "2026-09-22T10:00:00Z",
    comments: 1, checks: [], checks_summary: "none", watched: true, ignored_checks: [], lists: [], item_id: null, source_dir: null,
    fetched_at: "2026-09-22T10:00:00Z", ...overrides,
  });

describe("createPrPoller.tick", () => {
  test("2 requests when a watched PR is outside the search lists", async () => {
    const store = openStore(":memory:");
    seedWatched(store);
    const gh = fakeGh([listsFixture, watchedFixture]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(gh.calls).toHaveLength(2);
    const prs = store.github.listPrs();
    expect(prs.map(p => p.number).sort()).toEqual([12, 20, 40]);
    const watched = prs.find(p => p.number === 40)!;
    expect(watched.state).toBe("merged"); // watched-batch fixture reports it merged
    const status = poller.status();
    expect(status.rate).toEqual({ remaining: 4998, reset_at: "2026-09-22T15:00:00Z" });
    expect(status.error).toBeNull();
  });

  /** Tick once to seed every PR, then store each as closed so the next tick's open state would raise an event for any visible one. */
  async function seedThenChange(store: ReturnType<typeof openStore>) {
    const calls: string[] = [];
    const gh = { calls, graphql: async (query: string) => { calls.push(query); return query.includes("search(") ? listsFixture : watchedFixture; } };
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });
    await poller.tick();
    for (const pr of store.github.listPrs()) store.github.upsertPr({ ...pr, state: "closed" });
    return { gh, poller };
  }

  test("a PR ignored by its own flag raises no events and, if watched, is not re-polled", async () => {
    const store = openStore(":memory:");
    const hiddenWatched = seedWatched(store, { url: "https://github.com/acme/app/pull/41", number: 41 });
    store.github.setIgnored(hiddenWatched, true);
    const { gh, poller } = await seedThenChange(store);
    const [ignored, visible] = store.github.listPrs({ list: "mine" }).concat(store.github.listPrs({ list: "review_requested" }));
    store.github.setIgnored(ignored.id, true);

    await poller.tick();

    const events = store.github.listUnseenEvents();
    expect(events.some(event => event.pr_id === visible.id)).toBe(true);
    expect(events.filter(event => event.pr_id === ignored.id || event.pr_id === hiddenWatched)).toEqual([]);
    expect(gh.calls.some(call => call.includes("pullRequest(number: 41)"))).toBe(false);
  });

  test("an ignored repo silences events for every PR in it", async () => {
    const store = openStore(":memory:");
    const { poller } = await seedThenChange(store);
    store.settings.setGithubIgnoredRepos(["acme/*"]);

    await poller.tick();

    expect(store.github.listPrs({ hidden: false })).toEqual([]);
    expect(store.github.listUnseenEvents()).toEqual([]);
    expect(store.github.listPrs({ hidden: true }).length).toBeGreaterThan(0); // still stored, so un-ignoring restores them
  });

  test("a lists query GitHub times out on is retried one list at a time", async () => {
    const store = openStore(":memory:");
    const calls: string[] = [];
    const gh = {
      graphql: async (query: string) => {
        calls.push(query);
        if (calls.length === 1) throw new Error("gh: HTTP 504");
        if (query.includes("mine: search")) return { viewer: listsFixture.viewer, mine: listsFixture.mine, rateLimit: listsFixture.rateLimit };
        return { viewer: listsFixture.viewer, review_requested: listsFixture.review_requested, rateLimit: listsFixture.rateLimit };
      },
    };
    const logged: string[] = [];
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z"), log: m => logged.push(m) });

    await poller.tick();

    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain("first: 20");
    expect(calls[1]).not.toContain("review_requested");
    expect(calls[2]).toContain("review_requested: search");
    expect(store.github.listPrs()).toHaveLength(2);
    expect(poller.status().error).toBeNull();
    expect(logged[0]).toContain("HTTP 504");
  });

  test("a per-list retry that still times out shrinks the page, then reports which list gave up", async () => {
    const store = openStore(":memory:");
    const calls: string[] = [];
    const gh = {
      graphql: async (query: string) => {
        calls.push(query);
        if (query.includes("review_requested: search") && query.includes("first: 5)")) {
          return { viewer: listsFixture.viewer, review_requested: listsFixture.review_requested, rateLimit: listsFixture.rateLimit };
        }
        if (query.includes("mine: search") && !query.includes("review_requested")) return { viewer: listsFixture.viewer, mine: listsFixture.mine, rateLimit: listsFixture.rateLimit };
        throw new Error("gh: HTTP 502");
      },
    };
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    // combined, mine@20, review_requested@20, @10, @5
    expect(calls).toHaveLength(5);
    expect(calls[3]).toContain("first: 10");
    expect(calls[4]).toContain("first: 5");
    expect(store.github.listPrs()).toHaveLength(2);
    expect(poller.status().error).toBeNull();
  });

  test("a list that times out at every page size fails the directory with the list named", async () => {
    const store = openStore(":memory:");
    const calls: string[] = [];
    const gh = { graphql: async (query: string) => { calls.push(query); throw new Error("gh: HTTP 502"); } };
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(calls).toHaveLength(4); // combined, then mine at 20, 10, 5
    expect(poller.status().error).toContain("mine list still times out at 5 per page: gh: HTTP 502");
  });

  test("a non-timeout failure on the lists query is not retried", async () => {
    const store = openStore(":memory:");
    const calls: string[] = [];
    const gh = { graphql: async (query: string) => { calls.push(query); throw new Error("gh: Not Found (HTTP 404)"); } };
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(calls).toHaveLength(1);
    expect(poller.status().error).toContain("HTTP 404");
  });

  test("1 request when nothing watched falls outside the lists", async () => {
    const store = openStore(":memory:");
    const gh = fakeGh([listsFixture]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(gh.calls).toHaveLength(1);
    expect(store.github.listPrs()).toHaveLength(2);
  });

  test("removes stale team-only review memberships after a complete direct-review search", async () => {
    const store = openStore(":memory:");
    const staleId = seedWatched(store, {
      url: "https://github.com/acme/app/pull/99",
      number: 99,
      watched: false,
      lists: ["review_requested"],
    });
    const gh = fakeGh([listsFixture]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(store.github.getPr(staleId)?.lists).toEqual([]);
    expect(store.github.listPrs({ list: "review_requested" }).map(pr => pr.number)).toEqual([20]);
  });

  test("excludes team-only requests even when GitHub search returns them", async () => {
    const store = openStore(":memory:");
    const teamOnly = structuredClone(listsFixture);
    Object.assign(teamOnly.review_requested.nodes[0], {
      reviewRequests: { nodes: [{ requestedReviewer: { __typename: "Team", slug: "platform" } }] },
    });
    const poller = createPrPoller({ db: store, gh: fakeGh([teamOnly]), now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(store.github.listPrs({ list: "review_requested" })).toEqual([]);
  });

  test("1 request when the only watched PR is already inside the lists", async () => {
    const store = openStore(":memory:");
    const id = seedWatched(store, { url: "https://github.com/acme/app/pull/12", number: 12 });
    const gh = fakeGh([listsFixture]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(gh.calls).toHaveLength(1);
    expect(store.github.getPr(id)?.watched).toBe(true);
  });

  test("a second tick with a state change inserts an event", async () => {
    const store = openStore(":memory:");
    const gh = fakeGh([listsFixture]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });
    await poller.tick();

    const merged = structuredClone(listsFixture) as typeof listsFixture;
    merged.mine.nodes[0].state = "MERGED";
    merged.mine.nodes[0].merged = true;
    const gh2 = fakeGh([merged]);
    const poller2 = createPrPoller({ db: store, gh: gh2, now: () => new Date("2026-09-22T14:07:00Z") });
    await poller2.tick();

    const events = store.github.listUnseenEvents();
    expect(events.some(e => e.kind === "state" && e.message.includes("merged"))).toBe(true);
  });

  test("rateLimit.remaining below 200 skips the watched request", async () => {
    const store = openStore(":memory:");
    seedWatched(store);
    const low = structuredClone(listsFixture) as typeof listsFixture;
    low.rateLimit = { remaining: 150, resetAt: "2026-09-22T16:00:00Z" };
    const gh = fakeGh([low]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(gh.calls).toHaveLength(1);
    expect(poller.status().rate?.remaining).toBe(150);
  });
});

describe("createPrPoller.refresh", () => {
  test("throws a 429-style error when called again within 30s", async () => {
    const store = openStore(":memory:");
    const gh = fakeGh([listsFixture, listsFixture]);
    let nowMs = new Date("2026-09-22T14:05:00Z").getTime();
    const poller = createPrPoller({ db: store, gh, now: () => new Date(nowMs) });

    await poller.refresh();
    await expect(poller.refresh()).rejects.toMatchObject({ status: 429 });

    nowMs += 31_000;
    await expect(poller.refresh()).resolves.toBeTruthy();
  });
});

describe("createPrPoller with settings.github_dirs", () => {
  function fakeGhDirs(responses: unknown[]) {
    const calls: { query: string; cwd: string | undefined }[] = [];
    return {
      graphql: async (query: string, options?: { cwd?: string }) => {
        calls.push({ query, cwd: options?.cwd });
        const response = responses[calls.length - 1];
        if (response instanceof Error) throw response;
        return response;
      },
      calls,
    };
  }
  const withDirs = (dirs: string[]) => { const store = openStore(":memory:"); store.settings.setGithubDirs(dirs); return store; };
  const renamed = (suffix: string) => {
    const copy = structuredClone(listsFixture) as typeof listsFixture;
    for (const node of [...copy.mine.nodes, ...copy.review_requested.nodes]) node.url = `${node.url}${suffix}`;
    return copy;
  };

  test("the lists request runs once per directory, in order, and each PR remembers the directory that returned it", async () => {
    const store = withDirs(["/dir/a", "/dir/b"]);
    const gh = fakeGhDirs([listsFixture, renamed("0")]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(gh.calls.map(call => call.cwd)).toEqual(["/dir/a", "/dir/b"]);
    const prs = store.github.listPrs();
    expect(prs).toHaveLength(4);
    expect(store.github.listPrs({ dir: "/dir/a" }).map(pr => pr.number).sort()).toEqual([12, 20]);
    expect(store.github.listPrs({ dir: "/dir/b" }).map(pr => pr.number).sort()).toEqual([12, 20]);
    expect(poller.status().error).toBeNull();
  });

  test("a PR returned by two directories belongs to the first", async () => {
    const store = withDirs(["/dir/a", "/dir/b"]);
    const gh = fakeGhDirs([listsFixture, listsFixture]);
    await createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") }).tick();

    expect(store.github.listPrs().map(pr => pr.source_dir)).toEqual(["/dir/a", "/dir/a"]);
  });

  test("no directories configured polls once with no cwd and source_dir null", async () => {
    const store = openStore(":memory:");
    const gh = fakeGhDirs([listsFixture]);
    await createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") }).tick();

    expect(gh.calls.map(call => call.cwd)).toEqual([undefined]);
    expect(store.github.listPrs().every(pr => pr.source_dir === null)).toBe(true);
  });

  test("one failing directory is reported in status.error while the others still land", async () => {
    const store = withDirs(["/dir/a", "/dir/b"]);
    const gh = fakeGhDirs([new Error("gh: not a git repository"), listsFixture]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(store.github.listPrs()).toHaveLength(2);
    expect(poller.status().last_poll_at).toBe("2026-09-22T14:05:00.000Z");
    expect(poller.status().error).toBe("/dir/a: gh: not a git repository");
  });

  test("every directory failing counts as a failed tick", async () => {
    const store = withDirs(["/dir/a", "/dir/b"]);
    const gh = fakeGhDirs([new Error("down"), new Error("down too")]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(poller.status().last_poll_at).toBeNull();
    expect(poller.status().error).toBe("/dir/a: down; /dir/b: down too");
  });

  test("watched PRs outside the lists are batched by their own directory", async () => {
    const store = withDirs(["/dir/a", "/dir/b"]);
    seedWatched(store, { source_dir: "/dir/b" });
    const gh = fakeGhDirs([listsFixture, renamed("0"), watchedFixture]);
    await createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") }).tick();

    expect(gh.calls).toHaveLength(3);
    expect(gh.calls[2].cwd).toBe("/dir/b");
    expect(gh.calls[2].query).toContain("pullRequest(number: 40)");
    expect(store.github.findPrByUrl("https://github.com/acme/app/pull/40")?.source_dir).toBe("/dir/b");
  });

  test("fetchOne tries each directory until one returns the PR", async () => {
    const store = withDirs(["/dir/a", "/dir/b"]);
    const gh = fakeGhDirs([{ pr0: { pullRequest: null }, rateLimit: { remaining: 10, resetAt: "t" } }, watchedFixture]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    const pr = await poller.fetchOne({ owner: "acme", repo: "app", number: 40 });

    expect(gh.calls.map(call => call.cwd)).toEqual(["/dir/a", "/dir/b"]);
    expect(pr.source_dir).toBe("/dir/b");
  });
});
