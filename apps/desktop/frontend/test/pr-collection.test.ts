import { describe, expect, test } from "bun:test";
import type { Pr } from "../src/types";
import { lifecycle, matchesPr, sortPrs } from "../src/lib/pr-collection";

const pr = (overrides: Partial<Pr> = {}): Pr => ({
  id: 1, number: 10, url: "https://github.com/acme/console/pull/10", owner: "acme", repo: "console", title: "Improve search", author: "alex",
  state: "open", is_draft: false, review_decision: "approved", updated_at: "2026-09-24T12:00:00Z", fetched_at: "2026-09-24T13:00:00Z", comments: 2,
  checks: [], checks_summary: "none", watched: false, ignored: false, ignored_checks: [], lists: ["mine"], source_dir: null, item_id: null, ...overrides,
});
const ready = pr();
const draft = pr({ id: 2, number: 20, title: "Offline workspace", author: "blair", is_draft: true, review_decision: "review_required", comments: 10, source_dir: "/work/console", checks_summary: "pending" });
const merged = pr({ id: 3, number: 30, title: "Ship history", state: "merged", watched: true, lists: ["mine", "watched"], item_id: 7, updated_at: "2026-09-23T12:00:00Z" });
const closedDraft = pr({ id: 4, number: 40, title: "Retired experiment", state: "closed", is_draft: true, review_decision: null, ignored: true, lists: [], comments: 0 });
const records = [ready, draft, merged, closedDraft];
const ids = (query: string, input = records, hiddenIds = new Set([4])) => input.filter(item => matchesPr(item, new URLSearchParams(query), hiddenIds.has(item.id))).map(item => item.id);

describe("PR triage", () => {
  test("terminal lifecycle wins over a retained draft flag", () => {
    expect(records.map(lifecycle)).toEqual(["open", "draft", "merged", "closed"]);
    expect(lifecycle(pr({ state: "merged", is_draft: true }))).toBe("merged");
    expect(ids("collection=all&draft=true")).toEqual([2, 4]);
    expect(ids("state=draft")).toEqual([2]);
    expect(ids("state=open")).toEqual([1]);
    expect(ids("raw_state=open")).toEqual([1, 2]);
  });

  test("metadata, numeric bounds, and timestamps combine instead of replacing one another", () => {
    expect(ids("author=blair&owner=acme&repo=acme%2Fconsole&dir=%2Fwork%2Fconsole&comments_min=10&comments_max=10&updated_after=2026-09-24T12%3A00%3A00Z&fetched_before=2026-09-24T13%3A00%3A00Z")).toEqual([2]);
    expect(ids("comments_min=11")).toEqual([]);
    expect(ids("updated_before=2026-09-23T12%3A00%3A00Z")).toEqual([3]);
    expect(ids("fetched_after=2026-09-24T13%3A00%3A01Z")).toEqual([]);
  });

  test("review and check outcomes remain independent of lifecycle", () => {
    expect(ids("review=approved&checks=none")).toEqual([1, 3]);
    expect(ids("review=review_required&checks=pending")).toEqual([2]);
    expect(ids("collection=all&review=none")).toEqual([4]);
  });

  test("individual check conditions must match the same check, including ignored checks", () => {
    const checked = pr({ checks_summary: "failure", ignored_checks: ["docs*"], checks: [
      { name: "build", status: "success", url: "https://ci.example/build", ignored: false },
      { name: "lint", status: "failure", url: "https://ci.example/lint", ignored: false },
      { name: "docs", status: "skipped", url: "https://ci.example/docs", ignored: true },
    ] });
    expect(ids("check_name=build&check_status=failure", [checked])).toEqual([]);
    expect(ids("check_name=lint&check_status=failure&check_ignored=false", [checked])).toEqual([1]);
    expect(ids("check_url=%2Fdocs&check_status=skipped&check_ignored=true&ignored_pattern=docs&check_count_min=3&ignored_check_count_min=1", [checked])).toEqual([1]);
    expect(ids("check_count_max=0", [checked, draft])).toEqual([2]);
  });

  test("repo-hidden and individually ignored PRs remain discoverable without leaking into visible lists", () => {
    const hidden = new Set([3, 4]);
    expect(ids("", records, hidden)).toEqual([1, 2]);
    expect(ids("collection=ignored", records, hidden)).toEqual([3, 4]);
    expect(ids("collection=ignored&ignored=true", records, hidden)).toEqual([4]);
    expect(ids("collection=all&watched=true", records, hidden)).toEqual([3]);
  });

  test("null source, absent memberships, and linked item IDs can be selected explicitly", () => {
    expect(ids("dir=-&linked=true&item_id=7&membership=watched")).toEqual([3]);
    expect(ids("collection=all&membership=none&linked=false&number=40&id=4")).toEqual([4]);
    expect(ids("collection=watched")).toEqual([3]);
    expect(ids("collection=review_requested")).toEqual([]);
  });

  test("My Reviews combines direct-review membership with open, non-draft lifecycle", () => {
    const directReview = pr({ id: 5, lists: ["review_requested"] });
    const draftReview = pr({ id: 6, lists: ["review_requested"], is_draft: true });
    const closedReview = pr({ id: 7, lists: ["review_requested"], state: "closed" });

    expect(ids("collection=review_requested&state=open", [directReview, draftReview, closedReview])).toEqual([5]);
  });

  test("search covers draft semantics and nested data without indexing property names", () => {
    expect(ids("collection=all&q=draft")).toEqual([2, 4]);
    expect(ids("q=blair")).toEqual([2]);
    const checks = pr({ checks: [{ name: "coverage", status: "cancelled", url: "https://ci.example/unique-run", ignored: true }] });
    expect(ids("q=unique-run", [checks, draft])).toEqual([1]);
    expect(ids("title=offline&url=github.com")).toEqual([2]);
  });

  test("sorting uses numeric values, supports both directions, and keeps deterministic ties", () => {
    expect(sortPrs(records, "comments", "desc").map(item => item.id)).toEqual([2, 1, 3, 4]);
    expect(sortPrs(records, "comments", "asc").map(item => item.id)).toEqual([4, 1, 3, 2]);
    expect(sortPrs(records, "draft", "desc").map(item => item.id)).toEqual([2, 4, 1, 3]);
    expect(sortPrs(records, "item_id", "desc").map(item => item.id)).toEqual([3, 1, 2, 4]);
  });
});
