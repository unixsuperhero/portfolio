import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeItemPath, PATH_TYPES } from "@portfolio/core";
import type { ItemType, PathType } from "@portfolio/core";
import type { Ctx } from "./context.ts";

const openBin = () => process.env.PORTFOLIO_OPEN_BIN ?? "open";
const pbcopyBin = () => process.env.PORTFOLIO_PBCOPY_BIN ?? "pbcopy";

export interface PathTarget {
  kind: PathType;
  path: string;
}

/**
 * Validates a candidate path/category pair for an item of `type`, the way
 * app.js's createItem does: throws with a user-facing message on conflict.
 */
export function pathAndCategory(ctx: Ctx, type: ItemType, input: { path?: string; category?: string }, itemId = 0): { path: string | null; categoryId: number | null } {
  let path: string | null = null;
  if ((PATH_TYPES as readonly string[]).includes(type) && input.path) path = normalizeItemPath(input.path, ctx.home);
  if (path) {
    const clash = ctx.store.items.findItemByPath(path);
    if (clash && clash.id !== itemId) throw new Error("another item already tracks that path");
  }
  const categoryName = input.category;
  const category = categoryName ? ctx.store.categories.findCategory(categoryName) : null;
  if (categoryName && !category) throw new Error(`no category named "${categoryName}"`);
  if (category && category.kind !== type) throw new Error(`category "${categoryName}" holds ${category.kind} items`);
  return { path, categoryId: category?.id ?? null };
}

/** copy/reveal/open create the file or dir first when missing, like app.js. create makes it and stops. */
export async function runPathAction(action: string, target: PathTarget): Promise<void> {
  if (action === "copy") {
    const proc = Bun.spawn([pbcopyBin()], { stdin: "pipe" });
    proc.stdin.write(target.path);
    proc.stdin.end();
    await proc.exited;
    return;
  }
  if (action === "create") {
    if (target.kind === "dir") await mkdir(target.path, { recursive: true });
    else {
      await mkdir(dirname(target.path), { recursive: true });
      if (!existsSync(target.path)) await writeFile(target.path, "");
    }
    return;
  }
  if (action !== "open" && action !== "reveal") throw new Error("invalid action");
  if (!existsSync(target.path)) {
    await mkdir(target.kind === "dir" ? target.path : dirname(target.path), { recursive: true });
    if (target.kind === "file") await writeFile(target.path, "");
  }
  await Bun.spawn([openBin(), ...(action === "reveal" ? ["-R"] : []), target.path]).exited;
}
