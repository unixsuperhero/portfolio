import { basename, extname } from "./posix.ts";

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (value: unknown = ""): string => String(value).replace(/[&<>"']/g, char => HTML_ESCAPES[char]);

export const slugify = (value: unknown): string => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** "a, b ,,c" -> ["a", "b", "c"], deduplicated, order kept. */
export const parseTags = (value: unknown): string[] => [...new Set(String(value ?? "").split(",").map(part => part.trim()).filter(Boolean))];

export const firstHeading = (markdown: string): string | null => markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;

export const firstLine = (text: string): string | null => text.split("\n").map(line => line.trim()).find(Boolean) ?? null;

export const htmlTitle = (html: string): string | null => html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;

/** Title for an imported file: <title> for HTML, first heading for Markdown, else the file name without extension. */
export function documentTitle(content: string, sourcePath: string): string {
  const fallback = basename(sourcePath, extname(sourcePath));
  if (extname(sourcePath).toLowerCase() === ".html") return htmlTitle(content) || fallback;
  return firstHeading(content) || fallback;
}

/** Title for pasted text: first heading, else first non-empty line, capped. */
export const textTitle = (content: string, max = 80): string => (firstHeading(content) || firstLine(content) || "Untitled").slice(0, max);

export const truncate = (value: string, max: number, suffix = "…"): string => value.length > max ? value.slice(0, Math.max(0, max - suffix.length)) + suffix : value;
