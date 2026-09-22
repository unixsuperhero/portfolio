import { stat } from "node:fs/promises";
import { normalizeItemPath } from "@portfolio/core";
import type { Ctx } from "./context.ts";
import { error, json, readJson } from "./http.ts";

/** Resolves and validates a watched-directory path, the way app.js's normalizeWatchedPath does. */
async function normalizeWatchedPath(ctx: Ctx, value: string): Promise<string> {
  const path = normalizeItemPath(value, ctx.home);
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error("Path is not a directory.");
  return path;
}

export async function addWatchedDirectoryRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  let path: string;
  try {
    path = await normalizeWatchedPath(ctx, String(body.path ?? ""));
  } catch (err) {
    return error(422, (err as Error).message);
  }
  let id: number;
  try {
    id = ctx.store.watched.addWatchedDirectory(path, Boolean(body.recursive));
  } catch (err) {
    return error(422, (err as Error).message);
  }
  if (ctx.watcher) await ctx.watcher.reload();
  return json({ id }, 201);
}

export async function removeWatchedDirectoryRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  ctx.store.watched.removeWatchedDirectory(Number(params.id));
  if (ctx.watcher) await ctx.watcher.reload();
  return json({ ok: true });
}

export async function syncWatchedDirectoriesRoute(ctx: Ctx): Promise<Response> {
  if (ctx.watcher) await ctx.watcher.reload();
  return json({ ok: true });
}
