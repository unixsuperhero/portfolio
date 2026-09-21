import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "portfolio-categories-"));
const fixture = join(directory, "app");
const dbPath = join(directory, "portfolio.sqlite");
const actionLog = join(directory, "actions.log");
let serverUrl;
let server;

const post = (path, fields) => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return fetch(`${serverUrl}${path}`, { method: "POST", body, redirect: "manual" });
};
const item = async id => (await fetch(`${serverUrl}/api/items/${id}`)).json();
const items = async () => (await (await fetch(`${serverUrl}/api/items?limit=100`)).json()).items;

beforeAll(async () => {
  await Promise.all([mkdir(join(fixture, "templates"), { recursive: true }), mkdir(join(fixture, "public"), { recursive: true }), mkdir(join(directory, "bin"))]);
  await Promise.all([
    copyFile(join(root, "app.js"), join(fixture, "app.js")),
    copyFile(join(root, "schema.sql"), join(fixture, "schema.sql")),
    copyFile(join(root, "templates", "document.html"), join(fixture, "templates", "document.html")),
    copyFile(join(root, "public", "app.css"), join(fixture, "public", "app.css")),
    writeFile(join(directory, "bin", "open"), `#!/bin/sh\necho "open $*" >> ${actionLog}\n`),
    writeFile(join(directory, "bin", "pbcopy"), `#!/bin/sh\nprintf 'pbcopy %s\\n' "$(cat)" >> ${actionLog}\n`),
  ]);
  await Promise.all([chmod(join(directory, "bin", "open"), 0o755), chmod(join(directory, "bin", "pbcopy"), 0o755)]);

  // A database from before file and dir types, with a tagged document in it.
  const old = new Database(dbPath, { create: true });
  old.exec((await readFile(join(root, "schema.sql"), "utf8")).replace("'pr', 'file', 'dir'", "'pr'").replace(/\n  path TEXT,\n  category_id[^\n]*\n  slot_paths[^\n]*\n/, "\n").replace(/CREATE UNIQUE INDEX IF NOT EXISTS items_path[^\n]*\nCREATE INDEX IF NOT EXISTS items_category[^\n]*\n/, ""));
  old.exec("INSERT INTO items(id, type, title, content) VALUES (7, 'document', 'Old doc', '# Old')");
  old.exec("INSERT INTO tags(id, name) VALUES (1, 'legacy'); INSERT INTO taggings(tag_id, item_id) VALUES (1, 7)");
  old.close();

  // Parent dir: direct children are projects; nested repo found through a non-repo dir; nothing below a repo.
  const parent = join(directory, "proj");
  for (const path of ["alpha", "beta/.git", "group/gamma/.git", "group/gamma/vendored/.git", "group/plain"]) await mkdir(join(parent, path), { recursive: true });

  server = Bun.spawn({
    cmd: [process.execPath, "app.js"],
    cwd: fixture,
    env: { ...process.env, PORT: "0", PORTFOLIO_DB: dbPath, PORTFOLIO_OPEN_BIN: join(directory, "bin", "open"), PORTFOLIO_PBCOPY_BIN: join(directory, "bin", "pbcopy") },
    stdout: "pipe",
    stderr: "inherit",
  });
  const { value } = await server.stdout.getReader().read();
  serverUrl = `http://127.0.0.1:${new TextDecoder().decode(value).match(/:(\d+)/)[1]}`;
});

afterAll(async () => {
  server?.kill();
  await rm(directory, { recursive: true, force: true });
});

test("an older database is rebuilt in place and keeps its rows, tags, and search", async () => {
  expect(existsSync(`${dbPath}.before-kinds`)).toBe(true);
  expect(await item(7)).toMatchObject({ id: 7, type: "document", title: "Old doc", tags: ["legacy"], path: null, slots: [] });
  expect((await (await fetch(`${serverUrl}/api/items?q=old&contents`)).json()).items.map(entry => entry.id)).toEqual([7]);
});

