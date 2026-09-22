/**
 * The handful of POSIX path operations core needs, written without node:path so
 * the package bundles for the browser (the desktop frontend imports core).
 */

const trimTrailing = (path: string): string => path.length > 1 ? path.replace(/\/+$/, "") : path;

export const isAbsolute = (path: string): boolean => path.startsWith("/");

export function basename(path: string, ext?: string): string {
  const name = trimTrailing(path).split("/").pop() ?? "";
  return ext && name.endsWith(ext) && name !== ext ? name.slice(0, -ext.length) : name;
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

export function dirname(path: string): string {
  const trimmed = trimTrailing(path);
  const slash = trimmed.lastIndexOf("/");
  if (slash === -1) return ".";
  if (slash === 0) return "/";
  return trimmed.slice(0, slash);
}

/** Collapses ".", "..", and repeated slashes. Keeps the leading slash of absolute paths. */
export function normalize(path: string): string {
  const absolute = isAbsolute(path);
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length && parts[parts.length - 1] !== "..") parts.pop(); else if (!absolute) parts.push(".."); continue; }
    parts.push(part);
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined || ".";
}

/** Like node's resolve: the last absolute segment wins; relative-only input hangs off the cwd when there is one. */
export function resolve(...segments: string[]): string {
  let path = "";
  for (const segment of segments) {
    if (!segment) continue;
    path = isAbsolute(segment) || !path ? segment : `${path}/${segment}`;
  }
  if (!isAbsolute(path)) {
    const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ?? "/";
    path = `${cwd}/${path}`;
  }
  return normalize(path);
}

export const join = (...segments: string[]): string => normalize(segments.filter(Boolean).join("/"));
