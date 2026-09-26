import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import { detect, documentTitle, firstHeading, isHtmlPath, isMarkdownPath, ITEM_TYPES, itemHref, parseTags } from "@portfolio/core";
import type { ItemFilter, ItemType } from "@portfolio/core";
import type { ItemPatch, NewItem } from "@portfolio/db";
import type { Ctx } from "./context.ts";
import { bool, error, json, notFound, num, readJson } from "./http.ts";
import { pathAndCategory, runPathAction } from "./paths.ts";
import { getProjectView } from "./projects.ts";

const tagsFromInput = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.map(v => String(v).trim()).filter(Boolean))] : parseTags(value));

function filterFromUrl(url: URL): ItemFilter {
  const type = url.searchParams.get("type");
  return {
    q: url.searchParams.get("q") ?? undefined,
    contents: bool(url.searchParams.get("contents")),
    type: type && (ITEM_TYPES as readonly string[]).includes(type) ? (type as ItemType) : undefined,
    tag: num(url.searchParams.get("tag")),
    tagName: url.searchParams.get("tagName") ?? undefined,
    pinned: bool(url.searchParams.get("pinned")) || undefined,
    starred: bool(url.searchParams.get("starred")) || undefined,
    category: num(url.searchParams.get("category")),
    limit: num(url.searchParams.get("limit")),
  };
}

export async function listItemsRoute(ctx: Ctx, request: Request): Promise<Response> {
  const filter = filterFromUrl(new URL(request.url));
  const items = ctx.store.items.listItems(filter);
  return json({ items: ctx.store.items.viewItems(items) });
}

async function importDocument(ctx: Ctx, path: string): Promise<number> {
  const content = await Bun.file(path).text();
  const html = isHtmlPath(path);
  const title = documentTitle(content, path);
  const id = ctx.store.items.upsertItem({ type: "document", title, description: "", content: html ? "" : content, rendered_html: html ? content : "", url: null, source_path: path, toc: 1 });
  if (!html) ctx.store.items.setRenderedHtml(id, await ctx.render(content, { title, toc: true, sourcePath: path }));
  return id;
}

export async function createItemRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  const type = ((body.type as ItemType) || "document") as ItemType;
  const content = String(body.content ?? "");
  const sourcePath = (body.source_path as string) || null;
  let extra: { path: string | null; categoryId: number | null };
  try {
    extra = pathAndCategory(ctx, type, body as { path?: string; category?: string });
  } catch (err) {
    return error(422, (err as Error).message);
  }
  let title = String(body.title ?? "").trim() || (extra.path ? basename(extra.path) : "");
  if (!title && content) title = firstHeading(content) ?? "Untitled";
  if (!title) return error(422, "title is required");
  const toc = body.toc === false || body.toc === "false" || body.toc === "0" ? 0 : 1;
  const id = ctx.store.items.upsertItem({ type, title, description: String(body.description ?? ""), content, rendered_html: "", url: (body.url as string) || null, source_path: sourcePath, toc });
  if ((type === "document" || type === "note") && content) ctx.store.items.setRenderedHtml(id, await ctx.render(content, { title, toc: Boolean(toc), sourcePath: sourcePath ?? undefined }));
  ctx.store.items.setPathAndCategory(id, extra.path, extra.categoryId);
  ctx.store.tags.setTags(id, tagsFromInput(body.tags));
  const item = ctx.store.items.getItem(id)!;
  return json({ id, href: itemHref(item) }, 201);
}

export async function getItemRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  const item = ctx.store.items.getItem(Number(params.id));
  if (!item) return notFound();
  const view = ctx.store.items.viewItem(item);
  const slots = ctx.store.categories.memberSlots(item, ctx.home);
  const project = getProjectView(ctx, item.id);
  let editableMarkdown = (item.type === "document" || item.type === "note") && (!item.source_path || isMarkdownPath(item.source_path));
  let content = item.content;
  let sourceError: string | null = null;
  if (editableMarkdown && item.source_path) {
    const source = Bun.file(item.source_path);
    if (!await source.exists()) {
      editableMarkdown = false;
      sourceError = "Markdown source file is missing";
    } else {
      content = await source.text();
      if (content !== item.content) {
        item.rendered_html = await ctx.render(content, { title: item.title, toc: Boolean(item.toc), sourcePath: item.source_path });
        ctx.store.items.updateItem(item.id, { content, rendered_html: item.rendered_html });
      }
    }
  }
  return json({ ...item, content, editable_markdown: editableMarkdown, source_error: sourceError, slot_paths: undefined, href: view.href, tags: view.tags, slots, project });
}

