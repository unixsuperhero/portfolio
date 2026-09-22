import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMarkdownPath, localMarkdownLink } from "@portfolio/core";
import { markdownToAst } from "./pandoc.ts";
import { astLinks } from "./links.ts";

export interface CrawlResult {
  roots: string[];
  /** Every file to import, sorted. Includes the roots. */
  files: string[];
  /** Absolute path -> the local Markdown files it links to. */
  edges: Map<string, string[]>;
}

/**
 * Starting from root files, follows links to local Markdown files (when
 * `recursive`) and returns the closure. Throws when a linked file is missing,
 * naming the file that linked it. HTML roots are included but never crawled.
 */
export function crawlMarkdown(rootPaths: string[], options: { recursive?: boolean; bin?: string; read?: (path: string) => string } = {}): CrawlResult {
  const read = options.read ?? (path => readFileSync(path, "utf8"));
  const roots = rootPaths.map(path => resolve(path));
  const seen = new Set<string>();
  const edges = new Map<string, string[]>();
  const queue = [...roots].sort();
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    if (!existsSync(path)) throw new Error(`linked Markdown not found: ${path}`);
    seen.add(path);
    if (!options.recursive || !isMarkdownPath(path)) continue;
    const children: string[] = [];
    for (const target of astLinks(markdownToAst(read(path), options.bin))) {
      const child = localMarkdownLink(path, target);
      if (!child) continue;
      if (!existsSync(child.sourcePath)) throw new Error(`linked Markdown not found: ${child.sourcePath} (from ${path})`);
      children.push(child.sourcePath);
      if (!seen.has(child.sourcePath)) queue.push(child.sourcePath);
    }
    edges.set(path, [...new Set(children)]);
    queue.sort();
  }
  return { roots, files: [...seen].sort(), edges };
}
