import type { Database } from "bun:sqlite";
import { itemHref, normalizeCard, parseCardRow, toItemView } from "@portfolio/core";
import type { Card, CardResult, CardSpec, Item, Portfolio } from "@portfolio/core";
import type { CardInput } from "@portfolio/core";
import { tagNamesFor } from "./tags.ts";

export interface PortfolioSummary extends Portfolio { card_count: number }

const CARD_SORTS = { created_at: "datetime(items.created_at)", updated_at: "datetime(items.updated_at)", title: "items.title COLLATE NOCASE", type: "items.type" } as const;
const placeholders = (values: unknown[]) => values.map(() => "?").join(", ");

export const listPortfolios = (db: Database): PortfolioSummary[] => db.query<PortfolioSummary, []>("SELECT portfolios.*, count(cards.id) card_count FROM portfolios LEFT JOIN cards ON cards.portfolio_id = portfolios.id GROUP BY portfolios.id ORDER BY portfolios.name").all();
export const getPortfolio = (db: Database, id: number): Portfolio | null => db.query<Portfolio, [number]>("SELECT * FROM portfolios WHERE id = ?").get(id);
export const findPortfolio = (db: Database, name: string): Portfolio | null => db.query<Portfolio, [string]>("SELECT * FROM portfolios WHERE name = ? COLLATE NOCASE").get(name);

export function createPortfolio(db: Database, name: string, description = ""): number {
  if (!name.trim()) throw new Error("name is required");
  if (findPortfolio(db, name)) throw new Error("a portfolio with that name already exists");
  return db.query<{ id: number }, [string, string]>("INSERT INTO portfolios(name, description) VALUES (?, ?) RETURNING id").get(name.trim(), description)!.id;
}

export function updatePortfolio(db: Database, id: number, patch: { name?: string; description?: string }): boolean {
  const current = getPortfolio(db, id);
  if (!current) return false;
  const name = (patch.name ?? current.name).trim();
  if (!name) throw new Error("name is required");
  const clash = db.query<{ id: number }, [string, number]>("SELECT id FROM portfolios WHERE name = ? COLLATE NOCASE AND id != ?").get(name, id);
  if (clash) throw new Error("a portfolio with that name already exists");
  db.query("UPDATE portfolios SET name = ?, description = ? WHERE id = ?").run(name, patch.description ?? current.description, id);
  return true;
}

/** Deletes a portfolio and its cards. Items are never touched. */
export const deletePortfolio = (db: Database, id: number): boolean => db.query("DELETE FROM portfolios WHERE id = ?").run(id).changes > 0;

type CardRow = Omit<Card, "tags" | "types"> & { tags: string; types: string };

export const portfolioCards = (db: Database, portfolioId: number): Card[] => db.query<CardRow, [number]>("SELECT * FROM cards WHERE portfolio_id = ? ORDER BY position, id").all(portfolioId).map(parseCardRow) as Card[];
export const getCard = (db: Database, id: number): Card | null => {
  const row = db.query<CardRow, [number]>("SELECT * FROM cards WHERE id = ?").get(id);
  return row ? (parseCardRow(row) as Card) : null;
};

export function createCard(db: Database, portfolioId: number, input: CardInput): number {
  const card = normalizeCard(input);
  if (!card.title) throw new Error("title is required");
  return db.query<{ id: number }, [number, string, string, string, string, string, number, number]>(
    "INSERT INTO cards(portfolio_id, title, tags, types, sort_key, sort_dir, max_items, position) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM cards WHERE portfolio_id = ?)) RETURNING id",
  ).get(portfolioId, card.title, JSON.stringify(card.tags), JSON.stringify(card.types), card.sort_key, card.sort_dir, card.max_items, portfolioId)!.id;
}

export function updateCard(db: Database, id: number, input: CardInput): boolean {
  const current = getCard(db, id);
  if (!current) return false;
  const card = normalizeCard({ ...current, ...input });
  if (!card.title) throw new Error("title is required");
  db.query("UPDATE cards SET title = ?, tags = ?, types = ?, sort_key = ?, sort_dir = ?, max_items = ? WHERE id = ?")
    .run(card.title, JSON.stringify(card.tags), JSON.stringify(card.types), card.sort_key, card.sort_dir, card.max_items, id);
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

/** Runs a card's saved query: tags OR-ed, types narrowing, sorted, capped. Works for unsaved specs too. */
export function cardItems(db: Database, card: CardSpec, hrefFor: (item: Item) => string = itemHref): CardResult {
  const where = ["1=1"];
  const params: (string | number)[] = [];
  if (card.tags.length) {
    where.push(`items.id IN (SELECT taggings.item_id FROM taggings JOIN tags ON tags.id = taggings.tag_id WHERE tags.name IN (${placeholders(card.tags)}))`);
    params.push(...card.tags);
  }
  if (card.types.length) { where.push(`items.type IN (${placeholders(card.types)})`); params.push(...card.types); }
  const from = `FROM items WHERE ${where.join(" AND ")}`;
  const total = db.query<{ count: number }, (string | number)[]>(`SELECT count(*) count ${from}`).get(...params)!.count;
  const rows = db.query<Item, (string | number)[]>(`SELECT items.* ${from} ORDER BY ${CARD_SORTS[card.sort_key]} ${card.sort_dir === "asc" ? "ASC" : "DESC"}, items.id DESC LIMIT ?`).all(...params, card.max_items);
  return { total, items: rows.map(item => toItemView(item, tagNamesFor(db, item.id), hrefFor(item))) };
}

/** A portfolio with every card and its matching items, the JSON API's payload. */
export function portfolioView(db: Database, portfolio: Portfolio, hrefFor?: (item: Item) => string) {
  return { ...portfolio, cards: portfolioCards(db, portfolio.id).map(card => ({ ...card, ...cardItems(db, card, hrefFor) })) };
}
