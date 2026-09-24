#!/usr/bin/env bun
// Times the PR lists query in each shape the poller can send, from a given directory, so a
// GitHub-side timeout (gh: HTTP 502/504) can be pinned to the list and page size that cause it.
//   bun packages/github/scripts/time-lists-query.ts /Users/josh/work/carrot
import { listQuery, listsQuery } from "../src/query.ts";

const cwd = process.argv[2] ?? process.cwd();
const variants: Record<string, string> = {
  "combined, 50 each": listsQuery(),
  "mine, 50": listQuery("mine", 50),
  "mine, 20": listQuery("mine", 20),
  "review_requested, 50": listQuery("review_requested", 50),
  "review_requested, 20": listQuery("review_requested", 20),
  "review_requested, 10": listQuery("review_requested", 10),
};

console.log(`gh from ${cwd}\n`);
for (const [name, query] of Object.entries(variants)) {
  const started = performance.now();
  const proc = Bun.spawnSync(["gh", "api", "graphql", "-f", `query=${query}`], { cwd });
  const ms = Math.round(performance.now() - started);
  let counts = "";
  try {
    const data = JSON.parse(proc.stdout.toString()).data;
    counts = Object.entries(data).filter(([k]) => k !== "rateLimit").map(([k, v]) => `${k}=${(v as { nodes: unknown[] }).nodes.length}`).join(" ");
  } catch {}
  const err = proc.stderr.toString().trim().split("\n")[0]?.slice(0, 80) ?? "";
  console.log(`${name.padEnd(24)} ${String(ms).padStart(6)} ms  exit ${proc.exitCode}  ${counts}${err ? `  ${err}` : ""}`);
}
