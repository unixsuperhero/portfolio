# Data model

Everything below is what the code actually passes around, written as JavaScript data. The TypeScript types live in [@portfolio/core](packages/core.md) (`packages/core/src/types.ts`) and the tables in `schema.sql`.

## Item

One row in `items`. Six types share the table; which columns matter depends on the type.

```js
const item = {
  id: 42,
  type: "document",          // "document" | "note" | "link" | "pr" | "file" | "dir"
  title: "Procedural thinking: complete master list",
  description: "The 120-item list with every sub-point.",
  content: "# Procedural thinking\n\n…",   // Markdown for document and note
  rendered_html: "<!doctype html>…",       // cached Pandoc output (or the HTML file itself)
  url: null,                                // link and pr: where it points
  source_path: "/Users/me/claude/docs/procedural.md",   // tracked file for imported documents
  path: null,                               // file and dir: the path on disk (need not exist)
  category_id: null,                        // file and dir: optional category
  slot_paths: "{}",                         // JSON: per-item overrides of category slots
  toc: 1, pinned: 1, starred: 0,            // 0 | 1
  created_at: "2026-09-01 10:00:00",
  updated_at: "2026-09-21 10:00:00",
};
```

What each type uses:

| type | content | url | source_path | path | opens at |
|------|---------|-----|-------------|------|----------|
| document | Markdown, or empty when HTML-backed | | tracked file | | `/items/:id` (or `/legacy/…` for old HTML) |
| note | Markdown | | | | `/items/:id` |
| link | | the URL | | | the URL |
| pr | | the PR URL | | | the URL |
| file | | | | a file path | `/items/:id` (path actions) |
| dir | | | | a directory | `/items/:id` (path actions, slots) |

## ItemView

The shape the JSON API returns and the React components take. Booleans instead of 0/1, tag names inlined, and the href already resolved.

```js
const view = {
  id: 42, type: "document", title: "…", description: "…",
  url: null, source_path: "/Users/me/claude/docs/procedural.md", path: null,
  pinned: true, starred: false,
  created_at: "2026-09-01 10:00:00", updated_at: "2026-09-21 10:00:00",
  href: "/items/42",
  tags: ["procedural thinking", "yt"],
};
```

`toItemView(item, tags)` in core and `viewItem(db, item)` in db make one.

## Tag and tagging

```js
const tag = { id: 1, name: "yt", created_at: "…" };   // name is unique, case-insensitive
// taggings: { tag_id: 1, item_id: 42 }
```

Tags with no items are deleted on every prune. A card may still name such a tag; it just matches nothing until something carries it again.

## Portfolio and Card

A portfolio is a page. A card is a saved query on that page.

```js
const portfolio = { id: 1, name: "YouTube", description: "everything for the channel", created_at: "…" };

const card = {
  id: 3, portfolio_id: 1, position: 2,
  title: "Scripts",
  kind: "query",                  // "query" | "reminders" | "ports" | "clock" | "note" | "services"
  config: {},                     // JSON object, shape depends on kind (see below)
  tags: ["yt", "slides"],        // OR: an item matches with any one; [] means any tag
  types: ["document"],           // AND: narrows the tag matches; [] means any type
  sort_key: "title",             // "created_at" | "updated_at" | "title" | "type"
  sort_dir: "asc",               // "asc" | "desc"
  max_items: 100,                // 1..1000
};
```

`kind: "query"` is what every card was before dashboard widgets existed; `tags`/`types`/`sort_key`/`sort_dir`/`max_items` only matter for that kind. The other kinds are widgets with their own `config`:

```js
// reminders: { scope: "today" | "all" }
// ports:     { project_id: undefined }        // omitted or absent = every listener
// clock:     { format: "24h" | "12h" }
// note:      { text: "some **markdown**" }    // edited in place
// services:  { project_id: 12 }               // scripts of one project, with run buttons
```

Running a `query` card gives:

```js
const result = { total: 37, items: [/* ItemView, at most max_items */] };
```

Every other kind always gets `{ total: 0, items: [] }` in a `PortfolioView` — `portfolioView(db, portfolio)` skips the SQL entirely once it sees the kind isn't `"query"`.

`cardItems(db, card)` runs a query card in SQL; `runCard(card, itemViews)` runs the same rules in memory (the demo and any client-side UI use that). `normalizeCard(formInput)` turns loose input into a valid spec: tags de-duplicated, every type checked collapses to `[]`, unknown sort keys fall back to `created_at`, max clamped, an unrecognized `kind` falls back to `"query"`, and `config` is accepted as an object or as JSON text (bad JSON becomes `{}`).

## Category and Slot

A category says what kind of item its members are and which files or directories every member has.

```js
const category = {
  id: 1, name: "project", kind: "dir",
  slots: [
    { name: "tasks", kind: "file", path: "TASKS.md" },              // relative: inside the member's path
    { name: "logs",  kind: "dir",  path: "~/Library/Logs/thing" },  // absolute or ~/: stands alone
  ],
};
```

Slots are resolved when read, never stored per member:

```js
const resolved = memberSlots(db, item);   // for item.path === "/Users/me/proj/app"
// [
//   { name: "tasks", kind: "file", path: "/Users/me/proj/app/TASKS.md", overridden: false, exists: true },
//   { name: "logs",  kind: "dir",  path: "/Users/me/Library/Logs/thing", overridden: false, exists: false },
// ]
```

A member's `slot_paths` JSON overrides one slot: `{ "tasks": "~/other/TASKS.md" }`. The text form used by forms and the CLI is one slot per line: `tasks | file | TASKS.md`.

