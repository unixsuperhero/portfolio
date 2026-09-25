import { describe, expect, test } from "bun:test";
import { listQuery, listsQuery } from "../src/query.ts";

describe("PR list queries", () => {
  test("requests open non-draft review candidates with their exact reviewers", () => {
    const query = listQuery("review_requested", 20);

    expect(query).toContain('search(query: "is:pr is:open -is:draft review-requested:@me sort:updated-desc"');
    expect(query).toContain("pageInfo { hasNextPage endCursor }");
    expect(listQuery("review_requested", 50, "cursor-1")).toContain('first: 50, after: "cursor-1"');
    expect(query).toContain("viewer { id }");
    expect(query).toContain("reviewRequests(first: 100)");
    expect(query).toContain("... on User { id }");
  });

  test("requests result counts so complete lists can be reconciled", () => {
    expect(listsQuery().match(/issueCount/g)).toHaveLength(2);
  });
});
