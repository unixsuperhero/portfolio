import type { Database } from "bun:sqlite";
import { ITEM_TYPES, isItemType, itemHref, toItemView } from "@portfolio/core";
import type { Item, ItemFilter, ItemType, ItemView } from "@portfolio/core";
import { tagNamesFor, pruneTags } from "./tags.ts";
import { createTask } from "./tasks.ts";

export interface NewItem {
  type: ItemType;
  title: string;
  description?: string;
  content?: string;
  rendered_html?: string;
  url?: string | null;
  source_path?: string | null;
  toc?: 0 | 1 | boolean;
  created_at?: string | null;
}

export const getItem = (db: Database, id: number): Item | null => db.query<Item, [number]>("SELECT * FROM items WHERE id = ?").get(id);
export const findItemBySource = (db: Database, sourcePath: string): Item | null => db.query<Item, [string]>("SELECT * FROM items WHERE source_path = ?").get(sourcePath);
export const findItemByPath = (db: Database, path: string): Item | null => db.query<Item, [string]>("SELECT * FROM items WHERE path = ?").get(path);
export const countItems = (db: Database): number => db.query<{ count: number }, []>("SELECT count(*) count FROM items").get()!.count;

/** Inserts, or updates the item that already tracks `source_path`. Returns the id. */
export function upsertItem(db: Database, item: NewItem): number {
  if (item.type === "task") {
    return db.transaction(() => {
      const taskId = createTask(db, { title: item.title, notes: item.content ?? "" });
      const entry = db.query<{ id: number }, [number]>("SELECT id FROM items WHERE task_id = ?").get(taskId)!;
      db.query("UPDATE items SET description = ? WHERE id = ?").run(item.description ?? "", entry.id);
      return entry.id;
    })();
  }
  const toc = item.toc === undefined ? 1 : Number(item.toc) ? 1 : 0;
  const existing = item.source_path ? db.query<{ id: number }, [string]>("SELECT id FROM items WHERE source_path = ?").get(item.source_path) : null;
  if (existing) {
    db.query("UPDATE items SET type = ?, title = ?, description = ?, content = ?, rendered_html = ?, url = ?, toc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(item.type, item.title, item.description ?? "", item.content ?? "", item.rendered_html ?? "", item.url ?? null, toc, existing.id);
    return existing.id;
  }
  const row = db.query<{ id: number }, [string, string, string, string, string, string | null, string | null, number, string | null]>(
    `INSERT INTO items(type, title, description, content, rendered_html, url, source_path, toc, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) RETURNING id`,
  ).get(item.type, item.title, item.description ?? "", item.content ?? "", item.rendered_html ?? "", item.url ?? null, item.source_path ?? null, toc, item.created_at ?? null);
  return Number(row!.id);
}

export interface ItemPatch {
  type?: ItemType;
  title?: string;
  description?: string;
  content?: string;
  rendered_html?: string;
  url?: string | null;
  toc?: 0 | 1 | boolean;
  pinned?: 0 | 1 | boolean;
  starred?: 0 | 1 | boolean;
}

const PATCH_COLUMNS = ["type", "title", "description", "content", "rendered_html", "url", "toc", "pinned", "starred"] as const;

/** Updates only the given columns and bumps updated_at. Returns false when nothing matched. */
export function updateItem(db: Database, id: number, patch: ItemPatch): boolean {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const column of PATCH_COLUMNS) {
    if (!(column in patch)) continue;
    const value = patch[column];
    sets.push(`${column} = ?`);
    values.push(typeof value === "boolean" ? Number(value) : (value as string | number | null));
  }
  if (!sets.length) return Boolean(getItem(db, id));
  const result = db.query(`UPDATE items SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
  return result.changes > 0;
}

export const setRenderedHtml = (db: Database, id: number, html: string): void => { db.query("UPDATE items SET rendered_html = ? WHERE id = ?").run(html, id); };

export const setPathAndCategory = (db: Database, id: number, path: string | null, categoryId: number | null): void => {
  db.query("UPDATE items SET path = ?, category_id = ? WHERE id = ?").run(path, categoryId, id);
};

export function toggleItemField(db: Database, id: number, field: "pinned" | "starred"): boolean {
  return db.query(`UPDATE items SET ${field} = NOT ${field}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id).changes > 0;
}

