import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { DOCUMENT_EXTENSIONS, MARKDOWN_EXTENSIONS } from "./constants.ts";

const homeDir = (home?: string) => home ?? process.env.HOME ?? "";

/** "~" and "~/x" become absolute; anything else is returned as given. */
export function expandPath(value: string, home?: string): string {
  const h = homeDir(home);
  if (value === "~") return h;
  if (value.startsWith("~/")) return resolve(h, value.slice(2));
  return value;
}

/** /Users/me/x -> ~/x when the path is under home. */
export function abbreviatePath(path: string, home?: string): string {
  const h = homeDir(home);
  return h && path.startsWith(h + sep) ? `~${path.slice(h.length)}` : path;
}

/** A file or dir item path: absolute or ~/, resolved, never stat-ed. Throws on relative input. */
export function normalizeItemPath(value: string, home?: string): string {
  const path = expandPath(value.trim(), home);
  if (!path || !isAbsolute(path)) throw new Error("path must be absolute or start with ~/");
  return resolve(path);
}

export const isHtmlPath = (path: string): boolean => extname(path).toLowerCase() === ".html";
export const isMarkdownPath = (path: string): boolean => (MARKDOWN_EXTENSIONS as readonly string[]).includes(extname(path).toLowerCase());
export const isDocumentPath = (path: string): boolean => (DOCUMENT_EXTENSIONS as readonly string[]).includes(extname(path).toLowerCase());

export interface LocalMarkdownLink {
  sourcePath: string;
  suffix: string;
}

/**
 * Resolves a link target found in `sourcePath` to a local Markdown file, keeping
 * any ?query or #fragment as `suffix`. Returns null for URLs, anchors, and
 * non-Markdown targets.
 */
export function localMarkdownLink(sourcePath: string, target: string | undefined | null): LocalMarkdownLink | null {
  if (!target || target.startsWith("#") || target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const boundary = target.search(/[?#]/);
  const encodedPath = boundary === -1 ? target : target.slice(0, boundary);
  if (!encodedPath) return null;
  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  if (!isMarkdownPath(path)) return null;
  return { sourcePath: resolve(dirname(sourcePath), path), suffix: boundary === -1 ? "" : target.slice(boundary) };
}
