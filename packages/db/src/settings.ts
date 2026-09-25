import type { Database } from "bun:sqlite";
import type { GithubIgnoredCheckRule, GithubPrView } from "@portfolio/core";

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


export const getGithubIgnoredCheckRules = (db: Database): GithubIgnoredCheckRule[] =>
  JSON.parse(getSetting(db, "github_ignored_check_rules", "[]"));

export function setGithubIgnoredCheckRules(db: Database, rules: GithubIgnoredCheckRule[]): void {
  const unique = new Map<string, GithubIgnoredCheckRule>();
  for (const rule of rules) {
    const repo = rule.repo.trim();
    const check = rule.check.trim();
    const key = `${repo.toLowerCase()}\0${check.toLowerCase()}`;
    if (repo && check && !unique.has(key)) unique.set(key, { repo, check });
  }
  setSetting(db, "github_ignored_check_rules", JSON.stringify([...unique.values()]));
}

export const getGithubPrViews = (db: Database): GithubPrView[] =>
  JSON.parse(getSetting(db, "github_pr_views", "[]"));

export function setGithubPrViews(db: Database, views: GithubPrView[]): void {
  const unique = new Map<string, GithubPrView>();
  for (const view of views) {
    const id = view.id.trim();
    const label = view.label.trim();
    if (id && label) unique.set(id, { id, label, query: view.query.replace(/^\?/, "") });
  }
  setSetting(db, "github_pr_views", JSON.stringify([...unique.values()]));
}

export const getGithubPrDefaultView = (db: Database): string => getSetting(db, "github_pr_default_view", "all");
export const setGithubPrDefaultView = (db: Database, view: string): void => setSetting(db, "github_pr_default_view", view.trim() || "all");

export const getGithubIgnoredRepos = (db: Database): string[] => JSON.parse(getSetting(db, "github_ignored_repos", "[]"));
export const setGithubIgnoredRepos = (db: Database, repos: string[]): void => setSetting(db, "github_ignored_repos", JSON.stringify(Array.from(new Set(repos.map(repo => repo.trim()).filter(Boolean)))));

export const getGithubDirs = (db: Database): string[] => JSON.parse(getSetting(db, "github_dirs", "[]"));
export const setGithubDirs = (db: Database, dirs: string[]): void => setSetting(db, "github_dirs", JSON.stringify(Array.from(new Set(dirs.map(dir => dir.trim()).filter(Boolean)))));

export const getGithubPollMinutes = (db: Database): number => Number(getSetting(db, "github_poll_minutes", "2")) || 2;
export const setGithubPollMinutes = (db: Database, minutes: number): void => setSetting(db, "github_poll_minutes", String(Math.max(1, Math.floor(minutes))));
