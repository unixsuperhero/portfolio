import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "portfolio-quick-"));
const fixture = join(directory, "app");
let serverUrl;
let server;

const detect = async content => (await fetch(`${serverUrl}/api/detect?${new URLSearchParams({ content })}`)).json();
const quick = (fields) => {
  const body = new URLSearchParams(fields);
  return fetch(`${serverUrl}/items/quick`, { method: "POST", body });
};
const item = async id => (await fetch(`${serverUrl}/api/items/${id}`)).json();
const items = async () => (await (await fetch(`${serverUrl}/api/items?limit=100`)).json()).items;

beforeAll(async () => {
  await Promise.all([mkdir(join(fixture, "templates"), { recursive: true }), mkdir(join(fixture, "public"), { recursive: true }), mkdir(join(directory, "docs", "sub"), { recursive: true })]);
  await Promise.all([
    copyFile(join(root, "app.js"), join(fixture, "app.js")),
    symlink(join(root, "packages"), join(fixture, "packages"), "dir"),
    copyFile(join(root, "tsconfig.json"), join(fixture, "tsconfig.json")),
    copyFile(join(root, "schema.sql"), join(fixture, "schema.sql")),
    copyFile(join(root, "templates", "document.html"), join(fixture, "templates", "document.html")),
    copyFile(join(root, "templates", "external-images.lua"), join(fixture, "templates", "external-images.lua")),
    copyFile(join(root, "public", "app.css"), join(fixture, "public", "app.css")),
    writeFile(join(directory, "docs", "guide.md"), "# The Guide\n\nHello.\n"),
    writeFile(join(directory, "docs", "report.html"), "<html><head><title>Q3 Report</title></head><body>hi</body></html>"),
    writeFile(join(directory, "docs", "data.csv"), "a,b\n"),
  ]);
  server = Bun.spawn({ cmd: [process.execPath, "app.js"], cwd: fixture, env: { ...process.env, PORT: "0", PORTFOLIO_DB: join(directory, "portfolio.sqlite") }, stdout: "pipe", stderr: "inherit" });
  const { value } = await server.stdout.getReader().read();
  serverUrl = `http://127.0.0.1:${new TextDecoder().decode(value).match(/:(\d+)/)[1]}`;
});

afterAll(async () => {
  server?.kill();
  await rm(directory, { recursive: true, force: true });
});

test("detection tells URLs, PRs, paths, and text apart", async () => {
  expect(await detect("https://github.com/x/y/pull/12")).toMatchObject({ type: "pr", title: "x/y#12" });
  expect(await detect("https://gitlab.com/g/p/-/merge_requests/3")).toMatchObject({ type: "pr", title: "gitlab.com/g/p/-/merge_requests/3" });
  expect(await detect("https://remotion.dev/docs/")).toMatchObject({ type: "link", title: "remotion.dev/docs" });
  expect(await detect("see https://x.dev for more\nnotes")).toMatchObject({ type: "note", title: "see https://x.dev for more" });
  expect(await detect("# Plan\n\n- a")).toMatchObject({ type: "note", title: "Plan" });
  expect(await detect(join(directory, "docs"))).toMatchObject({ type: "dir", title: "docs", exists: true });
  expect(await detect(join(directory, "docs", "guide.md"))).toMatchObject({ type: "document", title: "guide", exists: true });
  expect(await detect(join(directory, "docs", "report.html"))).toMatchObject({ type: "document", exists: true });
  expect(await detect(join(directory, "docs", "data.csv"))).toMatchObject({ type: "file", title: "data.csv", exists: true });
  expect(await detect(join(directory, "nope", "later.txt"))).toMatchObject({ type: "file", exists: false });
  expect(await detect("")).toMatchObject({ type: "note", title: "Untitled" });
});

test("quick add creates the detected item, honors overrides, and imports documents", async () => {
  const pr = await (await quick({ content: "https://github.com/x/y/pull/12", tags: "portfolio" })).json();
  expect(pr).toMatchObject({ type: "pr", title: "x/y#12" });
  expect(await item(pr.id)).toMatchObject({ type: "pr", url: "https://github.com/x/y/pull/12", tags: ["portfolio"] });

  const note = await (await quick({ content: "# Plan\n\nsee https://x.dev" })).json();
  expect(await item(note.id)).toMatchObject({ type: "note", title: "Plan", url: null });
  expect((await item(note.id)).rendered_html).toContain("Plan");

  const asDoc = await (await quick({ content: "# Spec\n\nbody", type: "document" })).json();
  expect(await item(asDoc.id)).toMatchObject({ type: "document", title: "Spec" });

  const dir = await (await quick({ content: join(directory, "docs") })).json();
  expect(await item(dir.id)).toMatchObject({ type: "dir", path: join(directory, "docs"), title: "docs" });
  expect((await quick({ content: join(directory, "docs") })).status).toBe(422);

  const asFile = await (await quick({ content: join(directory, "docs", "guide.md"), type: "file" })).json();
  expect(await item(asFile.id)).toMatchObject({ type: "file", path: join(directory, "docs", "guide.md") });

  const md = await (await quick({ content: join(directory, "docs", "guide.md") })).json();
  expect(await item(md.id)).toMatchObject({ type: "document", title: "The Guide", source_path: join(directory, "docs", "guide.md") });
  expect((await item(md.id)).rendered_html).toContain("Hello.");
  expect((await (await quick({ content: join(directory, "docs", "guide.md") })).json()).id).toBe(md.id);

  const html = await (await quick({ content: join(directory, "docs", "report.html") })).json();
  expect(await item(html.id)).toMatchObject({ type: "document", title: "Q3 Report" });
  const twins = (await items()).filter(entry => entry.source_path === join(directory, "docs", "report.html") || entry.path === join(directory, "docs", "report.html"));
  expect(twins.map(entry => entry.type).sort()).toEqual(["document", "file"]);

  expect((await quick({ content: "just words", type: "link" })).status).toBe(422);
  expect((await quick({ content: "https://a.dev", type: "dir" })).status).toBe(422);
  expect((await quick({ content: join(directory, "nope.md") })).status).toBe(422);
  expect((await quick({ content: "x", type: "bogus" })).status).toBe(422);
});

test("the picker can list files next to directories", async () => {
  const listing = await (await fetch(`${serverUrl}/api/settings/directories?${new URLSearchParams({ path: join(directory, "docs"), files: "1" })}`)).json();
  expect(listing.directories.map(entry => entry.name)).toEqual(["sub"]);
  expect(listing.files.map(entry => entry.name)).toEqual(["data.csv", "guide.md", "report.html"]);
  expect((await (await fetch(`${serverUrl}/api/settings/directories?${new URLSearchParams({ path: join(directory, "docs") })}`)).json()).files).toBeUndefined();
  const page = await (await fetch(`${serverUrl}/`)).text();
  expect(page).toContain("data-quick-content");
  expect(page).toContain('class="add-open"');
});
