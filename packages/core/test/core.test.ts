import { describe, expect, test } from "bun:test";
import { abbreviatePath, BLANK_CARD, cardMatches, describeCard, detect, detectUrl, documentTitle, escapeHtml, expandPath, formatSlots, itemHref, kindLabel, localMarkdownLink, normalizeCard, normalizeItemPath, parseCardRow, parseSlots, parseTags, resolveSlots, runCard, slugify, textTitle } from "../src/index.ts";
import type { ItemView } from "../src/index.ts";

const HOME = "/Users/me";

describe("text", () => {
  test("escapeHtml, slugify, parseTags", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(slugify("Hello, World! 2026")).toBe("hello-world-2026");
    expect(parseTags(" yt, slides ,,yt ")).toEqual(["yt", "slides"]);
  });
  test("titles", () => {
    expect(documentTitle("<html><title> Q3 </title>", "/x/report.html")).toBe("Q3");
    expect(documentTitle("hi", "/x/report.html")).toBe("report");
    expect(documentTitle("# Guide\n\ntext", "/x/guide.md")).toBe("Guide");
    expect(textTitle("\n\nfirst line\nsecond")).toBe("first line");
    expect(textTitle("")).toBe("Untitled");
  });
});

describe("paths", () => {
  test("expand and abbreviate", () => {
    expect(expandPath("~/proj", HOME)).toBe("/Users/me/proj");
    expect(expandPath("~", HOME)).toBe(HOME);
    expect(abbreviatePath("/Users/me/proj/x", HOME)).toBe("~/proj/x");
    expect(abbreviatePath("/opt/x", HOME)).toBe("/opt/x");
    expect(normalizeItemPath("~/a/../b", HOME)).toBe("/Users/me/b");
    expect(() => normalizeItemPath("relative", HOME)).toThrow();
  });
  test("localMarkdownLink", () => {
    expect(localMarkdownLink("/d/a.md", "b.md#top")).toEqual({ sourcePath: "/d/b.md", suffix: "#top" });
    expect(localMarkdownLink("/d/a.md", "sub/c%20d.md?x=1")).toEqual({ sourcePath: "/d/sub/c d.md", suffix: "?x=1" });
    expect(localMarkdownLink("/d/a.md", "https://x.dev/b.md")).toBeNull();
    expect(localMarkdownLink("/d/a.md", "#anchor")).toBeNull();
    expect(localMarkdownLink("/d/a.md", "image.png")).toBeNull();
  });
});

describe("detect", () => {
  const probe = async (path: string) => (path.endsWith("/docs") ? "dir" : path.includes("exists") ? "file" : null) as "dir" | "file" | null;
  test("urls", () => {
    expect(detectUrl("https://github.com/x/y/pull/12")).toMatchObject({ type: "pr", title: "x/y#12" });
    expect(detectUrl("https://gitlab.com/g/p/-/merge_requests/3")).toMatchObject({ type: "pr", title: "gitlab.com/g/p/-/merge_requests/3" });
    expect(detectUrl("https://remotion.dev/docs/")).toMatchObject({ type: "link", title: "remotion.dev/docs" });
    expect(detectUrl("see https://x.dev")).toBeNull();
  });
  test("paths and text", async () => {
    expect(await detect("~/docs", { probe, home: HOME })).toMatchObject({ type: "dir", title: "docs", exists: true, path: "/Users/me/docs" });
    expect(await detect("/x/exists.md", { probe })).toMatchObject({ type: "document", title: "exists", exists: true });
    expect(await detect("/x/later.csv", { probe })).toMatchObject({ type: "file", title: "later.csv", exists: false });
    expect(await detect("see https://x.dev for more\nnotes", { probe })).toMatchObject({ type: "note", title: "see https://x.dev for more" });
    expect(await detect("# Plan\n\n- a", { probe })).toMatchObject({ type: "note", title: "Plan" });
  });
});

describe("slots", () => {
  test("parse, format, resolve", () => {
    const slots = parseSlots("tasks | file | TASKS.md\nlogs | dir | ~/Library/Logs/thing\n");
    expect(formatSlots(slots)).toBe("tasks | file | TASKS.md\nlogs | dir | ~/Library/Logs/thing");
    expect(() => parseSlots("bad line")).toThrow(/must read/);
    expect(() => parseSlots("a | file | x\nA | dir | y")).toThrow(/unique/);
    const resolved = resolveSlots(slots, { memberPath: "/Users/me/proj/app", overrides: { logs: "/var/log/app" }, home: HOME, exists: path => path.endsWith("TASKS.md") });
    expect(resolved[0]).toMatchObject({ path: "/Users/me/proj/app/TASKS.md", exists: true, overridden: false });
    expect(resolved[1]).toMatchObject({ path: "/var/log/app", exists: false, overridden: true });
    expect(resolveSlots(slots, { home: HOME, exists: () => false })[0].path).toBeNull();
  });
});

