import { killListener, matchPortsToProjects } from "@portfolio/ports";
import { PROJECT_CATEGORY } from "@portfolio/watch";
import { getPortsSnapshot } from "./context.ts";
import type { Ctx } from "./context.ts";
import { error, json, readJson } from "./http.ts";

function projectRefs(ctx: Ctx): { id: number; title: string; path: string }[] {
  const category = ctx.store.categories.findCategory(PROJECT_CATEGORY.name);
  if (!category) return [];
  return ctx.store.categories.categoryMembers(category.id).filter(item => item.path).map(item => ({ id: item.id, title: item.title, path: item.path! }));
}

export async function getPortsRoute(ctx: Ctx): Promise<Response> {
  const snapshot = getPortsSnapshot(ctx);
  return json({ ...snapshot, ports: matchPortsToProjects(snapshot, projectRefs(ctx)) });
}

export async function killPortRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  const pid = Number(body.pid);
  const signal = body.signal === "KILL" ? "KILL" : "TERM";
  // Only scan when the pid could plausibly be a listener; scanning is comparatively expensive.
  if (!Number.isInteger(pid) || pid <= 1) return error(422, "invalid pid");
  if (pid === process.pid) return error(403, "refusing to kill this process");
  const result = killListener(pid, { signal, snapshot: getPortsSnapshot(ctx) });
  if (!result.ok) return error(result.status, result.message);
  return json({ ok: true, pid: result.pid, signal: result.signal });
}
