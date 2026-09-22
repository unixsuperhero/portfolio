import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SCHEMA_PATH = join(import.meta.dir, "schema.sql");
export const readSchema = (): string => readFileSync(SCHEMA_PATH, "utf8");

/** Where the database lives by default: PORTFOLIO_DB, else ~/proj/portfolio/portfolio.sqlite. */
export const defaultDatabasePath = (): string => process.env.PORTFOLIO_DB ?? join(process.env.PORTFOLIO_HOME ?? join(process.env.HOME ?? "", "proj", "portfolio"), "portfolio.sqlite");

export interface OpenOptions {
  schema?: string;
  create?: boolean;
  readonly?: boolean;
  /** Skip the items-table rebuild for pre file/dir databases. */
  migrate?: boolean;
  log?: (message: string) => void;
}

/**
 * SQLite cannot widen a CHECK constraint, so a database from before the file
 * and dir item types gets its items table rebuilt. Row ids are kept, so
 * taggings, watched_items, and the external-content FTS index stay valid.
 */
export function migrateItemKinds(db: Database, path: string, schema: string, log: (message: string) => void = () => {}): boolean {
  const current = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'").get()?.sql;
  if (!current || current.includes("'dir'")) return false;
  const backup = `${path}.before-kinds`;
  if (!existsSync(backup)) db.query("VACUUM INTO ?").run(backup);
  const create = schema.match(/CREATE TABLE IF NOT EXISTS items \([\s\S]*?\n\);/)![0].replace("IF NOT EXISTS items", "items_next");
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(items)").all().map(column => column.name).join(", ");
  db.exec("PRAGMA foreign_keys = OFF");
  db.transaction(() => {
    db.exec(create);
    db.exec(`INSERT INTO items_next(${columns}) SELECT ${columns} FROM items`);
    db.exec("DROP TABLE items");
    db.exec("ALTER TABLE items_next RENAME TO items");
  })();
  db.exec("PRAGMA foreign_keys = ON");
  log(`rebuilt items for file and dir types; backup at ${backup}`);
  return true;
}

/** Adds the kind and config columns to an older cards table. A table that does not exist yet is left for `schema` to create with them already. */
export function migrateCardColumns(db: Database): void {
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(cards)").all().map(column => column.name);
  if (!columns.length) return;
  if (!columns.includes("kind")) db.exec("ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'query'");
  if (!columns.includes("config")) db.exec("ALTER TABLE cards ADD COLUMN config TEXT NOT NULL DEFAULT '{}'");
}

/** Opens (and creates) a Portfolio database and applies the schema. ":memory:" works for tests. */
export function openDatabase(path: string = defaultDatabasePath(), options: OpenOptions = {}): Database {
  const db = options.readonly ? new Database(path, { readonly: true }) : new Database(path, { create: options.create ?? true, readwrite: true });
  if (options.readonly) return db;
  const schema = options.schema ?? readSchema();
  if (options.migrate ?? true) migrateItemKinds(db, path, schema, options.log);
  migrateCardColumns(db);
  db.exec(schema);
  return db;
}
