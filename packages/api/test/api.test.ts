import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "@portfolio/db";
import type { PortsSnapshot } from "@portfolio/ports";
import { createApi } from "../src/index.ts";

const fakeRender = async (markdown: string, options: { title: string }) => `<h1>${options.title}</h1>${markdown.length}`;

const fakeSnapshot: PortsSnapshot = { scanned_at: "t", herdr_available: false, warnings: [], ports: [] };

function makeApi(options: { home?: string } = {}) {
  const store = openStore(":memory:");
  const api = createApi(store, { render: fakeRender, home: options.home ?? "/home/test", scanPorts: () => fakeSnapshot });
  return { store, api };
}

const get = (api: (r: Request) => Promise<Response>, path: string) => api(new Request(`http://x${path}`));
const send = (api: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown) =>
  api(new Request(`http://x${path}`, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }));

describe("health", () => {
  test("GET /health", async () => {
    const { api } = makeApi();
    const res = await get(api, "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, items: 0 });
  });
});

describe("items", () => {
  test("list, create, get, patch, tags, toggle, delete", async () => {
    const { store, api } = makeApi();
    let res = await send(api, "POST", "/api/items", { type: "note", title: "Hello", content: "body", tags: "a,b" });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ href: `/items/${created.id}` });

    res = await get(api, "/api/items");
    expect((await res.json()).items).toHaveLength(1);

    res = await get(api, `/api/items/${created.id}`);
    const detail = await res.json();
    expect(detail).toMatchObject({ title: "Hello", tags: ["a", "b"], project: null });
    expect(detail.slot_paths).toBeUndefined();

    res = await send(api, "PATCH", `/api/items/${created.id}`, { title: "Updated", tags: ["b", "c"] });
    expect(res.status).toBe(200);
    res = await get(api, `/api/items/${created.id}`);
    expect(await res.json()).toMatchObject({ title: "Updated", tags: ["b", "c"] });

    res = await send(api, "POST", `/api/items/${created.id}/toggle`, { field: "pinned" });
    expect(await res.json()).toEqual({ ok: true, value: true });

    res = await send(api, "POST", `/api/items/${created.id}/tags`, { tags: ["z"] });
    expect((await res.json()).tags).toContain("z");

    res = await api(new Request(`http://x/api/items/${created.id}/tags/z`, { method: "DELETE" }));
    expect((await res.json()).tags).not.toContain("z");

    res = await get(api, `/api/items/${created.id}/html`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<h1>Hello</h1>4");
    expect(store.items.getItem(created.id)?.rendered_html).toBe("<h1>Hello</h1>4");

    res = await send(api, "DELETE", `/api/items/${created.id}`);
    expect(await res.json()).toEqual({ ok: true });
    res = await get(api, `/api/items/${created.id}`);
    expect(res.status).toBe(404);
  });

  test("category changes preserve paths and reject incompatible assignments before editing", async () => {
    const { store, api } = makeApi();
    try {
      const category = store.categories.createCategory({ name: "Folders", kind: "dir", slots: [] });
      const incompatible = store.categories.createCategory({ name: "Notes", kind: "note", slots: [] });
      const id = store.items.upsertItem({ type: "dir", title: "Work" });
      store.items.setPathAndCategory(id, "/tmp/work", null);
      expect((await send(api, "PATCH", `/api/items/${id}`, { category_id: category })).status).toBe(200);
      expect((await (await get(api, `/api/categories/${category}`)).json()).members.map((item: { title: string }) => item.title)).toEqual(["Work"]);
      expect((await send(api, "PATCH", `/api/items/${id}`, { category_id: incompatible, title: "Must not change" })).status).toBe(422);
      expect((await (await get(api, `/api/items/${id}`)).json())).toMatchObject({ title: "Work", path: "/tmp/work", category_id: category });
      expect((await send(api, "PATCH", `/api/items/${id}`, { category_id: null })).status).toBe(200);
      expect((await (await get(api, `/api/categories/${category}`)).json()).members).toEqual([]);
      expect((await (await get(api, `/api/items/${id}`)).json()).path).toBe("/tmp/work");
    } finally { store.close(); }
  });

  test("errors: missing title, toggle on bad field, not found", async () => {
    const { api } = makeApi();
    let res = await send(api, "POST", "/api/items", { type: "note", content: "" });
    expect(res.status).toBe(422);
    res = await send(api, "POST", "/api/items/9999/toggle", { field: "bogus" });
    expect(res.status).toBe(422);
    res = await get(api, "/api/items/9999");
    expect(res.status).toBe(404);
    res = await send(api, "DELETE", "/api/items/9999");
    expect(res.status).toBe(404);
  });

  test("path-action and slot-path on a category member", async () => {
    const dir = mkdtempSync(join(tmpdir(), "api-path-"));
    const { store, api } = makeApi({ home: dir });
    const categoryId = store.categories.createCategory({ name: "project", kind: "dir", slots: [{ name: "tasks", kind: "file", path: "TASKS.md" }] });
    const id = store.items.upsertItem({ type: "dir", title: "app" });
    store.items.setPathAndCategory(id, join(dir, "app"), categoryId);

    let res = await send(api, "POST", `/api/items/${id}/path-action`, { action: "create" });
    expect(await res.json()).toMatchObject({ ok: true });

    res = await send(api, "POST", `/api/items/${id}/path-action`, { action: "create", slot: "tasks" });
    expect(await res.json()).toMatchObject({ ok: true, path: join(dir, "app", "TASKS.md") });

    res = await send(api, "POST", `/api/items/${id}/slot-path`, { slot: "tasks", path: join(dir, "other", "T.md") });
    const body = await res.json();
    expect(body.slots.find((s: { name: string }) => s.name === "tasks")).toMatchObject({ overridden: true });

    res = await send(api, "POST", `/api/items/${id}/path-action`, { action: "bogus" });
    expect(res.status).toBe(422);
    res = await send(api, "POST", `/api/items/${id}/slot-path`, { slot: "nope", path: "" });
    expect(res.status).toBe(404);
  });

  test("detect and quick", async () => {
    const { api } = makeApi();
    let res = await get(api, "/api/detect?content=" + encodeURIComponent("https://example.com/pull/1"));
    expect((await res.json()).type).toBe("pr");

    res = await send(api, "POST", "/api/quick", { content: "just some notes", tags: "x" });
    expect(res.status).toBe(201);
    const quick = await res.json();
    expect(quick).toMatchObject({ type: "note" });

    res = await send(api, "POST", "/api/quick", { content: "plain text, not a url", type: "pr" });
    expect(res.status).toBe(422);
  });

  test("tags list", async () => {
    const { store, api } = makeApi();
    const id = store.items.upsertItem({ type: "note", title: "n" });
    store.tags.setTags(id, ["a"]);
    const res = await get(api, "/api/tags");
    expect((await res.json()).tags).toMatchObject([{ name: "a", count: 1 }]);
  });
});