## Detection

What the quick-add box decides about pasted text.

```js
await detect("https://github.com/x/y/pull/12");
// { shape: "url",  type: "pr",       title: "x/y#12", url: "https://github.com/x/y/pull/12" }
await detect("~/proj/portfolio");
// { shape: "path", type: "dir",      title: "portfolio", path: "/Users/me/proj/portfolio", exists: true }
await detect("~/notes/plan.md");
// { shape: "path", type: "document", title: "plan", path: "/Users/me/notes/plan.md", exists: true }
await detect("~/data/things.csv");
// { shape: "path", type: "file",     title: "things.csv", path: "…", exists: false }
await detect("# Plan\n\nsee https://x.dev");
// { shape: "text", type: "note",     title: "Plan", content: "# Plan\n\nsee https://x.dev" }
```

`shape` says which field the text fills; `type` is the guess a form or `--type` may override.

## Watched directory and claims

```js
const watched = { id: 1, path: "/Users/me/notes/docs", recursive: 1, created_at: "…", updated_at: "…" };
// watched_items: { watched_directory_id: 1, item_id: 42 }   one claim per (watch, document)
```

A reconcile scans every watch, upserts each `.md`/`.markdown`/`.html` as a document keyed by `source_path`, rewrites the claims, and deletes documents that no watch claims any more. Files on disk are never deleted.

## Project parent

```js
const parent = { id: 1, path: "/Users/me/proj" };
```

A scan adds every direct child, and any deeper directory (to four levels) with `.git` at its top, as a `dir` item in the `project` category with the `project` tag. It never removes.

## Ports snapshot

```js
const snapshot = {
  scanned_at: "2026-09-22T10:00:00Z", herdr_available: true, warnings: [],
  ports: [{
    port: 4387, host: "127.0.0.1", command: "bun", pid: 763, cwd: "/Users/me/proj/portfolio",
    elapsed: "8h 11m", started_at: "…",
    herdr: { workspace_label: "portfolio", pane_id: "p19", match: "cwd" },   // or null
    ai: { kind: "claude", session: "abcdef…" },                               // or null
    tree: [/* listener, then each ancestor */], children: [/* direct children */],
  }],
};
```

## Settings

A key/value table: `{ key: "pastry_enabled", value: "1" }`. `getFlag(db, "pastry_enabled")` reads it as a boolean; `getHomePortfolioId(db)`/`setHomePortfolioId(db, id | null)` read and write the `home_portfolio_id` key the same way. The JSON API's `Settings` shape bundles all of it:

```js
const settings = {
  home_portfolio_id: 3,           // or null
  pastry_enabled: false,
  watched_directories: [{ id: 1, path: "/Users/me/notes/docs", recursive: true }],
  project_parents: [{ id: 1, path: "/Users/me/proj", count: 12 }],
};
```

## Task, Reminder, and Completion

A task is a to-do with zero or more reminders. `recurrence: "daily"` repeats every day; `recurrence: "once"` fires at a specific date and time.

```js
const task = { id: 1, title: "Stretch", notes: "", recurrence: "daily", item_id: null, active: 1, created_at: "…" };
const reminder = { id: 1, task_id: 1, at: "08:30" };                 // daily: "HH:MM" local
// a "once" task's reminder instead reads "YYYY-MM-DDTHH:MM" local, e.g. "2026-09-22T08:30"
const completion = { id: 1, task_id: 1, on: "2026-09-22", at: "2026-09-22 08:41:00" };  // one row per (task, day)
```

The JSON API and the React components use `TaskView`, which folds in the reminders and computed completion state:

```js
const view = {
  id: 1, title: "Stretch", notes: "", recurrence: "daily", item_id: null, active: true, created_at: "…",
  reminders: [{ id: 1, at: "08:30" }],
  completed_today: true,     // daily: a completion for today; once: any completion at all
  last_completed: "2026-09-22",   // or null
  streak: 4,                 // daily only: consecutive days ending today or yesterday
};
```

`dueReminders(db, { now?, minutes = 60 })` returns `{ task: TaskView, reminder, due_at }` for every reminder within `minutes` of `now` that isn't already completed — a daily reminder's `due_at` is today's date plus its `"HH:MM"`; a once reminder's `due_at` is its own datetime. `todayTasks(db, today?)` returns every daily task plus any once task with a reminder dated today.

## Project view

The JSON API's shape for a project (a `dir` item in the `project` category), combining the item with its runnable scripts and the ports currently listening under its path:

```js
const project = {
  id: 12, title: "portfolio", path: "/Users/me/proj/portfolio", description: "~/proj/portfolio", tags: ["project"],
  services: { runner: "bun", scripts: { dev: "bun run app.js" }, make_targets: ["build"] },
  ports: [/* PortEntry, filtered to entries whose cwd is inside path */],
  slots: [/* ResolvedSlot, from the project category */],
};
```

`@portfolio/watch`'s `projectServices(path)` builds `services`: the runner comes from the lockfile (`bun.lock(b)` → `bun`, `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `package-lock.json` → `npm`, a bare `package.json` → `npm`, none of those → `null`), `scripts` is `package.json`'s `scripts` object, and `make_targets` is every `name:` line in a `Makefile` except `.PHONY` and anything starting with `.`. `serviceCommand(services, name, args)` turns one script or target into the exact shell line to run, e.g. `"bun run dev --port 3000"` or `"make build"`.

Back to the [index](index.md).
