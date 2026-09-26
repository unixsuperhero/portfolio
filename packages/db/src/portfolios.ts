import type { Database } from "bun:sqlite";
import { hasPortfolioItemScope, itemHref, normalizeCard, normalizePortfolioFilter, normalizePortfolioTags, parseCardRow, toItemView } from "@portfolio/core";
import type { Card, CardResult, CardSpec, Item, ItemView, Portfolio, PortfolioItemFilter } from "@portfolio/core";
import type { CardInput } from "@portfolio/core";
import { itemFilterSql } from "./items.ts";
import { tagNamesFor } from "./tags.ts";

export interface PortfolioSummary extends Portfolio { card_count: number }
type PortfolioRow = Omit<Portfolio, "tags" | "item_filter"> & { tags: string; item_filter: string };
export type PortfolioPatch = { name?: string; description?: string; tags?: string[]; item_filter?: PortfolioItemFilter };

const CARD_SORTS = { created_at: "datetime(items.created_at)", updated_at: "datetime(items.updated_at)", title: "items.title COLLATE NOCASE", type: "items.type" } as const;
const placeholders = (values: unknown[]) => values.map(() => "?").join(", ");
const portfolioFromRow = (row: PortfolioRow): Portfolio => ({
  ...row,
  tags: parseTagsJson(row.tags),
  item_filter: parseFilterJson(row.item_filter),
});
const parseTagsJson = (value: string): string[] => {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? [...new Set(parsed.filter((tag): tag is string => typeof tag === "string").map(tag => tag.trim()).filter(Boolean))] : []; }
  catch { return []; }
};
const parseFilterJson = (value: string): PortfolioItemFilter => {
  try { return normalizePortfolioFilter(JSON.parse(value)); } catch { return {}; }
};
/** Deletes a portfolio and its cards. Items are never touched. */
export const deletePortfolio = (db: Database, id: number): boolean => db.query("DELETE FROM portfolios WHERE id = ?").run(id).changes > 0;


export const listPortfolios = (db: Database): PortfolioSummary[] => db.query<PortfolioRow & { card_count: number }, []>("SELECT portfolios.*, count(cards.id) card_count FROM portfolios LEFT JOIN cards ON cards.portfolio_id = portfolios.id GROUP BY portfolios.id ORDER BY portfolios.name").all().map(row => ({ ...portfolioFromRow(row), card_count: row.card_count }));
export const getPortfolio = (db: Database, id: number): Portfolio | null => {
  const row = db.query<PortfolioRow, [number]>("SELECT * FROM portfolios WHERE id = ?").get(id);
  return row ? portfolioFromRow(row) : null;
};
export const findPortfolio = (db: Database, name: string): Portfolio | null => {
  const row = db.query<PortfolioRow, [string]>("SELECT * FROM portfolios WHERE name = ? COLLATE NOCASE").get(name);
  return row ? portfolioFromRow(row) : null;
};

export function createPortfolio(db: Database, name: string, description = "", tags: string[] = [], itemFilter: PortfolioItemFilter = {}): number {
  if (!name.trim()) throw new Error("name is required");
  if (findPortfolio(db, name)) throw new Error("a portfolio with that name already exists");
  return db.query<{ id: number }, [string, string, string, string]>("INSERT INTO portfolios(name, description, tags, item_filter) VALUES (?, ?, ?, ?) RETURNING id")
    .get(name.trim(), description, JSON.stringify(normalizePortfolioTags(tags)), JSON.stringify(normalizePortfolioFilter(itemFilter)))!.id;
}

export function updatePortfolio(db: Database, id: number, patch: PortfolioPatch): boolean {
  const current = getPortfolio(db, id);
  if (!current) return false;
  const name = (patch.name ?? current.name).trim();
  if (!name) throw new Error("name is required");
  const clash = db.query<{ id: number }, [string, number]>("SELECT id FROM portfolios WHERE name = ? COLLATE NOCASE AND id != ?").get(name, id);
  if (clash) throw new Error("a portfolio with that name already exists");
  const tags = patch.tags ?? current.tags;
  const itemFilter = patch.item_filter ?? current.item_filter;
  db.query("UPDATE portfolios SET name = ?, description = ?, tags = ?, item_filter = ? WHERE id = ?")
    .run(name, patch.description ?? current.description, JSON.stringify(tags), JSON.stringify(itemFilter), id);
  return true;
}

type CardRow = Omit<Card, "tags" | "types" | "config"> & { tags: string; types: string; config: string };

export const portfolioCards = (db: Database, portfolioId: number): Card[] => db.query<CardRow, [number]>("SELECT * FROM cards WHERE portfolio_id = ? ORDER BY position, id").all(portfolioId).map(parseCardRow) as Card[];
export const getCard = (db: Database, id: number): Card | null => {
  const row = db.query<CardRow, [number]>("SELECT * FROM cards WHERE id = ?").get(id);
  return row ? (parseCardRow(row) as Card) : null;
};

