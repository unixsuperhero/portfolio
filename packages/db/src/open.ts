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
 * SQLite cannot widen a CHECK constraint, so databases missing an item kind
 * get their items table rebuilt. Row ids are kept, so
 * taggings, watched_items, and the external-content FTS index stay valid.
 */
export function migrateItemKinds(db: Database, path: string, schema: string, log: (message: string) => void = () => {}): boolean {
  const current = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'").get()?.sql;
  if (!current || ["'file'", "'dir'", "'task'", "task_id"].every(value => current.includes(value))) return false;
  const backup = `${path}.before-tasks`;
  if (path !== ":memory:" && !existsSync(backup)) db.query("VACUUM INTO ?").run(backup);
  const create = schema.match(/CREATE TABLE IF NOT EXISTS items \([\s\S]*?\n\);/)![0].replace("IF NOT EXISTS items", "items_next");
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(items)").all().map(column => column.name).join(", ");
  const legacy = db.query<{ legacy_alter_table: number }, []>("PRAGMA legacy_alter_table").get()!.legacy_alter_table;
  db.exec("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON");
  try {
    db.transaction(() => {
      db.exec(create);
      db.exec(`INSERT INTO items_next(${columns}) SELECT ${columns} FROM items`);
      db.exec("DROP TABLE items");
      db.exec("ALTER TABLE items_next RENAME TO items");
    })();
  } finally {
    db.exec(`PRAGMA foreign_keys = ON; PRAGMA legacy_alter_table = ${legacy}`);
  }
  log(`rebuilt items for task items; backup at ${backup}`);
  return true;
}

/** Adds the kind and config columns to an older cards table. A table that does not exist yet is left for `schema` to create with them already. */
export function migrateCardColumns(db: Database): void {
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(cards)").all().map(column => column.name);
  if (!columns.length) return;
  if (!columns.includes("kind")) db.exec("ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'query'");
  if (!columns.includes("config")) db.exec("ALTER TABLE cards ADD COLUMN config TEXT NOT NULL DEFAULT '{}'");
}

/** Adds the days column to an older reminders table. A table that does not exist yet is left for `schema` to create with it already. */
export function migrateReminderColumns(db: Database): void {
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(reminders)").all().map(column => column.name);
  if (!columns.length) return;
  if (!columns.includes("days")) db.exec("ALTER TABLE reminders ADD COLUMN days TEXT NOT NULL DEFAULT '[]'");
}

/** Opens (and creates) a Portfolio database and applies the schema. ":memory:" works for tests. */
export function openDatabase(path: string = defaultDatabasePath(), options: OpenOptions = {}): Database {
  const db = options.readonly ? new Database(path, { readonly: true }) : new Database(path, { create: options.create ?? true, readwrite: true });
  if (options.readonly) return db;
  const schema = options.schema ?? readSchema();
  if (options.migrate ?? true) migrateItemKinds(db, path, schema, options.log);
  migrateCardColumns(db);
  migrateReminderColumns(db);
  const taskColumns = db.query<{ name: string }, []>("PRAGMA table_info(tasks)").all();
  if (taskColumns.length && !taskColumns.some(column => column.name === "parent_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL CHECK (parent_id != id)");
  }
  db.exec(schema);
  db.exec(`INSERT INTO items(type, task_id, title, content, created_at)
    SELECT 'task', tasks.id, tasks.title, tasks.notes, tasks.created_at FROM tasks
    WHERE NOT EXISTS (SELECT 1 FROM items WHERE items.task_id = tasks.id)`);
  return db;
}
