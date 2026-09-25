import { describe, expect, test } from "bun:test";
import { listQuery, listsQuery } from "../src/query.ts";

describe("PR list queries", () => {
  test("requests only direct, open, non-draft reviews", () => {
    const query = listQuery("review_requested", 20);

    expect(query).toContain('search(query: "is:pr is:open -is:draft user-review-requested:@me"');
    expect(query).not.toContain('\"is:pr is:open review-requested:@me\"');
  });

  test("requests result counts so complete lists can be reconciled", () => {
    expect(listsQuery().match(/issueCount/g)).toHaveLength(2);
  });
});
