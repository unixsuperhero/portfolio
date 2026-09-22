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
    comments: 1, checks: [], checks_summary: "none", watched: true, ignored_checks: [], lists: [], item_id: null,
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

  test("1 request when nothing watched falls outside the lists", async () => {
    const store = openStore(":memory:");
    const gh = fakeGh([listsFixture]);
    const poller = createPrPoller({ db: store, gh, now: () => new Date("2026-09-22T14:05:00Z") });

    await poller.tick();

    expect(gh.calls).toHaveLength(1);
    expect(store.github.listPrs()).toHaveLength(2);
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
