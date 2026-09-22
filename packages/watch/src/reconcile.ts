import type { Database } from "bun:sqlite";
import { claimItem, clearClaims, claimedItemIds, findItemBySource, hasClaim, listWatchedDirectories, pruneTags, setRenderedHtml, upsertItem } from "@portfolio/db";
import type { WatchedDirectory } from "@portfolio/core";
import { scanDirectory, type ScannedDocument } from "./scan.ts";

export type Renderer = (markdown: string, options: { title: string; toc: boolean; sourcePath: string; resolveId: (path: string) => number | undefined }) => string;

export interface WatchState {
  error: string | null;
  lastSyncedAt: string | null;
  count: number;
}

export interface ReconcileResult {
  states: Map<number, WatchState>;
  upserted: number;
  removed: number;
}

/** source_path -> id for documents and notes, used to rewrite links between imported files. */
export const sourceItemIds = (db: Database): Map<string, number> => new Map(db.query<{ id: number; source_path: string }, []>("SELECT id, source_path FROM items WHERE type IN ('document', 'note') AND source_path IS NOT NULL").all().map(row => [row.source_path, row.id]));

function upsertWatchedDocument(db: Database, document: ScannedDocument): number {
  const existing = findItemBySource(db, document.sourcePath);
  const content = document.html ? "" : document.content;
  const rendered = document.html ? document.content : "";
  if (existing) {
    db.query("UPDATE items SET type = 'document', title = ?, content = ?, rendered_html = ?, url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(document.title, content, rendered, existing.id);
    return existing.id;
  }
  return upsertItem(db, { type: "document", title: document.title, content, rendered_html: rendered, source_path: document.sourcePath, toc: 1 });
}

/**
 * One full pass: scans every watched directory, upserts its documents, claims
 * them, drops documents no watch claims any more, and re-renders Markdown so
 * cross-links resolve. Directories that fail to scan keep their previous claims.
 */
export async function reconcile(db: Database, render: Renderer, directories: WatchedDirectory[] = listWatchedDirectories(db)): Promise<ReconcileResult> {
  const scans = new Map<number, Map<string, ScannedDocument>>();
  const documents = new Map<string, ScannedDocument>();
  const failures = new Map<number, Error>();
  for (const directory of directories) {
    try {
      const scan = await scanDirectory(directory.path, Boolean(directory.recursive));
      scans.set(directory.id, scan);
      for (const [path, document] of scan) documents.set(path, document);
    } catch (error) {
      failures.set(directory.id, error as Error);
    }
  }
  let removed = 0;
  db.transaction(() => {
    const previous = new Set<number>();
    for (const directory of directories) {
      if (!scans.has(directory.id)) continue;
      claimedItemIds(db, directory.id).forEach(id => previous.add(id));
      clearClaims(db, directory.id);
    }
    const ids = new Map<string, number>();
    for (const document of [...documents.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))) ids.set(document.sourcePath, upsertWatchedDocument(db, document));
    for (const [directoryId, scan] of scans) for (const path of scan.keys()) claimItem(db, directoryId, ids.get(path)!);
    const removeItem = db.query("DELETE FROM items WHERE id = ?");
    for (const id of previous) if (!hasClaim(db, id)) { removeItem.run(id); removed++; }
    pruneTags(db);
    const sources = sourceItemIds(db);
    for (const document of documents.values()) {
      if (document.html) continue;
      const id = ids.get(document.sourcePath)!;
      const item = db.query<{ title: string; toc: number }, [number]>("SELECT title, toc FROM items WHERE id = ?").get(id)!;
      setRenderedHtml(db, id, render(document.content, { title: item.title, toc: Boolean(item.toc), sourcePath: document.sourcePath, resolveId: path => sources.get(path) }));
    }
  })();
  const syncedAt = new Date().toISOString();
  const states = new Map<number, WatchState>();
  for (const directory of directories) {
    const failure = failures.get(directory.id);
    states.set(directory.id, { error: failure?.message ?? null, lastSyncedAt: failure ? null : syncedAt, count: scans.get(directory.id)?.size ?? 0 });
  }
  return { states, upserted: documents.size, removed };
}
