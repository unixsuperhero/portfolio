import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { abbreviatePath, itemLabel, isItemType } from "@portfolio/core";
import type { Item, ItemFilter, ItemType, ItemView } from "@portfolio/core";
import { defaultDatabasePath, listItems, openStore, viewItems, type Store } from "@portfolio/db";
import { CliError, flag, json, option, pickOne, table } from "@portfolio/cli-kit";
import { PortfolioClient, defaultServer } from "@portfolio/client";

/** The project root: PORTFOLIO_HOME, else the parent of the bin/ directory running the script. */
export const projectRoot = (): string => process.env.PORTFOLIO_HOME ?? (process.argv[1] ? dirname(dirname(process.argv[1])) : join(process.env.HOME ?? "", "proj", "portfolio"));

export const databasePath = (): string => process.env.PORTFOLIO_DB ?? join(projectRoot(), "portfolio.sqlite");

/** Opens the store every pf-* tool shares. Fails loudly when the file is missing unless `create`. */
export function openDefaultStore(options: { create?: boolean; readonly?: boolean } = {}): Store {
  const path = databasePath();
  if (!options.create && !existsSync(path)) throw new CliError(`no database at ${path} (set PORTFOLIO_DB or run pf-db init)`);
  return openStore(path, { create: options.create ?? false, readonly: options.readonly });
}

export const client = (): PortfolioClient => new PortfolioClient(process.env.PORTFOLIO_SERVER ?? defaultServer());

/** Options shared by every item-listing command. */
export const LIST_OPTS = {
  type: option("t", "only this item type"),
  tag: option("g", "only items with this tag name"),
  pinned: flag("p", "pinned only"),
  starred: flag("s", "starred only"),
  contents: flag("c", "search inside contents too"),
  limit: option("l", "at most N items", { type: "number" }),
  json: flag("j", "print JSON"),
  full: flag("f", "show paths and urls"),
};

export interface ListOpts { type: string | null; tag: string | null; pinned: boolean; starred: boolean; contents: boolean; limit: number | null; json: boolean; full: boolean }

export function filterFromOpts(args: string[], opts: ListOpts): ItemFilter {
  if (opts.type && !isItemType(opts.type)) throw new CliError(`unknown type ${opts.type}`);
  return { q: args.join(" "), type: (opts.type ?? "") as ItemType | "", tagName: opts.tag ?? undefined, pinned: opts.pinned, starred: opts.starred, contents: opts.contents, limit: opts.limit ?? undefined };
}

export const findItems = (store: Store, args: string[], opts: ListOpts): Item[] => listItems(store.db, filterFromOpts(args, opts));

export const label = (item: Pick<ItemView, "title" | "type" | "id">): string => itemLabel(item);

/** Prints items as a table, JSON, or hiiro-style labels. */
export function printItems(store: Store, items: Item[], opts: Pick<ListOpts, "json" | "full">, out: (line?: string) => void): void {
  const views = viewItems(store.db, items);
  if (opts.json) return out(json(views));
  if (!views.length) return out("(no items)");
  if (opts.full) return out(table(views.map(view => ({ id: view.id, type: view.type, title: view.title, tags: view.tags.join(","), created: view.created_at.slice(0, 10), where: view.url ?? (view.path ? abbreviatePath(view.path) : view.source_path ? abbreviatePath(view.source_path) : "") }))));
  for (const view of views) out(`${view.pinned ? "📌 " : ""}${view.starred ? "★ " : ""}${label(view)}${view.tags.length ? `  #${view.tags.join(" #")}` : ""}`);
}

/** One item by id, or by fuzzy-picking among search matches. */
export function pickItem(store: Store, args: string[], opts: ListOpts): Item | null {
  if (args.length === 1 && /^\d+$/.test(args[0])) {
    const item = store.items.getItem(Number(args[0]));
    if (!item) throw new CliError(`no item #${args[0]}`);
    return item;
  }
  const items = findItems(store, args, opts);
  if (!items.length) throw new CliError("no matching items");
  return pickOne(items, item => label(item));
}

/** Where the item opens in a browser, absolute. */
export const itemUrl = (item: Item): string => {
  const href = store_href(item);
  return /^https?:\/\//.test(href) ? href : `${process.env.PORTFOLIO_SERVER ?? defaultServer()}${href}`;
};
const store_href = (item: Item) => (["link", "pr"].includes(item.type) && item.url ? item.url : `/items/${item.id}`);
