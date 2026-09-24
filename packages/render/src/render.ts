import { dirname } from "node:path";
import { DEFAULT_TEMPLATE, EXTERNAL_IMAGES_FILTER, MARKDOWN_READER, runPandoc } from "./pandoc.ts";
import { rewriteLinks } from "./links.ts";

export interface RenderOptions {
  title: string;
  toc?: boolean;
  /** When set, links to local Markdown are rewritten through `resolveId`. */
  sourcePath?: string | null;
  resolveId?: (absolutePath: string) => number | undefined;
  template?: string;
  bin?: string;
  date?: string;
  highlight?: string;
}

const today = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/** Markdown -> standalone HTML page with the document template, TOC, and syntax highlighting. */
export function renderMarkdown(markdown: string, options: RenderOptions): string {
  let input = markdown;
  let from = `--from=${MARKDOWN_READER}`;
  if (options.sourcePath && options.resolveId) {
    const ast = JSON.parse(runPandoc([from, "--to=json"], markdown, options.bin));
    input = JSON.stringify(rewriteLinks(ast, options.sourcePath, options.resolveId));
    from = "--from=json";
  }
  const args = [
    from,
    `--template=${options.template ?? DEFAULT_TEMPLATE}`,
    `--syntax-highlighting=${options.highlight ?? "breezedark"}`,
    "--standalone",
    "--embed-resources",
    `--lua-filter=${EXTERNAL_IMAGES_FILTER}`,
    "--section-divs",
    "--html-q-tags",
    "--wrap=none",
    "--metadata", `title=${options.title}`,
    "--metadata", `date=${options.date ?? today()}`,
  ];
  if (options.toc ?? true) args.push("--toc", "--toc-depth=3");
  if (options.sourcePath) args.push(`--resource-path=${dirname(options.sourcePath)}`);
  return runPandoc(args, input, options.bin);
}

/** Markdown -> an HTML fragment (no template), for embedding. */
export const renderFragment = (markdown: string, bin?: string): string => runPandoc([`--from=${MARKDOWN_READER}`, "--to=html", "--wrap=none"], markdown, bin);
