import { describe, expect, test } from "bun:test";
import type { Pr } from "@portfolio/core";
import { applyIgnored, checksSummary, diffPr, isIgnored } from "../src/diff.ts";

function pr(overrides: Partial<Pr> = {}): Pr {
  return {
    id: 1, url: "https://github.com/acme/app/pull/12", owner: "acme", repo: "app", number: 12,
    title: "Add widgets", author: "jearsh", is_draft: false, state: "open", review_decision: null,
    updated_at: "t", comments: 0, checks: [], checks_summary: "none", watched: true, ignored_checks: [],
    lists: ["mine"], item_id: null, source_dir: null, fetched_at: "t", ignored: false,
    ...overrides,
  };
}

describe("isIgnored / glob matching", () => {
  test("* matches any suffix, case-insensitive", () => {
    expect(isIgnored("codecov/patch", ["codecov/*"])).toBe(true);
    expect(isIgnored("CODECOV/PATCH", ["codecov/*"])).toBe(true);
    expect(isIgnored("ci/test", ["codecov/*"])).toBe(false);
  });

  test("exact match with no glob", () => {
    expect(isIgnored("ci/test", ["ci/test"])).toBe(true);
    expect(isIgnored("ci/testing", ["ci/test"])).toBe(false);
  });
});

describe("checksSummary", () => {
  const checks = [
    { name: "ci/test", status: "failure" as const, url: "", ignored: false },
    { name: "ci/lint", status: "success" as const, url: "", ignored: false },
    { name: "codecov/patch", status: "pending" as const, url: "", ignored: false },
  ];

  test("failure wins over pending and success", () => {
    expect(checksSummary(checks, [])).toBe("failure");
  });

  test("ignoring the failing check surfaces the next worst status", () => {
    expect(checksSummary(checks, ["ci/test"])).toBe("pending");
  });

  test("ignoring everything is none", () => {
    expect(checksSummary(checks, ["*"])).toBe("none");
  });

  test("all success is success", () => {
    expect(checksSummary([{ name: "ci/lint", status: "success", url: "", ignored: false }], [])).toBe("success");
  });

  test("no checks at all is none", () => {
    expect(checksSummary([], [])).toBe("none");
  });

  test("already-ignored checks (per-PR) count the same as a matching global pattern", () => {
    const already = [{ name: "ci/test", status: "failure" as const, url: "", ignored: true }];
    expect(checksSummary(already, [])).toBe("none");
  });
});

describe("applyIgnored", () => {
  test("sets ignored per pattern without mutating the input", () => {
    const checks = [{ name: "codecov/patch", status: "pending" as const, url: "", ignored: false }];
    const out = applyIgnored(checks, ["codecov/*"]);
    expect(out[0].ignored).toBe(true);
    expect(checks[0].ignored).toBe(false);
  });
});

describe("diffPr", () => {
  test("no previous row means no events", () => {
    expect(diffPr(null, pr(), [], "t2")).toEqual([]);
  });

  test("state change", () => {
    const events = diffPr(pr({ state: "open" }), pr({ id: 1, state: "merged" }), [], "t2");
    expect(events).toEqual([{ pr_id: 1, kind: "state", message: "acme/app#12 merged", at: "t2" }]);
  });

  test("review_decision change to a non-null value", () => {
    const events = diffPr(pr({ review_decision: null }), pr({ review_decision: "approved" }), [], "t2");
    expect(events).toContainEqual({ pr_id: 1, kind: "review", message: "acme/app#12 review approved", at: "t2" });
  });

  test("comments increase reports the delta", () => {
    const events = diffPr(pr({ comments: 2 }), pr({ comments: 5 }), [], "t2");
    expect(events).toContainEqual({ pr_id: 1, kind: "comments", message: "acme/app#12 +3 comments", at: "t2" });
  });

  test("comments decreasing (e.g. a deleted comment) is not an event", () => {
    expect(diffPr(pr({ comments: 5 }), pr({ comments: 5 }), [], "t2")).toEqual([]);
  });

  test("checks_summary change produces a checks event", () => {
    const before = pr({ checks: [{ name: "ci/test", status: "pending", url: "", ignored: false }] });
    const after = pr({ checks: [{ name: "ci/test", status: "failure", url: "", ignored: false }] });
    const events = diffPr(before, after, [], "t2");
    expect(events).toContainEqual({ pr_id: 1, kind: "checks", message: "acme/app#12 checks failure", at: "t2" });
  });

  test("a check going from pending to failure, but ignored, produces NO event", () => {
    const before = pr({ checks: [{ name: "codecov/patch", status: "pending", url: "", ignored: false }] });
    const after = pr({ checks: [{ name: "codecov/patch", status: "failure", url: "", ignored: false }] });
    expect(diffPr(before, after, ["codecov/*"], "t2")).toEqual([]);
  });

  test("per-PR ignored_checks also silences a checks event", () => {
    const before = pr({ ignored_checks: ["codecov/*"], checks: [{ name: "codecov/patch", status: "pending", url: "", ignored: true }] });
    const after = pr({ ignored_checks: ["codecov/*"], checks: [{ name: "codecov/patch", status: "failure", url: "", ignored: true }] });
    expect(diffPr(before, after, [], "t2")).toEqual([]);
  });
});
