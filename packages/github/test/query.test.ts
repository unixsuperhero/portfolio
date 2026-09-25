import { describe, expect, test } from "bun:test";
import { listQuery, listsQuery } from "../src/query.ts";

describe("PR list queries", () => {
  test("requests open non-draft review candidates with their exact reviewers", () => {
    const query = listQuery("review_requested", 20);

    expect(query).toContain('search(query: "is:pr is:open -is:draft review-requested:@me"');
    expect(query).toContain("viewer { login }");
    expect(query).toContain("reviewRequests(first: 100)");
    expect(query).toContain("... on User { login }");
  });

  test("requests result counts so complete lists can be reconciled", () => {
    expect(listsQuery().match(/issueCount/g)).toHaveLength(2);
  });
});
