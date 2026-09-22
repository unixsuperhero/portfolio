import type { CardKind, CardSortKey, ItemType, PathType } from "./types.ts";

export const ITEM_TYPES: readonly ItemType[] = ["document", "note", "link", "pr", "file", "dir"] as const;
export const PATH_TYPES: readonly PathType[] = ["file", "dir"] as const;
export const EXTERNAL_TYPES: readonly ItemType[] = ["link", "pr"] as const;
export const TEXT_TYPES: readonly ItemType[] = ["document", "note"] as const;

export const CARD_SORT_KEYS: readonly CardSortKey[] = ["created_at", "updated_at", "title", "type"] as const;
export const CARD_SORT_LABELS: Record<CardSortKey, string> = { created_at: "Created", updated_at: "Updated", title: "Title", type: "Type" };
export const CARD_MAX_ITEMS = { min: 1, max: 1000, default: 100 } as const;

/** "query" runs the saved search; every other kind is a dashboard widget with its own config shape. */
export const CARD_KINDS: readonly CardKind[] = ["query", "reminders", "ports", "clock", "note", "services"] as const;

export const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;
export const DOCUMENT_EXTENSIONS = [".md", ".markdown", ".html"] as const;

export const KIND_LABELS: Record<string, string> = { document: "DOC", note: "NOTE", link: "LINK", pr: "PR", file: "FILE", dir: "DIR" };

export const isItemType = (value: unknown): value is ItemType => typeof value === "string" && (ITEM_TYPES as readonly string[]).includes(value);
export const isPathType = (value: unknown): value is PathType => typeof value === "string" && (PATH_TYPES as readonly string[]).includes(value);
export const isCardSortKey = (value: unknown): value is CardSortKey => typeof value === "string" && (CARD_SORT_KEYS as readonly string[]).includes(value);
export const isCardKind = (value: unknown): value is CardKind => typeof value === "string" && (CARD_KINDS as readonly string[]).includes(value);
