import type { Database } from "bun:sqlite";
import type { ChecksSummary, Pr, PrCheck, PrEvent, PrList, ReviewDecision } from "@portfolio/core";
import { upsertItem } from "./items.ts";

interface PrRow {
  id: number;
  url: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  is_draft: 0 | 1;
  state: Pr["state"];
  review_decision: ReviewDecision | null;
  updated_at: string;
  comments: number;
  checks: string;
  lists: string;
  watched: 0 | 1;
  ignored_checks: string;
  item_id: number | null;
  source_dir: string | null;
  fetched_at: string;
}

const rowToPr = (row: PrRow): Pr => ({
  id: row.id,
  url: row.url,
  owner: row.owner,
  repo: row.repo,
  number: row.number,
  title: row.title,
  author: row.author,
  is_draft: Boolean(row.is_draft),
  state: row.state,
  review_decision: row.review_decision,
  updated_at: row.updated_at,
  comments: row.comments,
  checks: JSON.parse(row.checks),
  checks_summary: checksSummaryFor(JSON.parse(row.checks)),
  watched: Boolean(row.watched),
  ignored_checks: JSON.parse(row.ignored_checks),
  lists: JSON.parse(row.lists),
  item_id: row.item_id,
  source_dir: row.source_dir ?? null,
  fetched_at: row.fetched_at,
});

/** Same priority as @portfolio/github's checksSummary, over checks already flagged `ignored`. Kept local so packages/db has no dependency on packages/github. */
function checksSummaryFor(checks: PrCheck[]): ChecksSummary {
  const active = checks.filter(check => !check.ignored);
  if (!active.length) return "none";
  if (active.some(check => check.status === "failure" || check.status === "cancelled")) return "failure";
  if (active.some(check => check.status === "pending")) return "pending";
  return "success";
}

export const getPr = (db: Database, id: number): Pr | null => {
  const row = db.query<PrRow, [number]>("SELECT * FROM github_prs WHERE id = ?").get(id);
  return row ? rowToPr(row) : null;
};

export const findPrByUrl = (db: Database, url: string): Pr | null => {
  const row = db.query<PrRow, [string]>("SELECT * FROM github_prs WHERE url = ?").get(url);
  return row ? rowToPr(row) : null;
};

export interface PrListFilter {
  list?: PrList;
  watched?: boolean;
  /** Narrow to PRs fetched from this github_dirs entry (null: the API's own cwd). */
  dir?: string | null;
}

/** Every PR, optionally narrowed to a search list (member of `lists`) or to watched-only. */
export function listPrs(db: Database, filter: PrListFilter = {}): Pr[] {
  const rows = db.query<PrRow, []>("SELECT * FROM github_prs ORDER BY datetime(updated_at) DESC").all();
  let prs = rows.map(rowToPr);
  if (filter.watched) prs = prs.filter(pr => pr.watched);
  if (filter.list) prs = filter.list === "watched" ? prs.filter(pr => pr.watched) : prs.filter(pr => pr.lists.includes(filter.list!));
  if (filter.dir !== undefined) prs = prs.filter(pr => pr.source_dir === filter.dir);
  return prs;
}

export type PrUpsertInput = Omit<Pr, "id">;

/** Inserts, or updates the row for `input.url`. Returns the id either way. */
export function upsertPr(db: Database, input: PrUpsertInput): number {
  const row = db.query<{ id: number }, [
    string, string, string, number, string, string, number, string, string | null, string, number,
    string, string, number, string, number | null, string | null, string,
  ]>(
    `INSERT INTO github_prs(url, owner, repo, number, title, author, is_draft, state, review_decision, updated_at, comments, checks, lists, watched, ignored_checks, item_id, source_dir, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       owner = excluded.owner, repo = excluded.repo, number = excluded.number, title = excluded.title, author = excluded.author,
       is_draft = excluded.is_draft, state = excluded.state, review_decision = excluded.review_decision, updated_at = excluded.updated_at,
       comments = excluded.comments, checks = excluded.checks, lists = excluded.lists, watched = excluded.watched,
       ignored_checks = excluded.ignored_checks, item_id = excluded.item_id, source_dir = excluded.source_dir, fetched_at = excluded.fetched_at
     RETURNING id`,
  ).get(
    input.url, input.owner, input.repo, input.number, input.title, input.author, Number(input.is_draft), input.state,
    input.review_decision, input.updated_at, input.comments, JSON.stringify(input.checks), JSON.stringify(input.lists),
    Number(input.watched), JSON.stringify(input.ignored_checks), input.item_id, input.source_dir, input.fetched_at,
  )!;
  return row.id;
}

/** Sets watched, creating (or linking) the library `pr` item the first time a PR is watched. */
export function setWatched(db: Database, id: number, watched: boolean): Pr {
  const pr = getPr(db, id);
  if (!pr) throw new Error("PR not found");
  let itemId = pr.item_id;
  if (watched && !itemId) {
    const existing = db.query<{ id: number }, [string]>("SELECT id FROM items WHERE type = 'pr' AND url = ?").get(pr.url);
    itemId = existing ? existing.id : upsertItem(db, { type: "pr", title: `${pr.owner}/${pr.repo}#${pr.number}`, url: pr.url });
  }
  db.query("UPDATE github_prs SET watched = ?, item_id = ? WHERE id = ?").run(Number(watched), itemId, id);
  return getPr(db, id)!;
}

/** Replaces a PR's per-PR ignored-check patterns and recomputes each check's `ignored` flag. */
export function setIgnoredChecks(db: Database, id: number, patterns: string[]): Pr {
  const pr = getPr(db, id);
  if (!pr) throw new Error("PR not found");
  const checks = pr.checks.map(check => ({ ...check, ignored: patterns.some(pattern => matchesGlob(check.name, pattern)) }));
  db.query("UPDATE github_prs SET ignored_checks = ?, checks = ? WHERE id = ?").run(JSON.stringify(patterns), JSON.stringify(checks), id);
  return getPr(db, id)!;
}

function matchesGlob(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(name);
}

export interface PrEventDraft {
  pr_id: number;
  kind: PrEvent["kind"];
  message: string;
  at: string;
}

export function insertEvents(db: Database, events: PrEventDraft[]): void {
  if (!events.length) return;
  const insert = db.query("INSERT INTO github_pr_events(pr_id, kind, message, at) VALUES (?, ?, ?, ?)");
  db.transaction(() => events.forEach(event => insert.run(event.pr_id, event.kind, event.message, event.at)))();
}

/** Unseen events newer than `sinceId` (default 0), oldest first. */
export const listUnseenEvents = (db: Database, sinceId = 0): PrEvent[] =>
  db.query<{ id: number; pr_id: number; kind: PrEvent["kind"]; message: string; at: string; seen: 0 | 1 }, [number]>(
    "SELECT * FROM github_pr_events WHERE seen = 0 AND id > ? ORDER BY id",
  ).all(sinceId).map(row => ({ ...row, seen: Boolean(row.seen) }));

export function markEventsSeen(db: Database, ids: number[]): void {
  if (!ids.length) return;
  const update = db.query("UPDATE github_pr_events SET seen = 1 WHERE id = ?");
  db.transaction(() => ids.forEach(id => update.run(id)))();
}
