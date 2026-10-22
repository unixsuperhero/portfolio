import type { Database } from "bun:sqlite";
import type { OncallItem, OncallPromptRun, OncallStatus } from "@portfolio/core";

interface ItemRow extends Omit<OncallItem, "status"> {
  source_key: string;
}

export type OncallDraft = Pick<OncallItem, "kind" | "title" | "body"> & {
  source_key: string;
  thread_context?: string;
  suggested_status?: OncallStatus;
  slack_channel?: string | null;
  slack_channel_url?: string | null;
  slack_message_url?: string | null;
  slack_thread_url?: string | null;
  author?: string | null;
  pr_url?: string | null;
  created_at?: string;
};

function itemFromRow(row: ItemRow): OncallItem {
  const { source_key: _sourceKey, ...item } = row;
  return { ...item, status: row.manual_status ?? row.suggested_status };
}

export function listOncallItems(db: Database): OncallItem[] {
  return db.query<ItemRow, []>("SELECT * FROM oncall_items ORDER BY created_at DESC, id DESC").all().map(itemFromRow);
}

export function getOncallItem(db: Database, id: number): OncallItem | null {
  const row = db.query<ItemRow, [number]>("SELECT * FROM oncall_items WHERE id = ?").get(id);
  return row ? itemFromRow(row) : null;
}

export function upsertOncallItem(db: Database, draft: OncallDraft): OncallItem {
  const row = db.query<{ id: number }, [string, string, string, string, string, string, string | null, string | null, string | null, string | null, string | null, string | null, string]>(`
    INSERT INTO oncall_items (source_key, kind, title, body, thread_context, suggested_status,
      slack_channel, slack_channel_url, slack_message_url, slack_thread_url, author, pr_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      title = excluded.title,
      body = CASE WHEN excluded.body <> '' THEN excluded.body ELSE oncall_items.body END,
      thread_context = CASE WHEN excluded.thread_context <> '' THEN excluded.thread_context ELSE oncall_items.thread_context END,
      suggested_status = excluded.suggested_status,
      slack_channel = COALESCE(excluded.slack_channel, oncall_items.slack_channel),
      slack_channel_url = COALESCE(excluded.slack_channel_url, oncall_items.slack_channel_url),
      slack_message_url = COALESCE(excluded.slack_message_url, oncall_items.slack_message_url),
      slack_thread_url = COALESCE(excluded.slack_thread_url, oncall_items.slack_thread_url),
      author = COALESCE(excluded.author, oncall_items.author),
      pr_url = COALESCE(excluded.pr_url, oncall_items.pr_url),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `).get(draft.source_key, draft.kind, draft.title, draft.body, draft.thread_context ?? "", draft.suggested_status ?? "open",
    draft.slack_channel ?? null, draft.slack_channel_url ?? null, draft.slack_message_url ?? null,
    draft.slack_thread_url ?? null, draft.author ?? null, draft.pr_url ?? null, draft.created_at ?? new Date().toISOString());
  if (!row) throw new Error("oncall item was not saved");
  const item = getOncallItem(db, row.id);
  if (!item) throw new Error("oncall item was not found after saving");
  return item;
}

export function setOncallStatus(db: Database, id: number, status: OncallStatus | null): OncallItem | null {
  db.query("UPDATE oncall_items SET manual_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
  return getOncallItem(db, id);
}

export function getOncallState(db: Database, key: string): string | null {
  return db.query<{ value: string }, [string]>("SELECT value FROM oncall_state WHERE key = ?").get(key)?.value ?? null;
}

export function setOncallState(db: Database, key: string, value: string): void {
  db.query("INSERT INTO oncall_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Persisted intent for automatic oncall intake polling. An absent key means polling is running. */
const POLLING_PAUSED_KEY = "polling_paused";

export function isPollingPaused(db: Database): boolean {
  return getOncallState(db, POLLING_PAUSED_KEY) === "1";
}

export function setPollingPaused(db: Database, paused: boolean): boolean {
  setOncallState(db, POLLING_PAUSED_KEY, paused ? "1" : "0");
  return paused;
}

export function createPromptRun(db: Database, promptId: string): OncallPromptRun {
  const row = db.query<{ id: number }, [string]>("INSERT INTO oncall_prompt_runs(prompt_id, status) VALUES (?, 'running') RETURNING id").get(promptId);
  if (!row) throw new Error("oncall prompt run was not created");
  return getPromptRun(db, row.id)!;
}

export function finishPromptRun(db: Database, id: number, status: "completed" | "failed", output: string): OncallPromptRun {
  db.query("UPDATE oncall_prompt_runs SET status = ?, output = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, output, id);
  return getPromptRun(db, id)!;
}

export function getPromptRun(db: Database, id: number): OncallPromptRun | null {
  return db.query<OncallPromptRun, [number]>("SELECT * FROM oncall_prompt_runs WHERE id = ?").get(id);
}

export function listPromptRuns(db: Database): OncallPromptRun[] {
  return db.query<OncallPromptRun, []>("SELECT * FROM oncall_prompt_runs ORDER BY id DESC LIMIT 40").all();
}
