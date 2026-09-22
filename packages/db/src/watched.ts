import type { Database } from "bun:sqlite";
import type { WatchedDirectory } from "@portfolio/core";
import { pruneTags } from "./tags.ts";

export const listWatchedDirectories = (db: Database): WatchedDirectory[] => db.query<WatchedDirectory, []>("SELECT * FROM watched_directories ORDER BY path").all();
export const findWatchedDirectory = (db: Database, path: string): WatchedDirectory | null => db.query<WatchedDirectory, [string]>("SELECT * FROM watched_directories WHERE path = ?").get(path);

export function addWatchedDirectory(db: Database, path: string, recursive = false): number {
  if (findWatchedDirectory(db, path)) throw new Error("That directory is already being watched.");
  return db.query<{ id: number }, [string, number]>("INSERT INTO watched_directories(path, recursive) VALUES (?, ?) RETURNING id").get(path, recursive ? 1 : 0)!.id;
}

export const setWatchedRecursive = (db: Database, id: number, recursive: boolean): boolean => db.query("UPDATE watched_directories SET recursive = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(recursive ? 1 : 0, id).changes > 0;

export const claimedItemIds = (db: Database, directoryId: number): number[] => db.query<{ item_id: number }, [number]>("SELECT item_id FROM watched_items WHERE watched_directory_id = ?").all(directoryId).map(row => row.item_id);

/** Removes the watch and any of its documents no other watch still claims. Source files stay on disk. */
export function removeWatchedDirectory(db: Database, id: number): number {
  const itemIds = claimedItemIds(db, id);
  let removed = 0;
  db.transaction(() => {
    db.query("DELETE FROM watched_directories WHERE id = ?").run(id);
    const hasClaim = db.query<{ 1: number }, [number]>("SELECT 1 FROM watched_items WHERE item_id = ? LIMIT 1");
    const removeItem = db.query("DELETE FROM items WHERE id = ?");
    for (const itemId of itemIds) if (!hasClaim.get(itemId)) { removeItem.run(itemId); removed++; }
    pruneTags(db);
  })();
  return removed;
}

export const clearClaims = (db: Database, directoryId: number): void => { db.query("DELETE FROM watched_items WHERE watched_directory_id = ?").run(directoryId); };
export const claimItem = (db: Database, directoryId: number, itemId: number): void => { db.query("INSERT OR IGNORE INTO watched_items(watched_directory_id, item_id) VALUES (?, ?)").run(directoryId, itemId); };
export const hasClaim = (db: Database, itemId: number): boolean => Boolean(db.query<{ 1: number }, [number]>("SELECT 1 FROM watched_items WHERE item_id = ? LIMIT 1").get(itemId));
