import type { Database } from "bun:sqlite";
import type { Tag } from "@portfolio/core";

export interface TagCount extends Tag { count: number }

export const listTags = (db: Database): TagCount[] => db.query<TagCount, []>("SELECT tags.*, count(taggings.item_id) count FROM tags LEFT JOIN taggings ON taggings.tag_id = tags.id GROUP BY tags.id ORDER BY tags.name").all();
export const getTag = (db: Database, id: number): Tag | null => db.query<Tag, [number]>("SELECT * FROM tags WHERE id = ?").get(id);
export const findTag = (db: Database, name: string): Tag | null => db.query<Tag, [string]>("SELECT * FROM tags WHERE name = ? COLLATE NOCASE").get(name);
export const tagsFor = (db: Database, itemId: number): Tag[] => db.query<Tag, [number]>("SELECT tags.* FROM tags JOIN taggings ON taggings.tag_id = tags.id WHERE taggings.item_id = ? ORDER BY tags.name").all(itemId);
export const tagNamesFor = (db: Database, itemId: number): string[] => tagsFor(db, itemId).map(tag => tag.name);

/** Adds tags to an item, creating any that do not exist. Existing taggings are kept. */
export function setTags(db: Database, itemId: number, names: string[]): void {
  const insertTag = db.query("INSERT INTO tags(name) VALUES (?) ON CONFLICT(name) DO NOTHING");
  const getTagId = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name = ? COLLATE NOCASE");
  const insertTagging = db.query("INSERT OR IGNORE INTO taggings(tag_id, item_id) VALUES (?, ?)");
  db.transaction(() => {
    for (const name of names) {
      insertTag.run(name);
      insertTagging.run(getTagId.get(name)!.id, itemId);
    }
  })();
}

/** Removes tags from an item by name, then drops tags nothing carries any more. */
export function removeTags(db: Database, itemId: number, names: string[]): void {
  const remove = db.query("DELETE FROM taggings WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ? COLLATE NOCASE)");
  db.transaction(() => names.forEach(name => remove.run(itemId, name)))();
  pruneTags(db);
}

export const removeTagById = (db: Database, itemId: number, tagId: number): void => { db.query("DELETE FROM taggings WHERE item_id = ? AND tag_id = ?").run(itemId, tagId); };

/** Tags with no items are deleted; a card may still name them. */
export const pruneTags = (db: Database): number => db.query("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM taggings)").run().changes;

export function renameTag(db: Database, id: number, name: string): boolean {
  return db.query("UPDATE tags SET name = ? WHERE id = ?").run(name, id).changes > 0;
}
