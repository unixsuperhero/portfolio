import { dirname, resolve } from "./posix.ts";

/** The one library file for a chunked site: index.html, whose directory is the site root. */
export function isSiteIndex(sourcePath: string | null | undefined): boolean {
  if (!sourcePath) return false;
  return sourcePath.split("/").pop()?.toLowerCase() === "index.html";
}

/**
 * A URL path relative to the directory of `indexPath`.
 * An empty path is the index file itself. `..` and absolute paths are rejected.
 */
export function resolveSiteFile(indexPath: string, relative: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  if (!decoded || decoded === "." || decoded === "/") return resolve(indexPath);
  if (decoded.includes("\0") || decoded.startsWith("/") || decoded.split("/").includes("..")) return null;
  const root = dirname(resolve(indexPath));
  const target = resolve(root, decoded.replace(/\/+$/, ""));
  if (target !== root && !target.startsWith(`${root}/`)) return null;
  return target;
}
