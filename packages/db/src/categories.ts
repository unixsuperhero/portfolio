import type { Database } from "bun:sqlite";
import { isItemType, parseSlots, resolveSlots } from "@portfolio/core";
import type { Category, Item, ItemType, ResolvedSlot, Slot } from "@portfolio/core";

export interface CategorySummary extends Category { member_count: number }
type CategoryRow = Omit<Category, "slots"> & { slots: string };
const parse = (row: CategoryRow): Category => ({ ...row, slots: JSON.parse(row.slots) });

export const listCategories = (db: Database): CategorySummary[] => db.query<CategoryRow & { member_count: number }, []>("SELECT categories.*, count(items.id) member_count FROM categories LEFT JOIN items ON items.category_id = categories.id GROUP BY categories.id ORDER BY categories.name").all().map(row => ({ ...parse(row), member_count: row.member_count }));
export const getCategory = (db: Database, id: number): Category | null => { const row = db.query<CategoryRow, [number]>("SELECT * FROM categories WHERE id = ?").get(id); return row ? parse(row) : null; };
export const findCategory = (db: Database, name: string): Category | null => { const row = db.query<CategoryRow, [string]>("SELECT * FROM categories WHERE name = ?").get(name); return row ? parse(row) : null; };
export const categoryMemberCount = (db: Database, id: number): number => db.query<{ count: number }, [number]>("SELECT count(*) count FROM items WHERE category_id = ?").get(id)!.count;

export interface CategoryInput { name: string; kind: ItemType; slots: Slot[] | string }
const slotsOf = (slots: Slot[] | string): Slot[] => typeof slots === "string" ? parseSlots(slots) : slots;

export function createCategory(db: Database, input: CategoryInput): number {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  if (!isItemType(input.kind)) throw new Error("invalid kind");
  if (findCategory(db, name)) throw new Error("a category with that name already exists");
  return db.query<{ id: number }, [string, string, string]>("INSERT INTO categories(name, kind, slots) VALUES (?, ?, ?) RETURNING id").get(name, input.kind, JSON.stringify(slotsOf(input.slots)))!.id;
}

/** Creates the category when missing; returns it either way. */
export function ensureCategory(db: Database, input: CategoryInput): Category {
  const existing = findCategory(db, input.name);
  if (existing) return existing;
  return getCategory(db, createCategory(db, input))!;
}

export function updateCategory(db: Database, id: number, patch: Partial<CategoryInput>): boolean {
  const current = getCategory(db, id);
  if (!current) return false;
  const name = (patch.name ?? current.name).trim();
  const kind = patch.kind ?? current.kind;
  if (!name) throw new Error("name is required");
  if (!isItemType(kind)) throw new Error("invalid kind");
  if (db.query<{ id: number }, [string, number]>("SELECT id FROM categories WHERE name = ? AND id != ?").get(name, id)) throw new Error("a category with that name already exists");
  if (kind !== current.kind && categoryMemberCount(db, id)) throw new Error(`this category still has ${current.kind} items, so its kind cannot change`);
  db.query("UPDATE categories SET name = ?, kind = ?, slots = ? WHERE id = ?").run(name, kind, JSON.stringify(patch.slots === undefined ? current.slots : slotsOf(patch.slots)), id);
  return true;
}

/** Deletes a category; its members keep their rows with category_id set to NULL. */
export const deleteCategory = (db: Database, id: number): boolean => db.query("DELETE FROM categories WHERE id = ?").run(id).changes > 0;

export const categoryMembers = (db: Database, id: number): Item[] => db.query<Item, [number]>("SELECT * FROM items WHERE category_id = ? ORDER BY pinned DESC, datetime(created_at) DESC, id DESC").all(id);

/** A member's slots with resolved paths, computed at read time so a category change reaches every member. */
export function memberSlots(db: Database, item: Pick<Item, "category_id" | "path" | "slot_paths">, home?: string): ResolvedSlot[] {
  if (!item.category_id) return [];
  const category = getCategory(db, item.category_id);
  if (!category) return [];
  return resolveSlots(category.slots, { memberPath: item.path, overrides: JSON.parse(item.slot_paths || "{}"), home }) as ResolvedSlot[];
}

/** Sets or clears (empty path) one member's override for a slot. */
export function setSlotOverride(db: Database, item: Pick<Item, "id" | "slot_paths">, slotName: string, path: string): void {
  const overrides: Record<string, string> = JSON.parse(item.slot_paths || "{}");
  if (path.trim()) overrides[slotName] = path.trim(); else delete overrides[slotName];
  db.query("UPDATE items SET slot_paths = ? WHERE id = ?").run(JSON.stringify(overrides), item.id);
}
