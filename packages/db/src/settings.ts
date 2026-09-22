import type { Database } from "bun:sqlite";

export const getSetting = (db: Database, key: string, fallback = ""): string => db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;
export const setSetting = (db: Database, key: string, value: string): void => { db.query("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value); };
export const listSettings = (db: Database): Record<string, string> => Object.fromEntries(db.query<{ key: string; value: string }, []>("SELECT key, value FROM settings ORDER BY key").all().map(row => [row.key, row.value]));
export const getFlag = (db: Database, key: string): boolean => getSetting(db, key) === "1";
export const setFlag = (db: Database, key: string, value: boolean): void => setSetting(db, key, value ? "1" : "0");

export const getHomePortfolioId = (db: Database): number | null => {
  const value = getSetting(db, "home_portfolio_id", "");
  return value ? Number(value) : null;
};

export const setHomePortfolioId = (db: Database, id: number | null): void => {
  if (id === null) db.query("DELETE FROM settings WHERE key = 'home_portfolio_id'").run();
  else setSetting(db, "home_portfolio_id", String(id));
};