describe("cards", () => {
  const view = (id: number, type: ItemView["type"], title: string, tags: string[]): ItemView => ({ id, type, title, description: "", url: null, source_path: null, path: null, pinned: false, starred: false, created_at: `2026-01-0${id}`, updated_at: `2026-01-0${id}`, href: `/items/${id}`, tags });
  const items = [view(1, "link", "Banana", ["yt"]), view(2, "link", "apple", ["slides"]), view(3, "pr", "Cherry", ["yt", "slides"]), view(4, "link", "Untagged", [])];
  test("normalize", () => {
    expect(normalizeCard({ title: " X ", tags: "YT, slides", types: ["link", "bogus"], sort_key: "bogus", sort_dir: "asc", max_items: "5000" })).toEqual({ title: "X", tags: ["YT", "slides"], types: ["link"], sort_key: "created_at", sort_dir: "asc", max_items: 1000, kind: "query", config: {} });
    expect(normalizeCard({ types: ["document", "note", "link", "pr", "file", "dir"] }).types).toEqual([]);
    expect(normalizeCard({}).max_items).toBe(100);
  });
  test("run in memory", () => {
    const either = normalizeCard({ tags: "yt, slides", sort_key: "title", sort_dir: "asc" });
    expect(runCard(either, items).items.map(i => i.title)).toEqual(["apple", "Banana", "Cherry"]);
    const links = normalizeCard({ tags: "yt, slides", types: "link", sort_key: "title", sort_dir: "desc" });
    expect(runCard(links, items).items.map(i => i.title)).toEqual(["Banana", "apple"]);
    const capped = normalizeCard({ tags: "yt, slides", sort_key: "title", sort_dir: "asc", max_items: 2 });
    expect(runCard(capped, items)).toMatchObject({ total: 3 });
    expect(runCard(normalizeCard({}), items).total).toBe(4);
    expect(cardMatches({ tags: ["future"], types: [] }, items[0])).toBe(false);
    expect(describeCard(capped)).toBe("#yt #slides · title asc · max 2");
  });
});

describe("items", () => {
  test("href and labels", () => {
    expect(itemHref({ id: 1, type: "link", url: "https://x", content: "", source_path: null })).toBe("https://x");
    expect(itemHref({ id: 2, type: "note", url: null, content: "x", source_path: null })).toBe("/items/2");
    expect(itemHref({ id: 3, type: "document", url: null, content: "", source_path: "/d/r.html" }, { legacyHref: () => "/legacy/r.html" })).toBe("/legacy/r.html");
    expect(itemHref({ id: 3, type: "document", url: null, content: "", source_path: "/d/r.html" })).toBe("/items/3");
    expect(kindLabel("pr")).toBe("PR");
  });
});

describe("card kind and config", () => {
  test("BLANK_CARD defaults to query with empty config", () => {
    expect(BLANK_CARD).toMatchObject({ kind: "query", config: {} });
  });
  test("normalizeCard accepts an object or JSON text config, and falls back to query for an unknown kind", () => {
    expect(normalizeCard({ title: "x", kind: "clock", config: { format: "24h" } })).toMatchObject({ kind: "clock", config: { format: "24h" } });
    expect(normalizeCard({ title: "x", kind: "clock", config: '{"format":"12h"}' })).toMatchObject({ config: { format: "12h" } });
    expect(normalizeCard({ title: "x", kind: "not-a-kind" })).toMatchObject({ kind: "query" });
    expect(normalizeCard({ title: "x", config: "not json" })).toMatchObject({ config: {} });
    expect(normalizeCard({ title: "x", config: "[1,2]" })).toMatchObject({ config: {} });
    expect(normalizeCard({ title: "x" })).toMatchObject({ config: {} });
  });
  test("parseCardRow parses tags, types, and config JSON", () => {
    const row = { id: 1, portfolio_id: 1, position: 0, title: "x", tags: '["a"]', types: '["note"]', config: '{"scope":"today"}', sort_key: "created_at" as const, sort_dir: "desc" as const, max_items: 10, kind: "reminders" as const };
    expect(parseCardRow(row)).toMatchObject({ tags: ["a"], types: ["note"], config: { scope: "today" } });
  });
});