describe("portfolios and cards", () => {
  test("create portfolio, add card, view, move, delete", async () => {
    const { api } = makeApi();
    let res = await send(api, "POST", "/api/portfolios", { name: "Dash" });
    expect(res.status).toBe(201);
    const { id: portfolioId } = await res.json();

    res = await send(api, "POST", `/api/portfolios/${portfolioId}/cards`, { title: "Clock", kind: "clock", config: { format: "24h" } });
    expect(res.status).toBe(201);
    const { id: cardId } = await res.json();

    res = await get(api, `/api/portfolios/${portfolioId}`);
    const view = await res.json();
    expect(view.cards[0]).toMatchObject({ kind: "clock", items: [], total: 0 });

    res = await send(api, "PATCH", `/api/cards/${cardId}`, { title: "Clock 2", kind: "clock" });
    expect(await res.json()).toEqual({ ok: true });

    res = await send(api, "POST", `/api/portfolios/${portfolioId}/cards`, { title: "Second" });
    const { id: second } = await res.json();
    res = await send(api, "POST", `/api/cards/${second}/move`, { direction: "left" });
    expect((await res.json()).ok).toBe(true);

    res = await send(api, "PATCH", `/api/portfolios/${portfolioId}`, { name: "Dash 2" });
    expect(await res.json()).toEqual({ ok: true });

    res = await send(api, "DELETE", `/api/cards/${cardId}`);
    expect(await res.json()).toEqual({ ok: true });

    res = await get(api, "/api/portfolios");
    expect((await res.json()).portfolios).toHaveLength(1);

    res = await send(api, "DELETE", `/api/portfolios/${portfolioId}`);
    expect(await res.json()).toEqual({ ok: true });
    res = await get(api, `/api/portfolios/${portfolioId}`);
    expect(res.status).toBe(404);
  });

  test("errors: duplicate name, missing card title, bad portfolio", async () => {
    const { api } = makeApi();
    await send(api, "POST", "/api/portfolios", { name: "Dup" });
    let res = await send(api, "POST", "/api/portfolios", { name: "Dup" });
    expect(res.status).toBe(422);
    res = await send(api, "POST", "/api/portfolios/9999/cards", { title: "x" });
    expect(res.status).toBe(404);
  });
});

