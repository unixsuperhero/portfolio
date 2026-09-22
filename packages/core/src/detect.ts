import { basename, extname } from "node:path";
import { stat } from "node:fs/promises";
import type { Detection } from "./types.ts";
import { isDocumentPath, normalizeItemPath } from "./paths.ts";
import { textTitle } from "./text.ts";

export type PathProbe = (path: string) => Promise<"dir" | "file" | null>;

export const fsProbe: PathProbe = async path => {
  const info = await stat(path).catch(() => null);
  return info ? (info.isDirectory() ? "dir" : "file") : null;
};

/** A single-line http(s) URL: a PR when it points at a pull or merge request, otherwise a link. */
export function detectUrl(line: string): Detection | null {
  if (!/^https?:\/\/\S+$/.test(line)) return null;
  const github = line.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  const generic = line.match(/\/(?:pull|merge_requests)\/(\d+)/);
  const url = new URL(line);
  if (github) return { shape: "url", type: "pr", url: line, title: `${github[1]}#${github[2]}` };
  if (generic) return { shape: "url", type: "pr", url: line, title: `${url.hostname}${url.pathname}` };
  return { shape: "url", type: "link", url: line, title: (url.hostname + url.pathname).replace(/\/$/, "") };
}

/** A single-line absolute or ~/ path: dir when it is one, document for .md/.html, else file. */
export async function detectPath(line: string, probe: PathProbe = fsProbe, home?: string): Promise<Detection | null> {
  if (!/^(~\/|\/|~$)/.test(line)) return null;
  const path = normalizeItemPath(line, home);
  const kind = await probe(path);
  const importable = isDocumentPath(path);
  const type = kind === "dir" ? "dir" : importable ? "document" : "file";
  const title = type === "document" ? basename(path, extname(path)) : basename(path);
  return { shape: "path", type, path, exists: kind !== null, title };
}

export const detectText = (content: string): Detection => ({ shape: "text", type: "note", content, title: textTitle(content) });

/**
 * What a pasted or picked thing is. `shape` says which field the text fills;
 * `type` is the guess a form may override.
 *   url  -> link, or pr when the URL points at a pull/merge request
 *   path -> dir when it is one on disk, document for .md/.html, else file
 *   text -> note (a note that merely contains a URL stays a note)
 */
export async function detect(raw: string, options: { probe?: PathProbe; home?: string } = {}): Promise<Detection> {
  const content = raw.trim();
  const line = content.split("\n").length === 1 ? content : "";
  if (line) {
    const url = detectUrl(line);
    if (url) return url;
    const path = await detectPath(line, options.probe, options.home);
    if (path) return path;
  }
  return detectText(content);
}