export async function patchItemRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  const item = ctx.store.items.getItem(id);
  if (!item) return notFound();
  const body = await readJson(request);
  if ("content" in body && body.type !== undefined && body.type !== item.type) return error(422, "content edits cannot change item type");
  if (body.type !== undefined && body.type !== item.type && (body.type === "task" || item.type === "task")) {
    return error(422, "create a new task instead of changing an item's type to or from task");
  }
  let categoryId = item.category_id;
  if ("category_id" in body) {
    if (body.category_id === null) categoryId = null;
    else {
      if (typeof body.category_id !== "number" || !Number.isSafeInteger(body.category_id) || body.category_id <= 0) return error(422, "category_id must be a positive integer or null");
      const category = ctx.store.categories.getCategory(body.category_id);
      if (!category) return error(422, "category not found");
      if (category.kind !== (body.type ?? item.type)) return error(422, `category requires items of type ${category.kind}`);
      categoryId = category.id;
    }
  }
  let renderedHtml: string | undefined;
  if ("content" in body) {
    if (typeof body.content !== "string") return error(422, "content must be a string");
    if (item.type === "document" || item.type === "note") {
      if (item.source_path && !isMarkdownPath(item.source_path)) return error(422, "source is not a Markdown file");
      if (item.source_path && Object.keys(body).some(key => key !== "content" && key !== "expected_content")) return error(422, "source-backed Markdown edits accept content only");
      const source = item.source_path ? Bun.file(item.source_path) : null;
      if (source && !await source.exists()) return error(409, "Markdown source file is missing");
      if (source) {
        if (typeof body.expected_content !== "string") return error(422, "expected_content is required for source-backed Markdown");
        if (await source.text() !== body.expected_content) return error(409, "Markdown source changed on disk; reload before saving");
      }
      renderedHtml = await ctx.render(body.content, {
        title: typeof body.title === "string" ? body.title : item.title,
        toc: Boolean(item.toc),
        sourcePath: item.source_path ?? undefined,
      });
      if (item.source_path) await Bun.write(item.source_path, body.content);
    }
  }
  const { tags, expected_content: _expectedContent, ...patch } = body as ItemPatch & { tags?: unknown; expected_content?: unknown };
  if ("content" in patch) patch.rendered_html = renderedHtml ?? "";
  ctx.store.items.updateItem(id, patch);
  if ("category_id" in body) ctx.store.items.setPathAndCategory(id, item.path, categoryId);
  if (tags !== undefined) {
    const desired = tagsFromInput(tags);
    const current = ctx.store.tags.tagNamesFor(id);
    const toRemove = current.filter(name => !desired.some(d => d.toLowerCase() === name.toLowerCase()));
    if (toRemove.length) ctx.store.tags.removeTags(id, toRemove);
    if (desired.length) ctx.store.tags.setTags(id, desired);
  }
  return json({ ok: true, rendered_html: renderedHtml });
}

export async function deleteItemRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  const item = ctx.store.items.getItem(id);
  if (!item) return notFound();
  if (bool(new URL(request.url).searchParams.get("delete_files")) && item.source_path) {
    try {
      await unlink(item.source_path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  ctx.store.items.deleteItems([id]);
  return json({ ok: true });
}

export async function itemHtmlRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  const item = ctx.store.items.getItem(Number(params.id));
  if (!item) return notFound();
  let html = item.rendered_html;
  if (!html && item.content) {
    html = await ctx.render(item.content, { title: item.title, toc: Boolean(item.toc), sourcePath: item.source_path ?? undefined });
    ctx.store.items.setRenderedHtml(item.id, html);
  }
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function toggleItemRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  const body = await readJson(request);
  const field = body.field;
  if (field !== "pinned" && field !== "starred") return error(422, "invalid field");
  if (!ctx.store.items.toggleItemField(id, field)) return notFound();
  const item = ctx.store.items.getItem(id)!;
  return json({ ok: true, value: Boolean(item[field]) });
}

export async function addTagsRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  if (!ctx.store.items.getItem(id)) return notFound();
  const body = await readJson(request);
  ctx.store.tags.setTags(id, tagsFromInput(body.tags));
  return json({ tags: ctx.store.tags.tagNamesFor(id) });
}

