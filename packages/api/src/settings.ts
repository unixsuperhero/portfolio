import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Settings } from "@portfolio/core";
import type { Ctx } from "./context.ts";
import { error, json, readJson } from "./http.ts";

export function settingsView(ctx: Ctx): Settings {
  return {
    home_portfolio_id: ctx.store.settings.getHomePortfolioId(),
    pastry_enabled: ctx.store.settings.getFlag("pastry_enabled"),
    watched_directories: ctx.store.watched.listWatchedDirectories().map(d => ({ id: d.id, path: d.path, recursive: Boolean(d.recursive) })),
    project_parents: ctx.store.projects.listProjectParents(),
  };
}

export async function getSettingsRoute(ctx: Ctx): Promise<Response> {
  return json(settingsView(ctx));
}

export async function patchSettingsRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  if ("home_portfolio_id" in body) ctx.store.settings.setHomePortfolioId(body.home_portfolio_id === null ? null : Number(body.home_portfolio_id));
  if ("pastry_enabled" in body) ctx.store.settings.setFlag("pastry_enabled", Boolean(body.pastry_enabled));
  return json(settingsView(ctx));
}

export async function getHomeRoute(ctx: Ctx): Promise<Response> {
  const id = ctx.store.settings.getHomePortfolioId();
  const portfolio = id ? ctx.store.portfolios.getPortfolio(id) : null;
  return json({ portfolio: portfolio ? ctx.store.portfolios.portfolioView(portfolio) : null });
}

export async function directoriesRoute(_ctx: Ctx, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = url.searchParams.get("path");
  if (!requested?.trim()) return error(400, "A directory path is required.");
  if (!isAbsolute(requested)) return error(400, "Directory path must be absolute.");
  const path = resolve(requested);
  let info;
  try {
    info = await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return error(404, "Directory not found.");
    if ((err as NodeJS.ErrnoException).code === "EACCES" || (err as NodeJS.ErrnoException).code === "EPERM") return error(403, "Directory is not readable.");
    return error(500, "The directory could not be read.");
  }
  if (!info.isDirectory()) return error(422, "Path is not a directory.");
  const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name));
  const directories = entries.filter(entry => entry.isDirectory()).map(entry => ({ name: entry.name, path: resolve(path, entry.name) }));
  const files = url.searchParams.has("files") ? entries.filter(entry => entry.isFile() && !entry.name.startsWith(".")).map(entry => ({ name: entry.name, path: resolve(path, entry.name) })) : undefined;
  const parent = dirname(path);
  return json({ path, parent: parent === path ? null : parent, directories, files });
}
