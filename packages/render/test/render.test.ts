import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { astLinks, crawlMarkdown, markdownToAst, pandocAvailable, renderFragment, renderMarkdown, rewriteLinks } from "../src/index.ts";

const available = pandocAvailable();

describe.skipIf(!available)("pandoc", () => {
  test("renders with template and toc", () => {
    const html = renderMarkdown("# Title\n\n## Part\n\nHello *world*.", { title: "Doc", date: "Jan 1, 2026" });
    expect(html).toContain("<title>Doc</title>");
    expect(html).toContain("toc-sidebar");
    expect(html).toContain("<em>world</em>");
    expect(renderFragment("**b**")).toContain("<strong>b</strong>");
  });
  test("rewrites local markdown links to item pages", () => {
    const ids = new Map([["/d/b.md", 7]]);
    const html = renderMarkdown("[b](b.md#top) [x](https://x.dev) [c](c.md)", { title: "a", sourcePath: "/d/a.md", resolveId: path => ids.get(path), date: "x" });
    expect(html).toContain('href="/items/7#top"');
    expect(html).toContain('href="https://x.dev"');
    expect(html).toContain('href="c.md"');
  });
  test("ast links and crawl", () => {
    const dir = mkdtempSync(join(tmpdir(), "render-"));
    writeFileSync(join(dir, "index.md"), "# I\n\n[a](a.md) [b](sub/b.md?x=1) [img](i.png) [web](https://x.dev)");
    writeFileSync(join(dir, "a.md"), "[back](index.md) [b](sub/b.md)");
    writeFileSync(join(dir, "sub"), "", { flag: "a" });
    expect(astLinks(markdownToAst("[a](a.md) [b](b.md)"))).toEqual(["a.md", "b.md"]);
    expect(() => crawlMarkdown([join(dir, "index.md")], { recursive: true })).toThrow(/sub\/b.md/);
    expect(crawlMarkdown([join(dir, "index.md")], { recursive: false }).files).toEqual([join(dir, "index.md")]);
    const ast = markdownToAst("[a](a.md)");
    rewriteLinks(ast, "/d/x.md", () => 3);
    expect(astLinks(ast)).toEqual(["/items/3"]);
  });
});

test("pandoc availability is reported", () => { expect(typeof available).toBe("boolean"); });
