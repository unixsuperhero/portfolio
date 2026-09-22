import { normalizeItemPath } from "@portfolio/core";
import type { Category, Item, ProjectView } from "@portfolio/core";
import { PROJECT_CATEGORY, projectServices, scanProjects } from "@portfolio/watch";
import { getPortsSnapshot } from "./context.ts";
import type { Ctx } from "./context.ts";
import { error, json, notFound, readJson } from "./http.ts";

const projectCategory = (ctx: Ctx): Category | null => ctx.store.categories.findCategory(PROJECT_CATEGORY.name);

function toProjectView(ctx: Ctx, item: Item): ProjectView {
  const snapshot = getPortsSnapshot(ctx);
  const path = item.path ?? "";
  return {
    id: item.id,
    title: item.title,
    path,
    description: item.description,
    tags: ctx.store.tags.tagNamesFor(item.id),
    created_at: item.created_at,
    updated_at: item.updated_at,
    services: projectServices(path),
    ports: snapshot.ports.filter(entry => entry.cwd === path || entry.cwd.startsWith(`${path}/`)),
    slots: ctx.store.categories.memberSlots(item, ctx.home),
  };
}

/** Every dir item in the "project" category. */
export function listProjectViews(ctx: Ctx): ProjectView[] {
  const category = projectCategory(ctx);
  if (!category) return [];
  return ctx.store.categories.categoryMembers(category.id).map(item => toProjectView(ctx, item));
}

/** null unless the item is a dir in the "project" category. */
export function getProjectView(ctx: Ctx, id: number): ProjectView | null {
  const item = ctx.store.items.getItem(id);
  const category = projectCategory(ctx);
  if (!item || !category || item.type !== "dir" || item.category_id !== category.id) return null;
  return toProjectView(ctx, item);
}

export async function listProjectsRoute(ctx: Ctx): Promise<Response> {
  return json({ projects: listProjectViews(ctx) });
}

export async function getProjectRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  const view = getProjectView(ctx, Number(params.id));
  return view ? json(view) : notFound();
}

export async function scanProjectsRoute(ctx: Ctx): Promise<Response> {
  return json({ added: await scanProjects(ctx.store.db, ctx.home) });
}

export async function listProjectParentsRoute(ctx: Ctx): Promise<Response> {
  return json({ parents: ctx.store.projects.listProjectParents() });
}

export async function addProjectParentRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  let path: string;
  try {
    path = normalizeItemPath(String(body.path ?? ""), ctx.home);
  } catch (err) {
    return error(422, (err as Error).message);
  }
  ctx.store.projects.addProjectParent(path);
  return json({ ok: true }, 201);
}

export async function removeProjectParentRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  return json({ ok: ctx.store.projects.removeProjectParent(Number(params.id)) });
}
