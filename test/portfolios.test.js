import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "portfolio-cards-"));
const fixture = join(directory, "app");
let serverUrl;
let server;

const post = (path, fields) => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) [value].flat().forEach(entry => body.append(key, entry));
  return fetch(`${serverUrl}${path}`, { method: "POST", body, redirect: "manual" });
};
const portfolio = async id => (await fetch(`${serverUrl}/api/portfolios/${id}`)).json();
const titles = card => card.items.map(item => item.title);

beforeAll(async () => {
  await Promise.all([mkdir(join(fixture, "templates"), { recursive: true }), mkdir(join(fixture, "public"), { recursive: true })]);
  await Promise.all([
    copyFile(join(root, "app.js"), join(fixture, "app.js")),
    symlink(join(root, "packages"), join(fixture, "packages"), "dir"),
    copyFile(join(root, "tsconfig.json"), join(fixture, "tsconfig.json")),
    copyFile(join(root, "schema.sql"), join(fixture, "schema.sql")),
    copyFile(join(root, "templates", "document.html"), join(fixture, "templates", "document.html")),
    copyFile(join(root, "templates", "external-images.lua"), join(fixture, "templates", "external-images.lua")),
    copyFile(join(root, "public", "app.css"), join(fixture, "public", "app.css")),
  ]);
  server = Bun.spawn({
    cmd: [process.execPath, "app.js"],
    cwd: fixture,
    env: { ...process.env, PORT: "0", PORTFOLIO_DB: join(directory, "portfolio.sqlite") },
    stdout: "pipe",
    stderr: "inherit",
  });
  const { value } = await server.stdout.getReader().read();
  serverUrl = `http://127.0.0.1:${new TextDecoder().decode(value).match(/:(\d+)/)[1]}`;
  for (const item of [
    { type: "link", title: "Banana", url: "https://example.com/b", tags: "yt" },
    { type: "link", title: "apple", url: "https://example.com/a", tags: "slides" },
    { type: "pr", title: "Cherry", url: "https://example.com/c", tags: "yt, slides" },
    { type: "link", title: "Untagged", url: "https://example.com/u", tags: "" },
  ]) expect((await post("/api/items", item)).status).toBe(201);
});

afterAll(async () => {
  server?.kill();
  await rm(directory, { recursive: true, force: true });
});

test("cards OR their tags, narrow by type, sort, cap, reorder, and cascade", async () => {
  const created = await post("/portfolios", { name: "YT", description: "channel" });
  expect(created.status).toBe(303);
  const path = created.headers.get("location");
  const id = Number(path.split("/").pop());
  expect((await post("/portfolios", { name: "yt" })).status).toBe(422);

  await post(`${path}/cards`, { title: "Either tag", tags: "YT, slides", sort_key: "title", sort_dir: "asc" });
  await post(`${path}/cards`, { title: "Links only", tags: "yt, slides", types: "link", sort_key: "title", sort_dir: "desc" });
  await post(`${path}/cards`, { title: "Not yet tagged", tags: "future-tag" });
  await post(`${path}/cards`, { title: "All PRs", types: "pr", sort_key: "bogus" });
  expect((await post(`${path}/cards`, { title: "" })).status).toBe(422);

  let cards = (await portfolio(id)).cards;
  expect(cards.map(card => card.title)).toEqual(["Either tag", "Links only", "Not yet tagged", "All PRs"]);
  expect(titles(cards[0])).toEqual(["apple", "Banana", "Cherry"]);
  expect(titles(cards[1])).toEqual(["Banana", "apple"]);
  expect(cards[2]).toMatchObject({ tags: ["future-tag"], total: 0, items: [] });
  expect(titles(cards[3])).toEqual(["Cherry"]);
  expect(cards[3].sort_key).toBe("created_at");

  await post(`/cards/${cards[0].id}`, { title: "Capped", tags: "yt, slides", sort_key: "title", sort_dir: "asc", max_items: "2" });
  await post(`/cards/${cards[0].id}/move`, { direction: "right" });
  cards = (await portfolio(id)).cards;
  expect(cards.map(card => card.title)).toEqual(["Links only", "Capped", "Not yet tagged", "All PRs"]);
  expect(cards[1]).toMatchObject({ total: 3, max_items: 2 });
  expect(titles(cards[1])).toEqual(["apple", "Banana"]);

  const page = await (await fetch(`${serverUrl}${path}`)).text();
  expect(page).toContain("2 of 3");
  expect(page).toContain("Nothing matches this card yet.");
  expect(await (await fetch(`${serverUrl}/portfolios`)).text()).toContain("4 cards");

  await post(`/cards/${cards[3].id}/delete`, {});
  expect((await portfolio(id)).cards).toHaveLength(3);
  await post(`${path}/delete`, {});
  expect((await fetch(`${serverUrl}${path}`)).status).toBe(404);
  expect((await post(`/cards/${cards[0].id}`, { title: "gone" })).status).toBe(404);
});
