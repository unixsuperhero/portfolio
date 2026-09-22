import type { Database } from "bun:sqlite";
import { openDatabase, type OpenOptions } from "./open.ts";
import * as items from "./items.ts";
import * as tags from "./tags.ts";
import * as portfolios from "./portfolios.ts";
import * as categories from "./categories.ts";
import * as settings from "./settings.ts";
import * as watched from "./watched.ts";
import * as projects from "./projects.ts";
import * as tasks from "./tasks.ts";
import * as github from "./github.ts";

type Bound<T> = { [K in keyof T]: T[K] extends (db: Database, ...rest: infer A) => infer R ? (...rest: A) => R : never };

const bind = <T extends Record<string, unknown>>(db: Database, module: T): Bound<T> =>
  Object.fromEntries(Object.entries(module).filter(([, value]) => typeof value === "function").map(([name, fn]) => [name, (...rest: unknown[]) => (fn as (...args: unknown[]) => unknown)(db, ...rest)])) as Bound<T>;

/**
 * Every repo bound to one database, for callers that prefer `store.items.get(1)`
 * over `getItem(db, 1)`. The raw `db` stays available for transactions.
 */
export function openStore(path?: string, options?: OpenOptions) {
  const db = openDatabase(path, options);
  return {
    db,
    path,
    items: bind(db, items),
    tags: bind(db, tags),
    portfolios: bind(db, portfolios),
    categories: bind(db, categories),
    settings: bind(db, settings),
    watched: bind(db, watched),
    projects: bind(db, projects),
    tasks: bind(db, tasks),
    github: bind(db, github),
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof openStore>;
