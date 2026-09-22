import { describe, expect, test } from "bun:test";
import { parsePrNode, watchedNodes } from "../src/parse.ts";
import type { ListsResponse, WatchedResponse } from "../src/parse.ts";
import listsFixture from "./fixtures/lists-response.json";
import watchedFixture from "./fixtures/watched-response.json";

describe("parsePrNode", () => {
  test("maps a search-list PR node into the contract's Pr shape", () => {
    const node = (listsFixture as ListsResponse).mine.nodes[0];
    const pr = parsePrNode(node, {}, "2026-09-22T14:02:00Z");

    expect(pr).toMatchObject({
      url: "https://github.com/acme/app/pull/12",
      owner: "acme",
      repo: "app",
      number: 12,
      title: "Add widgets",
      author: "jearsh",
      is_draft: false,
      state: "open",
      review_decision: "review_required",
      comments: 3, // 2 issue comments + 1 review
      watched: false,
      ignored_checks: [],
      lists: [],
      item_id: null,
      fetched_at: "2026-09-22T14:02:00Z",
    });
    expect(pr.checks).toEqual([
      { name: "ci/test", status: "failure", url: "https://ci/1", ignored: false },
      { name: "ci/lint", status: "success", url: "https://ci/2", ignored: false },
      { name: "codecov/patch", status: "pending", url: "https://ci/3", ignored: false },
      { name: "vercel/deploy", status: "success", url: "https://vercel/1", ignored: false },
    ]);
  });

  test("state comes from merged, not just the state enum", () => {
    const node = (watchedFixture as unknown as { pr0: { pullRequest: ListsResponse["mine"]["nodes"][0] } }).pr0.pullRequest;
    const pr = parsePrNode(node);
    expect(pr.state).toBe("merged");
    expect(pr.review_decision).toBe("approved");
  });

  test("marks checks ignored per the PR's own ignored_checks", () => {
    const node = (listsFixture as ListsResponse).mine.nodes[0];
    const pr = parsePrNode(node, { ignored_checks: ["codecov/*"] });
    expect(pr.checks.find(c => c.name === "codecov/patch")?.ignored).toBe(true);
    expect(pr.checks.find(c => c.name === "ci/test")?.ignored).toBe(false);
  });

  test("no state, no review request, no comments falls back to empty/defaults", () => {
    const node = (listsFixture as ListsResponse).review_requested.nodes[0];
    const pr = parsePrNode(node);
    expect(pr.review_decision).toBeNull();
    expect(pr.comments).toBe(0);
    expect(pr.checks).toEqual([]);
  });
});

describe("watchedNodes", () => {
  test("collects every non-null pullRequest alias, ignoring rateLimit", () => {
    const nodes = watchedNodes(watchedFixture as unknown as WatchedResponse);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].url).toBe("https://github.com/acme/app/pull/40");
  });

  test("skips a null pullRequest (e.g. a PR deleted upstream)", () => {
    const response = { pr0: { pullRequest: null }, rateLimit: { remaining: 1, resetAt: "x" } };
    expect(watchedNodes(response)).toEqual([]);
  });
});
