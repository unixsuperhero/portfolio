import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProjectParent, addWatchedDirectory, cardItems, categoryMembers, claimItem, completeReminder, completeTask, countByType, createCard, createCategory, createPortfolio, createReminder, createTask, deleteCard, deleteItems, deletePortfolio, deleteTask, dueReminders, ensureCategory, getCard, getHomePortfolioId, getItem, getPortfolio, getTask, listItems, listProjectParents, listReminderViews, listTags, listTaskViews, listTasks, memberSlots, migrateCardColumns, migrateGithubPrColumns, migratePortfolioScopeColumns, migrateReminderColumns, moveCard, openDatabase, openStore, portfolioCards, portfolioView, readSchema, removeTags, removeWatchedDirectory, setHomePortfolioId, setPathAndCategory, setReminders, setSlotOverride, setTags, taskView, todayReminders, toggleItemField, uncompleteTask, updateCard, updateCategory, updateItem, updateTask, upsertItem, viewItem } from "../src/index.ts";

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
    const view = portfolioView(db, { id: pid, name: "YT", description: "", tags: [], item_filter: {}, created_at: "" });
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
  test("portfolio scope combines ANY tag sets with card filters before the card cap", () => {
    const db = fresh();
    const add = (title: string, type: "link" | "note", tags: string) => {
      const id = upsertItem(db, { type, title, content: title, url: `https://example.test/${title}` });
      setTags(db, id, tags.split(",").map(tag => tag.trim()).filter(Boolean));
      return id;
    };
    add("house-link", "link", "house");
    add("bird-link", "link", "bird");
    add("dog-link", "link", "dog");
    add("house-note", "note", "house");
    add("unrelated-cat-link", "link", "cat");
    const id = createPortfolio(db, "Scoped", "", ["house", "bird", "dog"]);
    const card = createCard(db, id, { title: "Narrow", tags: ["house", "bird"], types: ["link"] });
    for (let index = 0; index < 110; index++) add(`extra-${index}`, "note", "house");
    const broadCard = createCard(db, id, { title: "All scoped", max_items: 1000 });
    const portfolio = getPortfolio(db, id)!;
    const view = portfolioView(db, portfolio);
    expect(view.cards.find(result => result.id === card)?.total).toBe(2);
    expect(view.cards.find(result => result.id === card)?.items.map(item => item.title).sort()).toEqual(["bird-link", "house-link"]);
    expect(view.cards.find(result => result.id === broadCard)).toMatchObject({ total: 114 });
    expect(view.cards.find(result => result.id === broadCard)?.items).toHaveLength(114);
    expect(view.scope_item_ids).toHaveLength(114);
    expect(portfolioView(db, { ...view, tags: [], item_filter: {} }).scope_active).toBe(false);
    expect(portfolioView(db, { ...view, tags: [], item_filter: { contents: true } }).scope_active).toBe(false);
    db.close();
  });

  test("legacy portfolio rows migrate with an empty scope", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE portfolios (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO portfolios(name) VALUES ('Legacy');");
    migratePortfolioScopeColumns(db);
    expect(db.query<{ tags: string; item_filter: string }, []>("SELECT tags, item_filter FROM portfolios").get()).toEqual({ tags: "[]", item_filter: "{}" });
    db.close();
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
    expect(store.tasks).toBeDefined();
    store.close();
  });
});

