import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Database } from "bun:sqlite";
import { abbreviatePath } from "@portfolio/core";
import { ensureCategory, findItemByPath, listProjectParents, setTags } from "@portfolio/db";

export const PROJECT_SCAN_DEPTH = 4;
export const PROJECT_CATEGORY = { name: "project", kind: "dir" as const, slots: [{ name: "tasks", kind: "file" as const, path: "TASKS.md" }] };

/**
 * A project is any direct child of a parent dir, or a deeper dir (to `depth`)
 * with .git at its top level. The walk stops at a repository, so it never
 * crawls into a monorepo. Hidden dirs and node_modules are skipped.
 */
export async function discoverProjects(parent: string, depth = PROJECT_SCAN_DEPTH): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, level: number): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      const repository = existsSync(join(path, ".git"));
      if (level === 1 || repository) found.push(path);
      if (!repository && level < depth) await walk(path, level + 1);
    }
  }
  await walk(parent, 1);
  return found;
}

/** Adds newly found projects as dir items in the project category with the project tag. Never removes. */
export async function scanProjects(db: Database, home?: string): Promise<string[]> {
  const parents = listProjectParents(db);
  if (!parents.length) return [];
  const category = ensureCategory(db, PROJECT_CATEGORY);
  const insert = db.query<{ id: number }, [string, string, string, number]>("INSERT INTO items(type, title, description, path, category_id) VALUES ('dir', ?, ?, ?, ?) RETURNING id");
  const added: string[] = [];
  for (const parent of parents) {
    for (const path of await discoverProjects(parent.path)) {
      if (findItemByPath(db, path)) continue;
      setTags(db, insert.get(basename(path), abbreviatePath(path, home), path, category.id)!.id, ["project"]);
      added.push(path);
    }
  }
  return added;
}
