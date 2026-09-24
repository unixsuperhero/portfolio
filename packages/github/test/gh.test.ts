import { describe, expect, test } from "bun:test";
import { ghGraphql } from "../src/gh.ts";
import type { Runner } from "../src/gh.ts";

describe("ghGraphql", () => {
  test("passes cwd through to the runner and returns data", async () => {
    const seen: { cmd: string[]; cwd?: string }[] = [];
    const run: Runner = async (cmd, options) => { seen.push({ cmd, cwd: options?.cwd }); return { stdout: JSON.stringify({ data: { ok: 1 } }), stderr: "", code: 0 }; };

    const data = await ghGraphql("query { x }", {}, { run, cwd: "/work/carrot" });

    expect(data).toEqual({ ok: 1 });
    expect(seen).toEqual([{ cmd: ["gh", "api", "graphql", "-f", "query=query { x }"], cwd: "/work/carrot" }]);
  });

  test("no cwd when none is given", async () => {
    const seen: (string | undefined)[] = [];
    const run: Runner = async (_cmd, options) => { seen.push(options?.cwd); return { stdout: JSON.stringify({ data: {} }), stderr: "", code: 0 }; };
    await ghGraphql("query { x }", {}, { run });
    expect(seen).toEqual([undefined]);
  });
});
