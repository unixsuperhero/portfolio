import { describe, expect, test } from "bun:test";
import { addProjectParent, addWatchedDirectory, cardItems, categoryMembers, claimItem, countByType, createCard, createCategory, createPortfolio, deleteCard, deleteItems, deletePortfolio, ensureCategory, getCard, getItem, listItems, listProjectParents, listTags, memberSlots, moveCard, openDatabase, openStore, portfolioCards, portfolioView, removeTags, removeWatchedDirectory, setPathAndCategory, setSlotOverride, setTags, toggleItemField, updateCard, updateCategory, updateItem, upsertItem, viewItem } from "../src/index.ts";

const fresh = () => openDatabase(":memory:");

describe("items and tags", () => {
  test("upsert by source_path, patch, toggle, list filters, delete prunes tags", () => {
    const db = fresh();
    const a = upsertItem(db, { type: "note", title: "Alpha", content: "# Alpha\n\nbody about cats" });
    const doc = upsertItem(db, { type: "document", title: "Guide", content: "x", source_path: "/d/guide.md" });
    expect(upsertItem(db, { type: "document", title: "Guide 2", content: "y", source_path: "/d/guide.md" })).toBe(doc);
    expect(getItem(db, doc)?.title).toBe("Guide 2");
    setTags(db, a, ["cats", "Notes"]);
    setTags(db, doc, ["notes"]);
    expect(listTags(db).map(tag => [tag.name, tag.count])).toEqual([["cats", 1], ["Notes", 2]]);
    expect(viewItem(db, getItem(db, a)!)).toMatchObject({ pinned: false, tags: ["cats", "Notes"], href: `/items/${a}` });

    expect(updateItem(db, a, { pinned: true, description: "desc" })).toBe(true);
    expect(toggleItemField(db, doc, "starred")).toBe(true);
    expect(listItems(db, { pinned: true }).map(i => i.id)).toEqual([a]);
    expect(listItems(db, { starred: true }).map(i => i.id)).toEqual([doc]);
    expect(listItems(db, { type: "document" }).map(i => i.id)).toEqual([doc]);
    expect(listItems(db, { q: "alpha" }).map(i => i.id)).toEqual([a]);
    expect(listItems(db, { q: "cats" })).toHaveLength(0);
    expect(listItems(db, { q: "cats", contents: true }).map(i => i.id)).toEqual([a]);
    expect(listItems(db, { tagName: "notes" })).toHaveLength(2);
    expect(listItems(db, { limit: 1 })).toHaveLength(1);
    expect(countByType(db)).toMatchObject({ note: 1, document: 1, link: 0 });

    removeTags(db, a, ["cats"]);
    expect(listTags(db).map(tag => tag.name)).toEqual(["Notes"]);
    deleteItems(db, [a, doc]);
    expect(listTags(db)).toHaveLength(0);
    expect(listItems(db)).toHaveLength(0);
  });
});

describe("portfolios and cards", () => {
  test("cards OR tags, narrow by type, sort, cap, move, cascade", () => {
    const db = fresh();
    const add = (type: "link" | "pr", title: string, tags: string) => { const id = upsertItem(db, { type, title, url: `https://e.com/${title}` }); setTags(db, id, tags.split(",").map(s => s.trim()).filter(Boolean)); return id; };
    add("link", "Banana", "yt"); add("link", "apple", "slides"); add("pr", "Cherry", "yt, slides"); add("link", "Untagged", "");
    const pid = createPortfolio(db, "YT", "channel");
    expect(() => createPortfolio(db, "yt")).toThrow(/already exists/);
    const c1 = createCard(db, pid, { title: "Either", tags: "YT, slides", sort_key: "title", sort_dir: "asc" });
    const c2 = createCard(db, pid, { title: "Links", tags: "yt, slides", types: "link", sort_key: "title", sort_dir: "desc" });
    const c3 = createCard(db, pid, { title: "Future", tags: "future-tag" });
    expect(() => createCard(db, pid, { title: "" })).toThrow(/title/);
    const view = portfolioView(db, { id: pid, name: "YT", description: "", created_at: "" });
    expect(view.cards.map(c => c.title)).toEqual(["Either", "Links", "Future"]);
    expect(view.cards[0].items.map(i => i.title)).toEqual(["apple", "Banana", "Cherry"]);
    expect(view.cards[1].items.map(i => i.title)).toEqual(["Banana", "apple"]);
    expect(view.cards[2]).toMatchObject({ tags: ["future-tag"], total: 0, items: [] });
    expect(updateCard(db, c1, { max_items: 2 })).toBe(true);
    expect(cardItems(db, getCard(db, c1)!)).toMatchObject({ total: 3 });
    expect(cardItems(db, getCard(db, c1)!).items).toHaveLength(2);
    expect(moveCard(db, getCard(db, c1)!, "left")).toBe(false);
    expect(moveCard(db, getCard(db, c1)!, "right")).toBe(true);
    expect(portfolioCards(db, pid).map(c => c.id)).toEqual([c2, c1, c3]);
    expect(deleteCard(db, c3)).toBe(true);
    expect(deletePortfolio(db, pid)).toBe(true);
    expect(getCard(db, c1)).toBeNull();
  });
});