export function createCard(db: Database, portfolioId: number, input: CardInput): number {
  const card = normalizeCard(input);
  if (!card.title) throw new Error("title is required");
  return db.query<{ id: number }, [number, string, string, string, string, string, string, string, number, number]>(
    "INSERT INTO cards(portfolio_id, title, kind, config, tags, types, sort_key, sort_dir, max_items, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM cards WHERE portfolio_id = ?)) RETURNING id",
  ).get(portfolioId, card.title, card.kind, JSON.stringify(card.config), JSON.stringify(card.tags), JSON.stringify(card.types), card.sort_key, card.sort_dir, card.max_items, portfolioId)!.id;
}

export function updateCard(db: Database, id: number, input: CardInput): boolean {
  const current = getCard(db, id);
  if (!current) return false;
  const card = normalizeCard({ ...current, ...input });
  if (!card.title) throw new Error("title is required");
  db.query("UPDATE cards SET title = ?, kind = ?, config = ?, tags = ?, types = ?, sort_key = ?, sort_dir = ?, max_items = ? WHERE id = ?")
    .run(card.title, card.kind, JSON.stringify(card.config), JSON.stringify(card.tags), JSON.stringify(card.types), card.sort_key, card.sort_dir, card.max_items, id);
  return true;
}

export const deleteCard = (db: Database, id: number): boolean => db.query("DELETE FROM cards WHERE id = ?").run(id).changes > 0;

/** Swaps positions with the neighbor on that side. No-op at the edge. */
export function moveCard(db: Database, card: Card, direction: "left" | "right"): boolean {
  const neighbor = direction === "left"
    ? db.query<{ id: number; position: number }, [number, number]>("SELECT id, position FROM cards WHERE portfolio_id = ? AND position < ? ORDER BY position DESC LIMIT 1").get(card.portfolio_id, card.position)
    : db.query<{ id: number; position: number }, [number, number]>("SELECT id, position FROM cards WHERE portfolio_id = ? AND position > ? ORDER BY position LIMIT 1").get(card.portfolio_id, card.position);
  if (!neighbor) return false;
  const setPosition = db.query("UPDATE cards SET position = ? WHERE id = ?");
  db.transaction(() => { setPosition.run(neighbor.position, card.id); setPosition.run(card.position, neighbor.id); })();
  return true;
}

/** Runs the saved card query, applying the portfolio predicate before count and cap. */
export function cardItems(db: Database, card: CardSpec, hrefFor: (item: Item) => string = itemHref, portfolio?: Portfolio): CardResult {
  const scope = portfolio ? itemFilterSql(portfolio.item_filter, portfolio.tags) : { join: "", where: ["1=1"], params: [] as (string | number)[] };
  const where = [...scope.where];
  const params = [...scope.params];
  if (card.tags.length) {
    where.push(`items.id IN (SELECT taggings.item_id FROM taggings JOIN tags ON tags.id = taggings.tag_id WHERE tags.name COLLATE NOCASE IN (${placeholders(card.tags)}))`);
    params.push(...card.tags);
  }
  if (card.types.length) { where.push(`items.type IN (${placeholders(card.types)})`); params.push(...card.types); }
  const from = `FROM items${scope.join} WHERE ${where.join(" AND ")}`;
  const total = db.query<{ count: number }, (string | number)[]>(`SELECT count(DISTINCT items.id) count ${from}`).get(...params)!.count;
  const rows = db.query<Item, (string | number)[]>(`SELECT DISTINCT items.* ${from} ORDER BY ${CARD_SORTS[card.sort_key]} ${card.sort_dir === "asc" ? "ASC" : "DESC"}, items.id DESC LIMIT ?`).all(...params, card.max_items);
  return { total, items: rows.map(item => toItemView(item, tagNamesFor(db, item.id), hrefFor(item))) };
}

const scopeActive = hasPortfolioItemScope;

export function portfolioScopeItemIds(db: Database, portfolio: Portfolio): number[] {
  if (!scopeActive(portfolio)) return [];
  const { join, where, params } = itemFilterSql(portfolio.item_filter, portfolio.tags);
  return db.query<{ id: number }, (string | number)[]>(`SELECT DISTINCT items.id ${`FROM items${join}`} WHERE ${where.join(" AND ")}`).all(...params).map(item => item.id);
}

/** Widget scope is represented by linked item ids; unlinked records remain visible only without an active scope. */
export function portfolioView(db: Database, portfolio: Portfolio, hrefFor?: (item: Item) => string) {
  const scope_active = scopeActive(portfolio);
  const scope_item_ids = portfolioScopeItemIds(db, portfolio);
  return {
    ...portfolio,
    scope_active,
    scope_item_ids,
    cards: portfolioCards(db, portfolio.id).map(card => (card.kind === "query" ? { ...card, ...cardItems(db, card, hrefFor, portfolio) } : { ...card, items: [] as ItemView[], total: 0 })),
  };
}