export function setItemFlag(db: Database, ids: number[], field: "pinned" | "starred", value: boolean): void {
  const update = db.query(`UPDATE items SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  db.transaction(() => ids.forEach(id => update.run(Number(value), id)))();
}

/** Deletes items and any tags left without items. */
export function deleteItems(db: Database, ids: number[]): void {
  const remove = db.query("DELETE FROM items WHERE id = ?");
  db.transaction(() => ids.forEach(id => remove.run(id)))();
  pruneTags(db);
}

/** The FTS5 query for a search box: every token must match; scoped to title/description unless `contents`. */
export function ftsQuery(q: string, contents = false): string {
  const phrase = q.split(/\s+/).filter(Boolean).map(token => `"${token.replaceAll('"', '""')}"`).join(" AND ");
  return contents ? phrase : `{title description} : (${phrase})`;
}

/** Shared membership predicate for list and portfolio queries. Scope tags are OR-ed; filter fields are AND-ed. */
export function itemFilterSql(filter: Omit<ItemFilter, "limit"> = {}, tags: string[] = []) {
  const where = ["1=1"];
  const params: (string | number)[] = [];
  let join = "";
  const q = filter.q?.trim();
  if (q) {
    join += " JOIN items_fts ON items_fts.rowid = items.id";
    where.push("items_fts MATCH ?");
    params.push(ftsQuery(q, filter.contents));
  }
  if (filter.tag) { join += " JOIN taggings filter_tagging ON filter_tagging.item_id = items.id"; where.push("filter_tagging.tag_id = ?"); params.push(filter.tag); }
  if (filter.tagName) { where.push("items.id IN (SELECT taggings.item_id FROM taggings JOIN tags ON tags.id = taggings.tag_id WHERE tags.name = ? COLLATE NOCASE)"); params.push(filter.tagName); }
  if (tags.length) {
    where.push(`items.id IN (SELECT taggings.item_id FROM taggings JOIN tags ON tags.id = taggings.tag_id WHERE tags.name IN (${tags.map(() => "?").join(", ")}))`);
    params.push(...tags);
  }
  if (filter.category) { where.push("items.category_id = ?"); params.push(filter.category); }
  if (filter.pinned) where.push("items.pinned = 1");
  if (filter.starred) where.push("items.starred = 1");
  if (filter.type && isItemType(filter.type)) { where.push("items.type = ?"); params.push(filter.type); }
  return { join, where, params };
}

/** Lists items newest first with pinned ones on top, applying the filter's search, flags, type, tag, and category. */
export function listItems(db: Database, filter: ItemFilter = {}): Item[] {
  const { join, where, params } = itemFilterSql(filter);
  const limit = filter.limit && filter.limit > 0 ? ` LIMIT ${Math.floor(filter.limit)}` : "";
  return db.query<Item, (string | number)[]>(`SELECT DISTINCT items.* FROM items${join} WHERE ${where.join(" AND ")} ORDER BY items.pinned DESC, datetime(items.created_at) DESC, items.id DESC${limit}`).all(...params);
}

export const listItemsByType = (db: Database, type: ItemType): Item[] => db.query<Item, [string]>("SELECT * FROM items WHERE type = ? ORDER BY pinned DESC, datetime(created_at) DESC, id DESC").all(type);

export const countByType = (db: Database): Record<ItemType, number> => {
  const counts = Object.fromEntries(ITEM_TYPES.map(type => [type, 0])) as Record<ItemType, number>;
  for (const row of db.query<{ type: ItemType; count: number }, []>("SELECT type, count(*) count FROM items GROUP BY type").all()) counts[row.type] = row.count;
  return counts;
};

/** Row -> API view, with tag names and href. */
export const viewItem = (db: Database, item: Item, href = itemHref(item)): ItemView => toItemView(item, tagNamesFor(db, item.id), href);
export const viewItems = (db: Database, items: Item[], hrefFor: (item: Item) => string = itemHref): ItemView[] => items.map(item => viewItem(db, item, hrefFor(item)));
