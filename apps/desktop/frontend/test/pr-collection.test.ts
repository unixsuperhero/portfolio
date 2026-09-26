import { describe, expect, test } from "bun:test";
import type { Pr } from "../src/types";
import { defaultPrDirection, filterPortfolioPrs, ignoredCheckRuleRepos, lifecycle, matchesPr, normalizePrViewQuery, sortPrs } from "../src/lib/pr-collection";

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
  test("ignored-check repository options include repositories with PR checks before any rules exist", () => {
    const acme = pr({ checks: [{ name: "ci/test", status: "failure", url: "", ignored: false }] });
    const beta = pr({ id: 5, owner: "beta", repo: "api", checks: [{ name: "lint", status: "success", url: "", ignored: false }] });
    expect(ignoredCheckRuleRepos([acme, beta, draft], [])).toEqual(["acme/console", "beta/api"]);
    expect(ignoredCheckRuleRepos([acme, beta], [{ repo: "archived/worker", check: "ci/test" }])).toEqual(["acme/console", "archived/worker", "beta/api"]);
  });

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

  test("saved views retain collection filters and sorting but drop transient UI state", () => {
    const query = new URLSearchParams("repo_q=acme&pr12_check_q=lint&filters=1&state=open&collection=watched&sort=updated&direction=desc");
    expect(normalizePrViewQuery(query)).toBe("collection=watched&direction=desc&sort=updated&state=open");
    expect(normalizePrViewQuery("collection=visible&q=fix")).toBe("q=fix");
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
  test("portfolio PR cards reuse every page filter and exclude nonmatching or unlinked records under scope", () => {
    const matching = pr({ id: 10, title: "Same name", item_id: 100, checks: [{ name: "unit", status: "success", url: "https://ci/10", ignored: false }], checks_summary: "success" });
    const outside = pr({ id: 11, title: "Same name", item_id: 101, checks: [{ name: "unit", status: "success", url: "https://ci/11", ignored: false }], checks_summary: "success" });
    const unlinked = pr({ id: 12, title: "Same name", item_id: null, checks: [{ name: "unit", status: "success", url: "https://ci/12", ignored: false }], checks_summary: "success" });
    const wrongReview = pr({ id: 13, title: "Same name", item_id: 100, review_decision: "changes_requested", checks: [{ name: "unit", status: "success", url: "https://ci/13", ignored: false }], checks_summary: "success" });
    const query = "collection=mine&review=approved&check_name=unit&check_status=success&updated_after=2026-09-24T00%3A00&sort=number&direction=asc";
    expect(filterPortfolioPrs([unlinked, outside, wrongReview, matching], new Set(), query, [100]).map(item => item.id)).toEqual([10]);
    expect(filterPortfolioPrs([unlinked, outside, wrongReview, matching], new Set(), query, null).map(item => item.id)).toEqual([10, 11, 12]);
  });
  test("PR sort defaults match the page for chronological and text fields", () => {
    expect(defaultPrDirection("updated")).toBe("desc");
    expect(defaultPrDirection("comments")).toBe("desc");
    expect(defaultPrDirection("repo")).toBe("asc");
  });
});