describe("categories and slots", () => {
  test("slots resolve per member, overrides, kind lock", () => {
    const db = fresh();
    const cat = createCategory(db, { name: "project", kind: "dir", slots: "tasks | file | TASKS.md\nlogs | dir | ~/Library/Logs/x" });
    expect(ensureCategory(db, { name: "project", kind: "dir", slots: [] }).id).toBe(cat);
    const id = upsertItem(db, { type: "dir", title: "app" });
    setPathAndCategory(db, id, "/Users/me/proj/app", cat);
    expect(categoryMembers(db, cat).map(i => i.id)).toEqual([id]);
    const slots = memberSlots(db, getItem(db, id)!, "/Users/me");
    expect(slots.map(s => s.path)).toEqual(["/Users/me/proj/app/TASKS.md", "/Users/me/Library/Logs/x"]);
    setSlotOverride(db, getItem(db, id)!, "tasks", "~/other/TASKS.md");
    expect(memberSlots(db, getItem(db, id)!, "/Users/me")[0]).toMatchObject({ path: "/Users/me/other/TASKS.md", overridden: true });
    expect(() => updateCategory(db, cat, { kind: "file" })).toThrow(/cannot change/);
    expect(updateCategory(db, cat, { slots: [] })).toBe(true);
    expect(memberSlots(db, getItem(db, id)!)).toEqual([]);
  });
});

describe("watched directories and project parents", () => {
  test("claims and cleanup", () => {
    const db = fresh();
    const w = addWatchedDirectory(db, "/docs", true);
    expect(() => addWatchedDirectory(db, "/docs")).toThrow(/already/);
    const a = upsertItem(db, { type: "document", title: "a", source_path: "/docs/a.md" });
    const b = upsertItem(db, { type: "document", title: "b", source_path: "/docs/b.md" });
    claimItem(db, w, a);
    claimItem(db, w, b);
    const w2 = addWatchedDirectory(db, "/docs/sub");
    claimItem(db, w2, b);
    expect(removeWatchedDirectory(db, w)).toBe(1);
    expect(getItem(db, a)).toBeNull();
    expect(getItem(db, b)).not.toBeNull();
    expect(addProjectParent(db, "/Users/me/proj")).toBe(true);
    expect(addProjectParent(db, "/Users/me/proj")).toBe(false);
    expect(listProjectParents(db)[0]).toMatchObject({ path: "/Users/me/proj", count: 0 });
  });
});

describe("store", () => {
  test("bound repos", () => {
    const store = openStore(":memory:");
    const id = store.items.upsertItem({ type: "note", title: "n" });
    store.tags.setTags(id, ["x"]);
    expect(store.items.viewItem(store.items.getItem(id)!).tags).toEqual(["x"]);
    expect(store.settings.getFlag("pastry_enabled")).toBe(false);
    store.settings.setFlag("pastry_enabled", true);
    expect(store.settings.getFlag("pastry_enabled")).toBe(true);
    store.close();
  });
});
