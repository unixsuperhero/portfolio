import { describe, expect, test } from "bun:test";
import { checkStats } from "../src/components/PrChecks";
import type { PrCheck } from "../src/types";

const check = (status: PrCheck["status"], ignored = false): PrCheck => ({ name: status, status, url: "", ignored });

describe("checkStats", () => {
  test("reports complete, passing, failing, running, and total counts", () => {
    expect(checkStats([
      check("success"),
      check("success"),
      check("failure"),
      check("cancelled"),
      check("pending"),
      check("skipped"),
      check("neutral"),
    ])).toEqual({ complete: 6, passing: 2, failing: 2, running: 1, total: 7, ignoredFailures: 0, active: 7 });
  });

  test("keeps ignored failures countable but outside the effective active count", () => {
    expect(checkStats([check("failure", true), check("success")])).toEqual({
      complete: 2,
      passing: 1,
      failing: 1,
      running: 0,
      total: 2,
      ignoredFailures: 1,
      active: 1,
    });
  });
});
