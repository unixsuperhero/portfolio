import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addProjectParent, addWatchedDirectory, getItem, listItems, openDatabase, setWatchedRecursive, tagNamesFor } from "@portfolio/db";
import { discoverProjects, reconcile, scanProjects } from "../src/index.ts";

const render = (markdown: string, { title }: { title: string }) => `<h1>${title}</h1>${markdown.length}`;

test("reconcile imports, updates, and removes uncovered documents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "a.md"), "# A\n\nhello");
  writeFileSync(join(dir, "sub", "b.md"), "# B");
  writeFileSync(join(dir, "r.html"), "<title>R</title>");
  writeFileSync(join(dir, "skip.txt"), "no");
  const db = openDatabase(":memory:");
  const id = addWatchedDirectory(db, dir, true);
  let result = await reconcile(db, render);
  expect(result.states.get(id)).toMatchObject({ count: 3, error: null });
  expect(listItems(db).map(i => i.title).sort()).toEqual(["A", "B", "R"]);
  const a = listItems(db, { q: "A" })[0];
  expect(a.rendered_html).toBe("<h1>A</h1>10");
  expect(listItems(db, { q: "R" })[0].rendered_html).toBe("<title>R</title>");
  setWatchedRecursive(db, id, false);
  result = await reconcile(db, render);
  expect(result.removed).toBe(1);
  expect(listItems(db).map(i => i.title).sort()).toEqual(["A", "R"]);
  rmSync(join(dir, "a.md"));
  await reconcile(db, render);
  expect(getItem(db, a.id)).toBeNull();
  rmSync(dir, { recursive: true });
  result = await reconcile(db, render);
  expect(result.states.get(id)?.error).toMatch(/ENOENT|not a directory/i);
});

test("project discovery stops at repositories", async () => {
  const root = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(root, "app", ".git"), { recursive: true });
  mkdirSync(join(root, "app", "nested", ".git"), { recursive: true });
  mkdirSync(join(root, "group", "deep", "repo", ".git"), { recursive: true });
  mkdirSync(join(root, "group", "plain"));
  mkdirSync(join(root, ".hidden"));
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  const found = (await discoverProjects(root)).map(path => path.slice(root.length + 1)).sort();
  expect(found).toEqual(["app", "group", "group/deep/repo"]);
  const db = openDatabase(":memory:");
  addProjectParent(db, root);
  expect((await scanProjects(db)).length).toBe(3);
  expect((await scanProjects(db)).length).toBe(0);
  const item = listItems(db, { type: "dir" }).find(i => i.title === "repo")!;
  expect(tagNamesFor(db, item.id)).toEqual(["project"]);
  expect(item.category_id).not.toBeNull();
});