describe("card kind and config", () => {
  test("createCard/updateCard persist kind and config; non-query cards skip the SQL query", () => {
    const db = fresh();
    const pid = createPortfolio(db, "Dash");
    const cardId = createCard(db, pid, { title: "Clock", kind: "clock", config: { format: "24h" } });
    expect(getCard(db, cardId)).toMatchObject({ kind: "clock", config: { format: "24h" } });
    expect(updateCard(db, cardId, { title: "Clock", kind: "clock", config: { format: "12h" } })).toBe(true);
    expect(getCard(db, cardId)).toMatchObject({ config: { format: "12h" } });
    const view = portfolioView(db, getPortfolio(db, pid)!);
    expect(view.cards[0]).toMatchObject({ kind: "clock", items: [], total: 0 });
  });

  test("migrateCardColumns adds kind and config to a pre-existing cards table", () => {
    const raw = new Database(":memory:");
    const schema = readSchema().replace(/kind TEXT NOT NULL DEFAULT 'query',\s*\n\s*config TEXT NOT NULL DEFAULT '\{\}',\s*\n/, "");
    raw.exec(schema);
    expect(raw.query("PRAGMA table_info(cards)").all().map((c: any) => c.name)).not.toContain("kind");
    migrateCardColumns(raw);
    const columns = raw.query("PRAGMA table_info(cards)").all().map((c: any) => c.name);
    expect(columns).toContain("kind");
    expect(columns).toContain("config");
    raw.close();
  });

  test("migrateGithubPrColumns adds source_dir to a pre-existing github_prs table", () => {
    const raw = new Database(":memory:");
    const schema = readSchema().replace(/\s*-- the settings\.github_dirs entry gh ran from; NULL for the API's own cwd\n\s*source_dir TEXT,\n/, "\n");
    raw.exec(schema);
    expect(raw.query("PRAGMA table_info(github_prs)").all().map((c: any) => c.name)).not.toContain("source_dir");
    migrateGithubPrColumns(raw);
    expect(raw.query("PRAGMA table_info(github_prs)").all().map((c: any) => c.name)).toContain("source_dir");
    raw.close();
  });
});

describe("settings: home portfolio", () => {
  test("get/set, and clearing with null", () => {
    const db = fresh();
    expect(getHomePortfolioId(db)).toBeNull();
    setHomePortfolioId(db, 3);
    expect(getHomePortfolioId(db)).toBe(3);
    setHomePortfolioId(db, null);
    expect(getHomePortfolioId(db)).toBeNull();
  });
});

describe("tasks", () => {
  test("create, validate, update, reminders, complete/uncomplete, views", () => {
    const db = fresh();
    expect(() => createTask(db, { title: "", recurrence: "daily" })).toThrow(/title/);
    expect(() => createTask(db, { title: "x", recurrence: "weekly" as never })).toThrow(/recurrence/);
    const id = createTask(db, { title: "Stretch", recurrence: "daily", reminders: ["08:30"] });
    expect(() => setReminders(db, id, ["8:30"])).toThrow(/HH:MM/);
    expect(getTask(db, id)).toMatchObject({ title: "Stretch", recurrence: "daily", active: 1 });
    expect(listTasks(db).map(t => t.id)).toEqual([id]);
    expect(updateTask(db, id, { active: false })).toBe(true);
    expect(listTasks(db)).toHaveLength(0);
    expect(listTasks(db, { all: true })).toHaveLength(1);
    expect(updateTask(db, 999, { title: "x" })).toBe(false);

    const once = createTask(db, { title: "Ship it", recurrence: "once", reminders: ["2026-09-22T08:30"] });
    expect(() => setReminders(db, once, ["08:30"])).toThrow(/YYYY-MM-DDTHH:MM/);

    let view = completeTask(db, id, "2026-09-20");
    expect(view.last_completed).toBe("2026-09-20");
    completeTask(db, id, "2026-09-21");
    view = completeTask(db, id, "2026-09-22");
    expect(taskView(db, getTask(db, id)!, "2026-09-22")).toMatchObject({ completed_today: true, streak: 3 });
    view = uncompleteTask(db, id, "2026-09-22");
    expect(view.completed_today).toBe(false);

    const onceView = completeTask(db, once, "2026-09-22");
    expect(onceView.completed_today).toBe(true);
    expect(onceView.streak).toBe(0);

    expect(listTaskViews(db, { all: true }).map(t => t.id)).toEqual([id, once]);
    expect(deleteTask(db, once)).toBe(true);
    expect(getTask(db, once)).toBeNull();
  });

  test("dueReminders and todayReminders", () => {
    const db = fresh();
    const daily = createTask(db, { title: "Stretch", recurrence: "daily", reminders: ["08:30"] });
    const standalone = createReminder(db, { title: "Water", recurrence: "daily", at: "08:45" });
    const once = createTask(db, { title: "Ship it", recurrence: "once", reminders: ["2026-09-22T09:00"] });
    const now = new Date("2026-09-22T08:35:00");
    const due = dueReminders(db, { now, minutes: 60 });
    expect(due.map(d => d.reminder.task_id ?? d.reminder.id).sort()).toEqual([daily, standalone, once].sort());
    expect(dueReminders(db, { now, minutes: 4 })).toHaveLength(0);
    completeReminder(db, standalone, "2026-09-22");
    completeTask(db, daily, "2026-09-22");
    expect(dueReminders(db, { now, minutes: 60 }).map(d => d.reminder.task_id)).toEqual([once]);
    const today = todayReminders(db, "2026-09-22");
    expect(today.map(t => t.task_id ?? t.id).sort()).toEqual([daily, standalone, once].sort());
    expect(todayReminders(db, "2026-01-01").map(t => t.task_id ?? t.id).sort()).toEqual([daily, standalone].sort());
  });

  test("reminder weekdays: validation", () => {
    const db = fresh();
    const id = createTask(db, { title: "Stretch", recurrence: "daily" });
    expect(() => setReminders(db, id, [{ at: "08:30", days: [1, 8] }])).toThrow(/0-6/);
    expect(() => setReminders(db, id, [{ at: "08:30", days: [1.5] }])).toThrow(/0-6/);
    setReminders(db, id, [{ at: "08:30", days: [5, 1, 1, 3] }]);
    expect(taskView(db, getTask(db, id)!).reminders).toEqual([{ id: expect.any(Number), at: "08:30", days: [1, 3, 5] }]);

    const once = createTask(db, { title: "Ship it", recurrence: "once" });
    expect(() => setReminders(db, once, [{ at: "2026-09-22T08:30", days: [1] }])).toThrow(/once tasks/);
    expect(() => setReminders(db, once, [{ at: "2026-09-22T08:30", days: [] }])).toThrow(/once tasks/);
    setReminders(db, once, ["2026-09-22T08:30"]);
    expect(taskView(db, getTask(db, once)!).reminders).toEqual([{ id: expect.any(Number), at: "2026-09-22T08:30", days: [] }]);
  });

  test("reminder weekdays: dueReminders and todayReminders skip non-matching days", () => {
    const db = fresh();
    // 2026-09-21 is a Monday (weekday 1); Wednesday is 2026-09-23 (weekday 3).
    const monday = createTask(db, { title: "Standup", recurrence: "daily", reminders: [{ at: "08:30", days: [1] }] });
    const wednesday = createTask(db, { title: "Review", recurrence: "daily", reminders: [{ at: "08:30", days: [3] }] });
    const everyDay = createTask(db, { title: "Stretch", recurrence: "daily", reminders: ["08:30"] });

    const mondayNow = new Date("2026-09-21T08:35:00");
    expect(dueReminders(db, { now: mondayNow, minutes: 60 }).map(d => d.reminder.task_id).sort()).toEqual([monday, everyDay].sort());
    expect(todayReminders(db, "2026-09-21").map(t => t.task_id).sort()).toEqual([monday, everyDay].sort());

    const wednesdayNow = new Date("2026-09-23T08:35:00");
    expect(dueReminders(db, { now: wednesdayNow, minutes: 60 }).map(d => d.reminder.task_id).sort()).toEqual([wednesday, everyDay].sort());
    expect(todayReminders(db, "2026-09-23").map(t => t.task_id).sort()).toEqual([wednesday, everyDay].sort());
  });
  type ColumnInfo = { name: string };

  test("migrateReminderColumns adds days to a pre-existing reminders table", () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
        recurrence TEXT NOT NULL CHECK (recurrence IN ('daily','once')), item_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE reminders (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, at TEXT NOT NULL);
      INSERT INTO tasks(title, recurrence) VALUES ('Stretch', 'daily');
      INSERT INTO reminders(task_id, at) VALUES (1, '08:30');
    `);
    expect(raw.query<ColumnInfo, []>("PRAGMA table_info(reminders)").all().map(c => c.name)).not.toContain("days");
    migrateReminderColumns(raw);
    const columns = raw.query<ColumnInfo, []>("PRAGMA table_info(reminders)").all().map(c => c.name);
    expect(columns).toContain("days");
    expect(raw.query("SELECT days FROM reminders WHERE id = 1").get()).toEqual({ days: "[]" });
    raw.close();
  });

  test("opening a database created from the old reminders schema migrates it in place", () => {
    const path = join(tmpdir(), `portfolio-reminder-migration-${Date.now()}.sqlite`);
    const raw = new Database(path, { create: true, readwrite: true });
    raw.exec(`
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
        recurrence TEXT NOT NULL CHECK (recurrence IN ('daily','once')), item_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE reminders (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, at TEXT NOT NULL);
      INSERT INTO tasks(title, recurrence) VALUES ('Stretch', 'daily');
      INSERT INTO reminders(task_id, at) VALUES (1, '08:30');
    `);
    raw.close();
    const db = openDatabase(path);
    expect(db.query<ColumnInfo, []>("PRAGMA table_info(reminders)").all().map(c => c.name)).toContain("days");
    expect(taskView(db, getTask(db, 1)!).reminders).toEqual([{ id: 1, at: "08:30", days: [] }]);
    expect(listReminderViews(db, { all: true })[0]).toMatchObject({ id: 1, title: "Stretch", task_id: 1, at: "08:30", days: [] });
    db.close();
    unlinkSync(path);
  });
});
