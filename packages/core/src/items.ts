import { EXTERNAL_TYPES, KIND_LABELS } from "./constants.ts";
import type { Item, ItemType, ItemView } from "./types.ts";

export const kindLabel = (type: ItemType | string): string => KIND_LABELS[type] ?? String(type).toUpperCase();

export const isExternal = (type: ItemType): boolean => (EXTERNAL_TYPES as readonly string[]).includes(type);

export interface HrefOptions {
  /** Returns a /legacy/... href for a content-less HTML document when its file is served from the legacy root. */
  legacyHref?: (item: Pick<Item, "source_path">) => string | null;
}

/** Where an item opens: its URL for links and PRs, a legacy page when one exists, else /items/:id. */
export function itemHref(item: Pick<Item, "id" | "type" | "url" | "content" | "source_path">, options: HrefOptions = {}): string {
  if (item.type === "document" && !item.content && item.source_path?.toLowerCase().endsWith(".html")) {
    const legacy = options.legacyHref?.(item);
    if (legacy) return legacy;
  }
  if (isExternal(item.type) && item.url) return item.url;
  return `/items/${item.id}`;
}

/** Converts a database row to the API/UI view. */
export function toItemView(item: Item, tags: string[], href = itemHref(item)): ItemView {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description,
    url: item.url,
    source_path: item.source_path,
    path: item.path,
    pinned: Boolean(item.pinned),
    starred: Boolean(item.starred),
    created_at: item.created_at,
    updated_at: item.updated_at,
    href,
    tags,
  };
}

export const itemLabel = (item: Pick<ItemView, "title" | "type" | "id">): string => `${item.title} [${item.type} #${item.id}]`;