export async function removeTagRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  if (!ctx.store.items.getItem(id)) return notFound();
  ctx.store.tags.removeTags(id, [decodeURIComponent(params.name)]);
  return json({ tags: ctx.store.tags.tagNamesFor(id) });
}

export async function pathActionRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const item = ctx.store.items.getItem(Number(params.id));
  if (!item) return notFound();
  const body = await readJson(request);
  const action = String(body.action ?? "");
  const slotName = body.slot as string | undefined;
  const slots = ctx.store.categories.memberSlots(item, ctx.home);
  const slot = slotName ? slots.find(candidate => candidate.name === slotName) : null;
  if (slotName && !slot) return error(404, "no such slot");
  const target = slot ?? (item.type === "file" || item.type === "dir" ? { kind: item.type, path: item.path } : null);
  if (!target?.path) return error(422, "nothing to act on");
  if (!["copy", "reveal", "open", "create"].includes(action)) return error(422, "invalid action");
  await runPathAction(action, { kind: target.kind as "file" | "dir", path: target.path });
  return json({ ok: true, path: target.path });
}

export async function slotPathRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const item = ctx.store.items.getItem(Number(params.id));
  if (!item) return notFound();
  const body = await readJson(request);
  const slotName = String(body.slot ?? "");
  if (!slotName) return error(422, "slot is required");
  const slots = ctx.store.categories.memberSlots(item, ctx.home);
  if (!slots.find(candidate => candidate.name === slotName)) return error(404, "no such slot");
  ctx.store.categories.setSlotOverride(item, slotName, String(body.path ?? ""));
  const refreshed = ctx.store.items.getItem(item.id)!;
  return json({ slots: ctx.store.categories.memberSlots(refreshed, ctx.home) });
}

export async function detectRoute(ctx: Ctx, request: Request): Promise<Response> {
  const content = new URL(request.url).searchParams.get("content") ?? "";
  try {
    return json(await detect(content, { home: ctx.home }));
  } catch (err) {
    return json({ type: "note", title: "Untitled", shape: "text", error: (err as Error).message });
  }
}

export async function quickAddRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  const detected = await detect(String(body.content ?? ""), { home: ctx.home });
  const type = ((body.type as ItemType) || detected.type) as ItemType;
  if (!(ITEM_TYPES as readonly string[]).includes(type)) return error(422, "invalid item type");
  const tags = tagsFromInput(body.tags);
  const insert = (extra: Partial<NewItem> & { type: ItemType }) => ctx.store.items.upsertItem({ description: "", content: "", rendered_html: "", url: null, source_path: null, toc: 1, title: detected.title, ...extra });
  let id: number;
  if (type === "link" || type === "pr") {
    if (detected.shape !== "url") return error(422, `a ${type === "pr" ? "PR" : "link"} needs a URL`);
    id = insert({ type, url: detected.url });
  } else if (type === "file" || type === "dir") {
    if (detected.shape !== "path") return error(422, `a ${type} needs an absolute path`);
    if (ctx.store.items.findItemByPath(detected.path!)) return error(422, "another item already tracks that path");
    id = insert({ type });
    ctx.store.items.setPathAndCategory(id, detected.path!, null);
  } else if (type === "document" && detected.shape === "path") {
    if (!detected.exists) return error(422, "that file does not exist yet");
    id = await importDocument(ctx, detected.path!);
  } else if (type === "task") {
    if (detected.shape !== "text") return error(422, "a task needs some text");
    id = insert({ type, content: detected.content });
  } else {
    if (detected.shape !== "text") return error(422, `a ${type} needs some text`);
    id = insert({ type, content: detected.content, rendered_html: await ctx.render(detected.content!, { title: detected.title, toc: true }) });
  }
  ctx.store.tags.setTags(id, tags);
  const item = ctx.store.items.getItem(id)!;
  return json({ id, href: itemHref(item), type, title: detected.title }, 201);
}

export async function tagsListRoute(ctx: Ctx): Promise<Response> {
  return json({ tags: ctx.store.tags.listTags() });
}