test("file and dir items carry a path, and categories give them slots with shared actions", async () => {
  expect((await post("/categories", { name: "harness", kind: "dir", slots: "config | file | settings.json\nlogs | dir | ~/Library/Logs/{name}" })).status).toBe(303);
  expect((await post("/categories", { name: "harness", kind: "dir", slots: "" })).status).toBe(422);
  expect((await post("/categories", { name: "bad", kind: "dir", slots: "no kind here" })).status).toBe(422);

  const home = join(directory, "claude");
  const created = await post("/api/items", { type: "dir", path: `${home}/`, category: "harness", tags: "ai" });
  expect(created.status).toBe(201);
  const { id } = await created.json();
  expect((await post("/api/items", { type: "dir", path: home, title: "dupe" })).status).toBe(422);
  expect((await post("/api/items", { type: "file", path: "relative/path" })).status).toBe(422);
  expect((await post("/api/items", { type: "file", path: `${home}/x`, category: "harness" })).status).toBe(422);

  let detail = await item(id);
  expect(detail).toMatchObject({ type: "dir", title: "claude", path: home, tags: ["ai"] });
  expect(detail.slots).toEqual([
    { name: "config", kind: "file", path: join(home, "settings.json"), overridden: false, exists: false },
    { name: "logs", kind: "dir", path: join(process.env.HOME, "Library/Logs/{name}"), overridden: false, exists: false },
  ]);

  // Overriding a slot path, then clearing it, goes back to the category's path.
  await post(`/items/${id}/slot-path`, { slot: "logs", path: `${home}/logs` });
  expect((await item(id)).slots[1]).toMatchObject({ path: join(home, "logs"), overridden: true });
  await post(`/items/${id}/slot-path`, { slot: "logs", path: "" });
  expect((await item(id)).slots[1].overridden).toBe(false);
  expect((await post(`/items/${id}/slot-path`, { slot: "nope", path: "/x" })).status).toBe(404);

  // Copy never touches disk; open and reveal create the target first.
  await post(`/items/${id}/path-action`, { action: "copy", slot: "config" });
  expect(existsSync(join(home, "settings.json"))).toBe(false);
  await post(`/items/${id}/path-action`, { action: "open", slot: "config" });
  expect(existsSync(join(home, "settings.json"))).toBe(true);
  await post(`/items/${id}/path-action`, { action: "reveal" });
  expect((await item(id)).slots[0].exists).toBe(true);
  expect((await post(`/items/${id}/path-action`, { action: "delete" })).status).toBe(422);
  expect((await readFile(actionLog, "utf8")).trim().split("\n")).toEqual([
    `pbcopy ${join(home, "settings.json")}`,
    `open ${join(home, "settings.json")}`,
    `open -R ${home}`,
  ]);

  const page = await (await fetch(`${serverUrl}/items/${id}`)).text();
  expect(page).toContain("harness slots");
  expect(page).toContain("Reveal in Finder");
  expect(page).toContain("not created yet");
  expect(await (await fetch(`${serverUrl}/categories/1`)).text()).toContain("claude");

  // A category cannot change kind while it has members; deleting it keeps them.
  expect((await post("/categories/1", { name: "harness", kind: "file", slots: "" })).status).toBe(422);
  await post("/categories/1/delete", {});
  expect(await item(id)).toMatchObject({ category_id: null, slots: [] });
});

test("project parents are scanned for direct children and nested repositories", async () => {
  const parent = join(directory, "proj");
  expect((await post("/settings/project-parents", { path: parent })).status).toBe(303);
  expect((await post("/settings/project-parents", { path: join(directory, "missing") })).status).toBe(422);
  const paths = (await items()).filter(entry => entry.type === "dir" && entry.path.startsWith(parent)).map(entry => entry.path.slice(parent.length + 1)).sort();
  expect(paths).toEqual(["alpha", "beta", "group", "group/gamma"]);
  const alpha = (await items()).find(entry => entry.path === join(parent, "alpha"));
  expect(alpha.tags).toEqual(["project"]);
  expect((await item(alpha.id)).slots).toEqual([{ name: "tasks", kind: "file", path: join(parent, "alpha", "TASKS.md"), overridden: false, exists: false }]);

  // A rescan adds only what is new.
  await mkdir(join(parent, "delta"));
  await post("/settings/project-parents/scan", {});
  const after = await items();
  expect(after.filter(entry => entry.path === join(parent, "alpha"))).toHaveLength(1);
  expect(after.some(entry => entry.path === join(parent, "delta"))).toBe(true);
  expect(await (await fetch(`${serverUrl}/settings`)).text()).toContain("5 projects");
});
