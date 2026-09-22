import { isItemType, parseSlots } from "@portfolio/core";
import type { Slot } from "@portfolio/core";
import type { Ctx } from "./context.ts";
import { error, json, notFound, readJson } from "./http.ts";

const slotsFromBody = (value: unknown): Slot[] | string => (typeof value === "string" ? value : (value as Slot[] | undefined) ?? []);

export async function listCategoriesRoute(ctx: Ctx): Promise<Response> {
  return json({ categories: ctx.store.categories.listCategories() });
}

export async function createCategoryRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  const name = String(body.name ?? "");
  const kind = body.kind;
  if (!isItemType(kind)) return error(422, "invalid kind");
  try {
    const slots = typeof body.slots === "string" ? parseSlots(body.slots) : slotsFromBody(body.slots);
    const id = ctx.store.categories.createCategory({ name, kind, slots });
    return json({ id }, 201);
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function getCategoryRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  const category = ctx.store.categories.getCategory(Number(params.id));
  if (!category) return notFound();
  const members = ctx.store.items.viewItems(ctx.store.categories.categoryMembers(category.id));
  return json({ ...category, members });
}

export async function patchCategoryRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  const body = await readJson(request);
  if (body.kind !== undefined && !isItemType(body.kind)) return error(422, "invalid kind");
  try {
    const ok = ctx.store.categories.updateCategory(id, {
      name: body.name as string | undefined,
      kind: body.kind as never,
      slots: body.slots !== undefined ? slotsFromBody(body.slots) : undefined,
    });
    return ok ? json({ ok: true }) : notFound();
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function deleteCategoryRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  return json({ ok: ctx.store.categories.deleteCategory(Number(params.id)) });
}
