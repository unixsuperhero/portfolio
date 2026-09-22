export type ItemType = "document" | "note" | "link" | "pr" | "file" | "dir";
export type PathType = "file" | "dir";
export type CardSortKey = "created_at" | "updated_at" | "title" | "type";
export type SortDir = "asc" | "desc";

export interface Item {
  id: number;
  type: ItemType;
  title: string;
  description: string;
  content: string;
  rendered_html: string;
  url: string | null;
  source_path: string | null;
  path: string | null;
  category_id: number | null;
  slot_paths: string;
  toc: 0 | 1;
  pinned: 0 | 1;
  starred: 0 | 1;
  created_at: string;
  updated_at: string;
}

/** The shape the JSON API and the React components use. Booleans, tag names, resolved href. */
export interface ItemView {
  id: number;
  type: ItemType;
  title: string;
  description: string;
  url: string | null;
  source_path: string | null;
  path: string | null;
  pinned: boolean;
  starred: boolean;
  created_at: string;
  updated_at: string;
  href: string;
  tags: string[];
}

export interface Tag {
  id: number;
  name: string;
  created_at: string;
}

export interface Portfolio {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

/** A card is a saved query: tags are OR-ed, types narrow the result. Empty means any. */
export interface CardSpec {
  title: string;
  tags: string[];
  types: ItemType[];
  sort_key: CardSortKey;
  sort_dir: SortDir;
  max_items: number;
}

export interface Card extends CardSpec {
  id: number;
  portfolio_id: number;
  position: number;
}

export interface CardResult {
  total: number;
  items: ItemView[];
}

export interface Slot {
  name: string;
  kind: PathType;
  path: string;
}

export interface ResolvedSlot extends Slot {
  path: string;
  overridden: boolean;
  exists: boolean;
}

export interface Category {
  id: number;
  name: string;
  kind: ItemType;
  slots: Slot[];
}

export interface WatchedDirectory {
  id: number;
  path: string;
  recursive: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ProjectParent {
  id: number;
  path: string;
}

export type DetectionShape = "url" | "path" | "text";

export interface Detection {
  shape: DetectionShape;
  type: ItemType;
  title: string;
  url?: string;
  path?: string;
  exists?: boolean;
  content?: string;
}

export interface ItemFilter {
  q?: string;
  contents?: boolean;
  pinned?: boolean;
  starred?: boolean;
  type?: ItemType | "";
  tag?: number;
  tagName?: string;
  category?: number;
  limit?: number;
}
