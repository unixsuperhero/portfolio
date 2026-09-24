import { join } from "node:path";
import { existsSync } from "node:fs";

export const MARKDOWN_READER = "markdown+lists_without_preceding_blankline-blank_before_header-blank_before_blockquote+autolink_bare_uris+emoji+mark+wikilinks_title_before_pipe";
export const DEFAULT_TEMPLATE = join(import.meta.dir, "..", "templates", "document.html");
export const EXTERNAL_IMAGES_FILTER = join(import.meta.dir, "..", "templates", "external-images.lua");

let resolved: string | undefined;
/** PANDOC_BIN, else pandoc on PATH, else the Homebrew path. */
export function pandocBin(): string {
  if (process.env.PANDOC_BIN) return process.env.PANDOC_BIN;
  if (resolved) return resolved;
  resolved = Bun.which("pandoc") ?? ["/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc"].find(existsSync) ?? "pandoc";
  return resolved;
}

export function runPandoc(args: string[], input: string, bin = pandocBin()): string {
  const result = Bun.spawnSync({ cmd: [bin, ...args], stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || "pandoc failed");
  return result.stdout.toString();
}

export const pandocAvailable = (): boolean => Boolean(Bun.which(pandocBin()) || existsSync(pandocBin()));

/** Markdown -> Pandoc JSON AST. */
export const markdownToAst = (markdown: string, bin?: string): unknown => JSON.parse(runPandoc([`--from=${MARKDOWN_READER}`, "--to=json"], markdown, bin));