describe("categories", () => {
  test("create, get with members, patch, delete", async () => {
    const { store, api } = makeApi();
    let res = await send(api, "POST", "/api/categories", { name: "docs", kind: "document", slots: "" });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const itemId = store.items.upsertItem({ type: "document", title: "d", content: "x" });
    store.items.setPathAndCategory(itemId, null, id);

    res = await get(api, `/api/categories/${id}`);
    const body = await res.json();
    expect(body.members).toHaveLength(1);

    res = await send(api, "PATCH", `/api/categories/${id}`, { name: "docs2" });
    expect(await res.json()).toEqual({ ok: true });

    res = await send(api, "DELETE", `/api/categories/${id}`);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("errors: bad kind, not found", async () => {
    const { api } = makeApi();
    let res = await send(api, "POST", "/api/categories", { name: "x", kind: "bogus" });
    expect(res.status).toBe(422);
    res = await get(api, "/api/categories/9999");
    expect(res.status).toBe(404);
  });
});

describe("settings and home", () => {
  test("get, patch, home with no portfolio, directories listing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "api-dirs-"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "f.txt"), "x");
    const { api } = makeApi();
    let res = await get(api, "/api/settings");
    expect(await res.json()).toMatchObject({ home_portfolio_id: null, pastry_enabled: false });

    res = await get(api, "/api/home");
    expect(await res.json()).toEqual({ portfolio: null });

    res = await send(api, "POST", "/api/portfolios", { name: "Home" });
    const { id } = await res.json();
    res = await send(api, "PATCH", "/api/settings", { home_portfolio_id: id });
    expect((await res.json()).home_portfolio_id).toBe(id);
    res = await get(api, "/api/home");
    expect((await res.json()).portfolio).toMatchObject({ name: "Home" });

    res = await get(api, `/api/directories?path=${encodeURIComponent(dir)}`);
    const listing = await res.json();
    expect(listing.directories).toEqual([{ name: "sub", path: join(dir, "sub") }]);

    res = await get(api, "/api/directories?path=relative");
    expect(res.status).toBe(400);
    res = await get(api, `/api/directories?path=${encodeURIComponent(join(dir, "missing"))}`);
    expect(res.status).toBe(404);
  });
});

describe("ports", () => {
  test("GET /api/ports returns a snapshot shape even when the scanner is unavailable", async () => {
    const { api } = makeApi();
    const res = await get(api, "/api/ports");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.ports)).toBe(true);
  });

  test("POST /api/ports/kill rejects an invalid pid", async () => {
    const { api } = makeApi();
    const res = await send(api, "POST", "/api/ports/kill", { pid: 0 });
    expect(res.status).toBe(422);
  });
});

describe("projects and project parents", () => {
  test("list, get 404 for a non-project item, project-parents CRUD", async () => {
    const { store, api } = makeApi();
    let res = await get(api, "/api/projects");
    expect(await res.json()).toEqual({ projects: [] });

    const noteId = store.items.upsertItem({ type: "note", title: "n" });
    res = await get(api, `/api/projects/${noteId}`);
    expect(res.status).toBe(404);

    const dir = mkdtempSync(join(tmpdir(), "api-proj-"));
    res = await send(api, "POST", "/api/project-parents", { path: dir });
    expect(res.status).toBe(201);
    res = await get(api, "/api/project-parents");
    const { parents } = await res.json();
    expect(parents).toHaveLength(1);

    res = await send(api, "DELETE", `/api/project-parents/${parents[0].id}`);
    expect(await res.json()).toEqual({ ok: true });

    res = await send(api, "POST", "/api/projects/scan");
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).added)).toBe(true);
  });
});

