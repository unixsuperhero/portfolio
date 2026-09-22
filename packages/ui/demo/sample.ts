import type { ItemView } from "@portfolio/core";
import { normalizeCard } from "@portfolio/core";

const item = (id: number, type: ItemView["type"], title: string, tags: string[], extra: Partial<ItemView> = {}): ItemView => ({
  id, type, title, description: "", url: type === "link" || type === "pr" ? `https://example.com/${id}` : null, source_path: null, path: null,
  pinned: false, starred: false, created_at: `2026-09-${String(id).padStart(2, "0")} 10:00:00`, updated_at: `2026-09-2${id % 10} 10:00:00`, href: `/items/${id}`, tags, ...extra,
});

export const ITEMS: ItemView[] = [
  item(1, "document", "Procedural thinking: complete master list", ["procedural thinking", "yt"], { description: "The 120-item list with every sub-point.", pinned: true }),
  item(2, "pr", "hiiro#412 add pinned PR manager", ["hiiro", "review"], { url: "https://github.com/x/hiiro/pull/412" }),
  item(3, "link", "remotion.dev/docs", ["yt", "video"]),
  item(4, "note", "Video intro beats", ["yt"], { description: "Hook, promise, proof, plan.", starred: true }),
  item(5, "dir", "portfolio", ["project"], { path: "/Users/me/proj/portfolio" }),
  item(6, "file", "TASKS.md", ["project"], { path: "/Users/me/proj/portfolio/TASKS.md" }),
  item(7, "document", "Zshrc migration", ["dotfiles"]),
  item(8, "link", "sqlite.org/fts5", ["reference", "sqlite"]),
  item(9, "document", "Slides: data-first design", ["slides", "yt"], { description: "Speaker script and slide notes." }),
];

export const CARDS = [
  { id: 1, portfolio_id: 1, position: 1, ...normalizeCard({ title: "YouTube pipeline", tags: "yt, slides", sort_key: "title", sort_dir: "asc" }) },
  { id: 2, portfolio_id: 1, position: 2, ...normalizeCard({ title: "Open PRs", types: ["pr"], sort_key: "updated_at" }) },
  { id: 3, portfolio_id: 1, position: 3, ...normalizeCard({ title: "Project files", types: ["file", "dir"], max_items: 2 }) },
  { id: 4, portfolio_id: 1, position: 4, ...normalizeCard({ title: "Not yet tagged", tags: "future-tag" }) },
];
