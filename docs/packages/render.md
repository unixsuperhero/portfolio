# @portfolio/render

Markdown to HTML through Pandoc, with the Portfolio document template (`templates/document.html`, copied from the app), the same reader extensions the server uses, link rewriting to item pages, and a crawler that follows local Markdown links (the part of `mdoc` that was Python).

```ts
import { renderMarkdown, renderFragment, crawlMarkdown, rewriteLinks, astLinks } from "@portfolio/render";
```

| Function | Does |
|----------|------|
| `pandocBin()` | `PANDOC_BIN`, else `pandoc` on `PATH`, else the Homebrew path |
| `pandocAvailable()` | true when the binary can run; tests skip when false |
| `runPandoc(args, input, bin?)` | one invocation, stdin to stdout; throws with stderr on failure |
| `markdownToAst(markdown)` | Pandoc JSON AST |
| `astLinks(ast)` | every link target in document order |
| `rewriteLinks(ast, sourcePath, resolveId)` | rewrites links to local Markdown into `/items/:id` when `resolveId(absolutePath)` knows the file; keeps `?query#fragment` |
| `renderMarkdown(markdown, { title, toc, sourcePath, resolveId, template, bin, date, highlight })` | a standalone page with sidebar TOC, section divs, and syntax highlighting |
| `renderFragment(markdown)` | HTML with no template, for embedding |
| `crawlMarkdown(roots, { recursive })` | `{ roots, files, edges }`; throws naming the linking file when a target is missing; HTML roots are included but not crawled |

## Example

```js
const ids = new Map([["/docs/guide.md", 7]]);
renderMarkdown("[guide](guide.md#setup)", { title: "Index", sourcePath: "/docs/index.md", resolveId: p => ids.get(p) });
// …<a href="/items/7#setup">guide</a>…

crawlMarkdown(["/docs/index.md"], { recursive: true });
// { roots: ["/docs/index.md"], files: ["/docs/guide.md", "/docs/index.md", "/docs/sub/deep.md"],
//   edges: Map { "/docs/index.md" => ["/docs/guide.md", "/docs/sub/deep.md"], "/docs/guide.md" => ["/docs/index.md"] } }
```

`MARKDOWN_READER` is exported for anything else that needs Pandoc to read the same dialect (`autolink_bare_uris`, `emoji`, `mark`, `wikilinks_title_before_pipe`, and no blank line needed before headers or lists).

Tests: `packages/render/test/render.test.ts`. Back to the [index](../index.md).