describe("tasks and reminders", () => {
  test("create, get with history, complete/uncomplete, patch, delete", async () => {
    const { api } = makeApi();
    let res = await send(api, "POST", "/api/tasks", { title: "Stretch", recurrence: "daily", reminders: ["08:30"] });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    res = await get(api, `/api/tasks/${id}`);
    const detail = await res.json();
    expect(detail).toMatchObject({ title: "Stretch", reminders: [{ at: "08:30" }] });
    expect(detail.history).toEqual([]);

    res = await send(api, "POST", `/api/tasks/${id}/complete`, {});
    expect((await res.json()).completed_today).toBe(true);

    res = await send(api, "POST", `/api/tasks/${id}/uncomplete`, {});
    expect((await res.json()).completed_today).toBe(false);

    res = await send(api, "PATCH", `/api/tasks/${id}`, { active: false });
    expect(await res.json()).toEqual({ ok: true });

    res = await get(api, "/api/tasks");
    expect((await res.json()).tasks).toHaveLength(0);
    res = await get(api, "/api/tasks?all=1");
    expect((await res.json()).tasks).toHaveLength(1);

    res = await send(api, "DELETE", `/api/tasks/${id}`);
    expect(await res.json()).toEqual({ ok: true });
    res = await get(api, `/api/tasks/${id}`);
    expect(res.status).toBe(404);
  });

  test("create with weekday reminders and read them back; PATCH replaces reminders", async () => {
    const { api } = makeApi();
    let res = await send(api, "POST", "/api/tasks", { title: "Standup", recurrence: "daily", reminders: [{ at: "08:30", days: [1, 3, 5] }] });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    res = await get(api, `/api/tasks/${id}`);
    const detail = await res.json();
    expect(detail.reminders).toEqual([{ id: expect.any(Number), at: "08:30", days: [1, 3, 5] }]);

    res = await send(api, "PATCH", `/api/tasks/${id}`, { reminders: [{ at: "09:00", days: [] }] });
    expect(await res.json()).toEqual({ ok: true });
    res = await get(api, `/api/tasks/${id}`);
    expect((await res.json()).reminders).toEqual([{ id: expect.any(Number), at: "09:00", days: [] }]);
  });

  test("errors and standalone reminders", async () => {
    const { api, store } = makeApi();
    let res = await send(api, "POST", "/api/tasks", { title: "", recurrence: "daily" });
    expect(res.status).toBe(422);
    res = await send(api, "POST", "/api/tasks", { title: "x", recurrence: "weekly" });
    expect(res.status).toBe(422);

    res = await send(api, "POST", "/api/reminders", { title: "Water", recurrence: "daily", at: "08:30" });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(store.tasks.listTasks({ all: true })).toHaveLength(0);
    res = await get(api, `/api/reminders/${id}`);
    expect(await res.json()).toMatchObject({ id, title: "Water", task_id: null, at: "08:30" });
    res = await get(api, "/api/reminders/today");
    expect((await res.json()).reminders).toEqual([expect.objectContaining({ id, task_id: null })]);
    res = await get(api, "/api/reminders/due?minutes=1440");
    expect((await res.json()).due.map((entry: { reminder: { id: number } }) => entry.reminder.id)).toContain(id);
    res = await send(api, "POST", `/api/reminders/${id}/complete`, { on: "2026-09-22" });
    expect((await res.json()).completed_today).toBe(true);
    res = await send(api, "PATCH", `/api/reminders/${id}`, { title: "Drink water" });
    expect(await res.json()).toEqual({ ok: true });
    res = await send(api, "DELETE", `/api/reminders/${id}`);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("watched directories", () => {
  test("add, sync, remove", async () => {
    const dir = mkdtempSync(join(tmpdir(), "api-watch-"));
    const { api } = makeApi();
    let res = await send(api, "POST", "/api/watched-directories", { path: dir, recursive: true });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    res = await send(api, "POST", "/api/watched-directories/sync");
    expect(await res.json()).toEqual({ ok: true });

    res = await send(api, "DELETE", `/api/watched-directories/${id}`);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("errors: relative path, missing directory", async () => {
    const { api } = makeApi();
    let res = await send(api, "POST", "/api/watched-directories", { path: "relative" });
    expect(res.status).toBe(422);
    res = await send(api, "POST", "/api/watched-directories", { path: join(tmpdir(), "does-not-exist-xyz") });
    expect(res.status).toBe(422);
  });
});

describe("cors and unknown routes", () => {
  test("unknown route is a 404 JSON error", async () => {
    const { api } = makeApi();
    const res = await get(api, "/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
