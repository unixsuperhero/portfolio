import { localMarkdownLink } from "@portfolio/core";

type Node = { t?: string; c?: unknown } | Node[] | Record<string, unknown> | null | undefined | string | number;

/** Every link target in a Pandoc AST, in document order. */
export function astLinks(node: unknown): string[] {
  const found: string[] = [];
  const walk = (value: Node): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    const record = value as { t?: string; c?: unknown[] };
    if (record.t === "Link" && Array.isArray(record.c?.[2]) && typeof (record.c[2] as unknown[])[0] === "string") found.push((record.c[2] as string[])[0]);
    Object.values(record).forEach(child => walk(child as Node));
  };
  walk(node as Node);
  return found;
}

/**
 * Rewrites links to local Markdown files into `/items/:id` when `resolveId`
 * knows the target, keeping any ?query or #fragment. Mutates and returns the AST.
 */
export function rewriteLinks<T>(ast: T, sourcePath: string, resolveId: (absolutePath: string) => number | undefined): T {
  const walk = (value: Node): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    const record = value as { t?: string; c?: unknown[] };
    if (record.t === "Link" && Array.isArray(record.c?.[2])) {
      const target = record.c[2] as string[];
      const local = localMarkdownLink(sourcePath, target[0]);
      const id = local && resolveId(local.sourcePath);
      if (id) target[0] = `/items/${id}${local!.suffix}`;
    }
    Object.values(record).forEach(child => walk(child as Node));
  };
  walk(ast as Node);
  return ast;
}
