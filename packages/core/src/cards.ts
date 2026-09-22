import { CARD_MAX_ITEMS, ITEM_TYPES, isCardSortKey, isItemType } from "./constants.ts";
import { parseTags } from "./text.ts";
import type { CardSortKey, CardSpec, ItemType, ItemView, SortDir } from "./types.ts";

export interface CardInput {
  title?: string;
  tags?: string | string[];
  types?: string | string[];
  sort_key?: string;
  sort_dir?: string;
  max_items?: string | number;
}

export const BLANK_CARD: CardSpec = { title: "", tags: [], types: [], sort_key: "created_at", sort_dir: "desc", max_items: CARD_MAX_ITEMS.default };

/** Cleans form or JSON input into a CardSpec. Every type checked collapses to "any". */
export function normalizeCard(input: CardInput): CardSpec {
  const rawTypes = Array.isArray(input.types) ? input.types : parseTags(input.types);
  const types = ITEM_TYPES.filter(type => rawTypes.includes(type));
  const max = Number.parseInt(String(input.max_items ?? ""), 10);
  return {
    title: String(input.title ?? "").trim(),
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))] : parseTags(input.tags),
    types: types.length === ITEM_TYPES.length ? [] : types,
    sort_key: isCardSortKey(input.sort_key) ? input.sort_key : "created_at",
    sort_dir: input.sort_dir === "asc" ? "asc" : "desc",
    max_items: Math.min(Math.max(Number.isFinite(max) ? max : CARD_MAX_ITEMS.default, CARD_MAX_ITEMS.min), CARD_MAX_ITEMS.max),
  };
}

/** Parses a stored row whose tags and types are JSON text. */
export function parseCardRow<T extends { tags: string; types: string }>(row: T): Omit<T, "tags" | "types"> & { tags: string[]; types: ItemType[] } {
  return { ...row, tags: JSON.parse(row.tags), types: JSON.parse(row.types).filter(isItemType) };
}

export const cardMatches = (card: Pick<CardSpec, "tags" | "types">, item: Pick<ItemView, "type" | "tags">): boolean => {
  const lower = card.tags.map(tag => tag.toLowerCase());
  const tagOk = !card.tags.length || item.tags.some(tag => lower.includes(tag.toLowerCase()));
  const typeOk = !card.types.length || card.types.includes(item.type);
  return tagOk && typeOk;
};

export function compareItems(key: CardSortKey, dir: SortDir) {
  const sign = dir === "asc" ? 1 : -1;
  return (a: ItemView, b: ItemView): number => {
    const left = key === "title" ? a.title.toLowerCase() : String(a[key]);
    const right = key === "title" ? b.title.toLowerCase() : String(b[key]);
    if (left === right) return b.id - a.id;
    return left < right ? -sign : sign;
  };
}

/** In-memory version of a card query, for clients that already hold the items. */
export function runCard(card: CardSpec, items: ItemView[]): { total: number; items: ItemView[] } {
  const matched = items.filter(item => cardMatches(card, item)).sort(compareItems(card.sort_key, card.sort_dir));
  return { total: matched.length, items: matched.slice(0, card.max_items) };
}

export const describeCard = (card: CardSpec): string => {
  const parts = [...card.tags.map(tag => `#${tag}`), ...card.types];
  return `${parts.join(" ") || "everything"} · ${card.sort_key} ${card.sort_dir}${card.max_items < CARD_MAX_ITEMS.max ? ` · max ${card.max_items}` : ""}`;
};
