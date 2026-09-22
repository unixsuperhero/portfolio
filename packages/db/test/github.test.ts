import { describe, expect, test } from "bun:test";
import type { Pr } from "@portfolio/core";
import { getGithubIgnoredChecks, getGithubPollMinutes, insertEvents, listUnseenEvents, listPrs, markEventsSeen, openDatabase, setGithubIgnoredChecks, setGithubPollMinutes, setIgnoredChecks, setWatched, upsertPr } from "../src/index.ts";

const fresh = () => openDatabase(":memory:");

const newPr = (db: ReturnType<typeof fresh>, overrides: Partial<Omit<Pr, "id">> = {}): number =>
  upsertPr(db, {
    url: "https://github.com/acme/app/pull/12", owner: "acme", repo: "app", number: 12, title: "Add widgets",
    author: "jearsh", is_draft: false, state: "open", review_decision: null, updated_at: "t", comments: 0,
    checks: [{ name: "ci/test", status: "failure", url: "https://ci/1", ignored: false }, { name: "codecov/patch", status: "pending", url: "https://ci/2", ignored: false }],
    checks_summary: "failure", watched: false, ignored_checks: [], lists: ["mine"], item_id: null, fetched_at: "t",
    ...overrides,
  });

describe("github repo", () => {
  test("upsertPr is keyed by url; listPrs filters by list/watched", () => {
    const db = fresh();
    const id = newPr(db);
    expect(newPr(db, { title: "Renamed" })).toBe(id); // same url, same row
    expect(listPrs(db)[0].title).toBe("Renamed");

    const other = newPr(db, { url: "https://github.com/acme/app/pull/20", number: 20, lists: ["review_requested"] });
    expect(listPrs(db, { list: "mine" }).map(p => p.id)).toEqual([id]);
    expect(listPrs(db, { list: "review_requested" }).map(p => p.id)).toEqual([other]);
    expect(listPrs(db, { watched: true })).toEqual([]);
  });

  test("setWatched creates the library pr item once and links it; a second watch reuses it", () => {
    const db = fresh();
    const id = newPr(db);
    let pr = setWatched(db, id, true);
    expect(pr.watched).toBe(true);
    expect(pr.item_id).not.toBeNull();
    const itemId = pr.item_id;

    pr = setWatched(db, id, false);
    expect(pr.watched).toBe(false);
    expect(pr.item_id).toBe(itemId); // item persists in the library

    pr = setWatched(db, id, true);
    expect(pr.item_id).toBe(itemId); // re-linked, not duplicated
  });

  test("setIgnoredChecks recomputes each check's ignored flag", () => {
    const db = fresh();
    const id = newPr(db);
    const pr = setIgnoredChecks(db, id, ["codecov/*"]);
    expect(pr.ignored_checks).toEqual(["codecov/*"]);
    expect(pr.checks.find(c => c.name === "codecov/patch")?.ignored).toBe(true);
    expect(pr.checks.find(c => c.name === "ci/test")?.ignored).toBe(false);
    expect(pr.checks_summary).toBe("failure"); // ci/test still active and failing
  });

  test("events: insert, list unseen since an id, mark seen", () => {
    const db = fresh();
    const id = newPr(db);
    insertEvents(db, [
      { pr_id: id, kind: "state", message: "acme/app#12 merged", at: "t1" },
      { pr_id: id, kind: "checks", message: "acme/app#12 checks failure", at: "t2" },
    ]);
    const events = listUnseenEvents(db);
    expect(events.map(e => e.message)).toEqual(["acme/app#12 merged", "acme/app#12 checks failure"]);
    expect(listUnseenEvents(db, events[0].id).map(e => e.id)).toEqual([events[1].id]);
    markEventsSeen(db, [events[0].id]);
    expect(listUnseenEvents(db).map(e => e.id)).toEqual([events[1].id]);
  });

  test("settings: github_ignored_checks and github_poll_minutes", () => {
    const db = fresh();
    expect(getGithubIgnoredChecks(db)).toEqual([]);
    expect(getGithubPollMinutes(db)).toBe(2);
    setGithubIgnoredChecks(db, ["codecov/*", "vercel/*"]);
    setGithubPollMinutes(db, 5);
    expect(getGithubIgnoredChecks(db)).toEqual(["codecov/*", "vercel/*"]);
    expect(getGithubPollMinutes(db)).toBe(5);
  });
});
