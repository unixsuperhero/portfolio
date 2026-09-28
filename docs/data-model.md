# Data model

This reference covers the records in epic `td-623ef3`, checked against source on 2026-09-28. The shared types live in [core types](../packages/core/src/types.ts), and the canonical tables live in [the packaged schema](../packages/db/src/schema.sql). `bin/pf db schema` reads that schema; `bin/pf db schema --live` reads the configured database.

Examples use illustrative IDs and paths. Item, task, reminder, and watched-directory rows retain SQLite integer booleans and JSON strings. API projections decode those values. Portfolio, card, category, and PR examples show decoded records, not raw SQL rows. External snapshots and proposed records are marked separately.

## Ownership and relationships

| Concepts | Authority and reusable owner | Identity |
| --- | --- | --- |
| Items, tags, categories, slots | `@portfolio/core` records and rules; `@portfolio/db` persistence | Integer row IDs; tag and category names are case-insensitive unique |
| Portfolios and cards | `@portfolio/core` card rules; `@portfolio/db` queries | Integer IDs; portfolio names are case-insensitive unique |
| Tasks, reminders, completions | `@portfolio/db` domain operations and schema triggers; core view types | Integer IDs; completions are unique by entity and date |
| Watches and claims | `@portfolio/db` claims; `@portfolio/watch` reconciliation; injected renderer | Watch path is unique; claim key is watch ID plus item ID |
| Projects and services | Directory items and `project_parents`; `@portfolio/watch` discovery | Project item ID; unique parent path; scripts come from files |
| PRs, checks, events | GitHub via `@portfolio/github`; cached by `@portfolio/db` | Unique PR URL; checks are embedded values, events have row IDs |
| Settings | `@portfolio/db`; API composes the settings response | Text key |
| Herdr sessions and entities | External Herdr process; `@portfolio/herdr` transport and projection | Session name plus entity kind plus entity ID |
| Ports and processes | Operating system via `@portfolio/ports` | Transient PID and listener address, not durable project identity |
| Git repositories, branches, worktrees | Git; adapter records below are proposed | No Portfolio table or implemented identity contract |

```text
Portfolio 1 ── many Cards ── item queries or domain widgets
Item many ── Tagging ── many Tags
Category 1 ── many Items; category slots + item overrides ── resolved slots
Task 1 ── 1 owning Item via items.task_id
Task many ── optional associated Item via tasks.item_id
Task many ── optional parent Task
Task 1 ── many Completions
Task 1 ── many optional linked Reminders ── many ReminderCompletions
WatchedDirectory many ── WatchedItem ── many document Items
ProjectParent ── directory discovery ── project-category Items
PR ── embedded Checks; PR 1 ── many PrEvents; PR ── optional Item
Herdr session ── Workspaces ── Tabs ── Panes with agent state
```

The 16 application tables are `items`, `tags`, `taggings`, `categories`, `portfolios`, `cards`, `tasks`, `reminders`, `completions`, `reminder_completions`, `watched_directories`, `watched_items`, `project_parents`, `github_prs`, `github_pr_events`, and `settings`. `items_fts` and its shadow tables implement search, not separate domain concepts.

For module composition, see [architecture](architecture.md#reuse-boundaries). For commands and unresolved coverage, see [CLI coverage](cli/coverage.md).

## Item

One row in `items`. Seven types share the table; which columns matter depends on the type.

```js
const item = {
  id: 42,
  type: "document",          // "document" | "note" | "link" | "pr" | "file" | "dir" | "task"
  title: "Procedural thinking: complete master list",
  description: "The 120-item list with every sub-point.",
  content: "# Procedural thinking\n\n…",   // Markdown for document and note
  rendered_html: "<!doctype html>…",       // cached Pandoc output (or the HTML file itself)
  url: null,                                // link and pr: where it points
  source_path: "/Users/me/claude/docs/procedural.md",   // tracked file for imported documents
  task_id: null,                            // task: the associated tasks row
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
| task | task notes | | | | `/items/:id` (completion and subtasks) |

Notes, documents, links, files, and directories are variants of this record, not separate tables. `source_path` is unique and reserved for imported documents. A partial unique index covers non-null `path` values. Triggers maintain the title, description, and content search index. Deleting a category nulls `category_id`; deleting an item removes its taggings and watch claims.

## ItemView

The shape the JSON API returns and the React components take. Booleans instead of 0/1, tag names inlined, and the href already resolved.

```js
const view = {
  id: 42, type: "document", title: "…", description: "…",
  url: null, source_path: "/Users/me/claude/docs/procedural.md", task_id: null, path: null,
  pinned: true, starred: false,
  created_at: "2026-09-01 10:00:00", updated_at: "2026-09-21 10:00:00",
  href: "/items/42",
  tags: ["procedural thinking", "yt"],
};
```

`toItemView(item, tags)` in core and `viewItem(db, item)` in db make one.

`ItemView` omits content, cached HTML, category configuration, and slot overrides.

## Tag and tagging

```js
const tag = { id: 1, name: "yt", created_at: "…" };   // name is unique, case-insensitive
// taggings: { tag_id: 1, item_id: 42 }
```

Tags with no items are deleted on every prune. A card may still name such a tag; it just matches nothing until something carries it again.

`taggings` uses `(tag_id, item_id)` as its primary key. Deleting either endpoint cascades its taggings.

## Portfolio and Card

A portfolio is a page. A card is a saved query or a domain widget on that page.

```js
const portfolio = {
	id: 1, name: "YouTube", description: "everything for the channel",
	tags: ["work"], item_filter: { q: "video", type: "note", pinned: false },
	created_at: "…",
};

const card = {
  id: 3, portfolio_id: 1, position: 2,
  title: "Scripts",
  kind: "query",                  // "query" | "tasks" | "reminders" | "ports" | "clock" | "note" | "services" | "prs"
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
// tasks:     {}                              // active tasks with nested subtasks and completion checkboxes
// reminders: { scope: "today" | "all" }
// ports:     { project_id: undefined }        // omitted or absent = every listener
// clock:     { format: "24h" | "12h" }
// note:      { text: "some **markdown**" }    // edited in place
// services:  { project_id: 12 }               // scripts of one project, with run buttons
// prs:       {}                              // PR widget
```

Note cards render CommonMark and GitHub-flavored Markdown, including tables, nested lists, checklists, strikethrough, and fenced code. Raw HTML is ignored and unsafe link protocols are removed. Both the inline editor and the card configuration editor accept Markdown text.

Running a `query` card gives:

```js
const result = { total: 37, items: [/* ItemView, at most max_items */] };
```

Every other kind always gets `{ total: 0, items: [] }` in a `PortfolioView` — `portfolioView(db, portfolio)` skips the SQL entirely once it sees the kind isn't `"query"`.

`cardItems(db, card)` runs a query card in SQL; `runCard(card, itemViews)` runs the same rules in memory (the demo and any client-side UI use that). `normalizeCard(formInput)` turns loose input into a valid spec: tags de-duplicated, every type checked collapses to `[]`, unknown sort keys fall back to `created_at`, max clamped, an unrecognized `kind` falls back to `"query"`, and `config` is accepted as an object or as JSON text (bad JSON becomes `{}`).

Portfolio `tags` and `item_filter`, and card `tags`, `types`, and `config` are JSON TEXT in SQLite. Portfolio filters accept `q`, `contents`, `pinned`, `starred`, `type`, `tag`, `tagName`, and `category`, but not `limit`. Deleting a portfolio cascades its cards. Card tags are names, not foreign keys. A note widget's `config.text` is not a library note.

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

Slots are embedded category JSON, not independent rows. Only the overrides are stored per item; the resolved path and existence flag are derived.

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

Documents can have several watch claims. Removing the last claim deletes the managed item, not the source file. A failed directory scan retains its previous claims.

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

This snapshot is external, not persisted in Portfolio. PID and port assignments can change or be reused. A matching working directory does not make a process a durable project or agent record.

## Settings

A key/value table: `{ key: "pastry_enabled", value: "1" }`. `getFlag(db, "pastry_enabled")` reads it as a boolean; `getHomePortfolioId(db)`/`setHomePortfolioId(db, id | null)` read and write the `home_portfolio_id` key the same way. The JSON API's `Settings` shape bundles all of it:

```js
const settings = {
  home_portfolio_id: 3,           // or null
  pastry_enabled: false,
  watched_directories: [{ id: 1, path: "/Users/me/notes/docs", recursive: true }],
  project_parents: [{ id: 1, path: "/Users/me/proj", count: 12 }],
  github_ignored_check_rules: [{ repo: "acme/app", check: "codecov/*" }],
  github_ignored_repos: ["acme/*"],       // owner/repo globs; matching PRs are hidden from every list and never notify
  github_poll_minutes: 2,                 // cadence while at least one PR is watched; 10 minutes fixed otherwise
  github_dirs: ["/Users/me/work/acme"],
  github_pr_views: [{ id: "reviews", label: "Reviews", query: "collection=review_requested&state=open" }],
  github_pr_default_view: "reviews",
};
```

## Pull request (Pr) and PrEvent

A cached GitHub record in `github_prs`, collected through `gh` by [@portfolio/github](packages/github.md). The example is the API projection: JSON arrays and booleans are decoded, and `checks_summary` is derived.

```js
const pr = {
  id: 7,
  url: "https://github.com/acme/app/pull/12", owner: "acme", repo: "app", number: 12,
  title: "Add widgets", author: "jearsh", is_draft: false,
  state: "open",                                    // "open" | "closed" | "merged"
  review_decision: "review_required",               // "approved" | "changes_requested" | "review_required" | null
  updated_at: "2026-09-22T14:00:00Z",
  comments: 4,                                       // issue comments + review comments + reviews
  checks: [{ name: "ci/test", status: "success", url: "…", ignored: false }],
  checks_summary: "success",                          // "success" | "failure" | "pending" | "none", over non-ignored checks only
  watched: true, ignored_checks: ["codecov/patch"],   // matching repository rules applied during the latest refresh
  ignored: false,                                      // hidden everywhere when true; only PATCH /api/prs/:id sets it, polling never does
  lists: ["mine"],                                     // which search lists it currently appears in ([] for watched-only)
  item_id: 42,                                         // the library `pr` item, created when watched (or null)
  source_dir: "/Users/me/work/acme",                     // configured gh working directory, or null
  fetched_at: "2026-09-22T14:02:00Z",
};

const prEvent = {
  id: 1, pr_id: 7,
  kind: "checks",                    // "state" | "comments" | "checks" | "review"
  message: "acme/app#12 checks failure",
  at: "2026-09-22T14:02:00Z",
  seen: false,
};
```

`checks[].status` is one of `"success" | "failure" | "pending" | "skipped" | "cancelled" | "neutral"`. `diffPr(previous, next, globalIgnored)` (in `@portfolio/github`) drafts a `PrEvent` for a state change, a `review_decision` change, a comment-count increase, or a `checks_summary` change (computed over the global + per-PR ignored glob patterns); a PR seen for the first time produces no events. `store.github.setWatched(db, id, watched)` creates (or re-links) the library `pr` item the first time a PR is watched — unwatching leaves the item in place.

### Check identity and proposed normalization

PR URLs are unique. Deleting a PR cascades its events; deleting a linked library item nulls `item_id`. `source_dir` is the configured directory from which `gh` ran, not a project foreign key. One GitHub repository can have several local checkouts.

Current `PrCheck` is an embedded `{ name, status, url, ignored }` value in `github_prs.checks`. There is no `checks` table, check ID, or PR/check join table. Repository ignore rules live in settings; `ignored_checks` records the patterns applied during refresh.

The epic's normalized design remains a proposal, not an implemented contract:

```js
const check = { id: 9, name: "ci/test" };
const prCheck = { pr_id: 7, check_id: 9, status: "success", ignore_result: false };
```

Normalization is deferred in favor of the existing embedded checks. Adoption needs a decision about identity across repositories, workflow runs, and reruns; URL and attempt history storage; and whether ignore state is stored per pair or derived from rules. A migration and all callers must change together. `ignored` has not been renamed to `ignore_result`.

Poller state is runtime data, not a table:

```js
const prStatus = {
	last_poll_at: null, next_poll_at: null, rate: null,
	polling: false, error: null, gh_ok: true, login: "developer",
};
// When available: rate = { remaining: 4000, reset_at: "…" }
```

## Task, Reminder, and Completion

A task is a to-do. A reminder is a separately scheduled notification, optionally linked to a task. Both support `once` and `daily` recurrence and have separate completion histories.

```js
const task = { id: 1, title: "Stretch", notes: "", recurrence: "daily", item_id: null, parent_id: null, active: 1, created_at: "…" };
const reminder = { id: 1, title: "Call the dentist", notes: "", recurrence: "once", task_id: null, at: "2026-09-24T09:00", days: "[]", active: 1, created_at: "…" };
// Daily reminders use "HH:MM" local time and weekdays such as "[1,3,5]"; "[]" means every day.
const completion = { id: 1, task_id: 1, on: "2026-09-22", at: "2026-09-22 08:41:00" };  // one row per (task, day)
const reminderCompletion = { id: 1, reminder_id: 1, on: "2026-09-24", at: "2026-09-24 09:00:00" };
```

`TaskInput.reminders` accepts either a plain `"HH:MM"`/`"YYYY-MM-DDTHH:MM"` string or `{ at, days? }`, where `days` is `number[]` (0 = Sunday … 6 = Saturday), validated to integers 0-6, de-duplicated and sorted. Once-tasks reject `days` with an error. Omitted or `[]` fires every day.

`ReminderCreateInput` accepts `{ title, notes?, recurrence?, at, days?, task_id?, active? }`. Omitting `task_id` creates a standalone reminder with no task or Library item. Completing a reminder does not complete its linked task. Deleting a task detaches its reminders rather than deleting them. Existing task-owned reminders retain their IDs, schedules, weekdays, and completion history during migration.

`parent_id` references another task, or is `null` for a top-level task. The API rejects missing parents and cycles. Completing a task does not complete its parent or children. Deleting a parent promotes its direct children to top-level tasks.

Every task has one Library item with `type: "task"` and `task_id` pointing to the task. Database triggers synchronize task titles and notes with item titles and content. Deleting either record removes its counterpart. The existing `tasks.item_id` remains an optional link to another item, not the task's own Library entry. Existing tasks gain Library entries when the database opens.

Deleting a task cascades its completions; deleting a reminder cascades its own completion history. These records are Portfolio application tasks, not `td` issues. The epic and P2 tickets live in the separate `td` tracker.

```js
const parent = { title: "Ship release", parent_id: null };
const subtask = { title: "Run checks", parent_id: 12 }; // task 12 is the parent
```

The JSON API and the React components use `TaskView`, which folds in the reminders and computed completion state:

```js
const view = {
  id: 1, title: "Stretch", notes: "", recurrence: "daily", item_id: null, parent_id: null, active: true, created_at: "…",
  reminders: [{ id: 1, at: "08:30", days: [1, 3, 5] }],   // days: number[], [] = every day
  completed_today: true,     // daily: a completion for today; once: any completion at all
  last_completed: "2026-09-22",   // or null
  streak: 4,                 // daily only: consecutive days ending today or yesterday
};
```

```js
const reminderView = {
	id: 5, title: "Check release", notes: "", recurrence: "daily",
	at: "09:00", days: [1, 3, 5], task_id: 12, active: true, created_at: "…",
	completed_today: false, last_completed: null, streak: 0,
};
const dueReminder = { reminder: reminderView, due_at: "2026-09-28T09:00:00" };
```

`dueReminders(db, { now?, minutes = 60 })` returns `{ reminder: ReminderView, due_at }` for scheduled occurrences within the time window. It excludes completed reminders and reminders linked to completed or inactive tasks. Weekdays apply to each occurrence's local date. `todayReminders(db, today?)` returns active reminders scheduled for that date, including their completion state. Tasks without reminders are not included.

## Project view

The JSON API's shape for a project (a `dir` item in the `project` category), combining the item with its runnable scripts and the ports currently listening under its path:

```js
const project = {
  id: 12, title: "portfolio", path: "/Users/me/proj/portfolio", description: "~/proj/portfolio", tags: ["project"],
  created_at: "…", updated_at: "…",
  services: { runner: "bun", scripts: { dev: "bun run app.js" }, make_targets: ["build"] },
  ports: [/* PortEntry, filtered to entries whose cwd is inside path */],
  slots: [/* ResolvedSlot, from the project category */],
};
```

`@portfolio/watch`'s `projectServices(path)` builds `services`: the runner comes from the lockfile (`bun.lock(b)` → `bun`, `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `package-lock.json` → `npm`, a bare `package.json` → `npm`, none of those → `null`), `scripts` is `package.json`'s `scripts` object, and `make_targets` is every `name:` line in a `Makefile` except `.PHONY` and anything starting with `.`. `serviceCommand(services, name, args)` turns one script or target into the exact shell line to run, e.g. `"bun run dev --port 3000"` or `"make build"`.

## Git repositories, branches, and worktrees

Portfolio has no repository, branch, or worktree tables. Project discovery recognizes `.git`, but a project directory need not be a Git repository. These are proposed adapter records from the epic, not current TypeScript contracts:

```js
const repository = {
	git_common_dir: "/projects/app/.git", worktree_paths: ["/projects/app"],
};
const branch = {
	git_common_dir: "/projects/app/.git", ref: "refs/heads/main", head_oid: "<commit oid>",
};
const worktree = {
	path: "/projects/app", git_common_dir: "/projects/app/.git",
	branch_ref: "refs/heads/main", head_oid: "<commit oid>", detached: false, bare: false,
};
```

Git remains the authority. A branch belongs to a repository; a worktree checks out a branch or detached commit. Repository identity, bare repositories, detached HEAD, and missing worktrees need explicit contracts before implementation. Paths are machine-local and refs can move. This documentation creates neither Git persistence nor worktrees.

## Herdr sessions and entities

[Herdr contracts](../packages/herdr/src/index.ts) define Portfolio's stable projection. The [server adapter](../packages/herdr/src/server.ts) discovers sessions through `herdr session list --json`, reads `herdr api schema --json`, and calls `session.snapshot` over Unix sockets. Herdr owns the processes and runtime state. No Portfolio SQLite tables store them.

```js
const session = {
	name: "default", default: true, running: true,
	session_dir: "/home/me/.config/herdr", socket_path: "/home/me/.config/herdr/herdr.sock",
	snapshot: {
		version: 1, protocol: 1,
		focused_workspace_id: "w1", focused_tab_id: "t1", focused_pane_id: "p1",
		workspaces: [], tabs: [], panes: [], layouts: [], agents: [],
	},
	error: null,
};
const overview = { sessions: [session], updated_at: "…" };
const command = { session: "default", method: "pane.get", params: { pane_id: "p1" } };
const result = { result: {}, events: [] };
```

Version and protocol numbers are illustrative. The installed schema is authoritative. A server is the process and socket serving a named session, not a separate Portfolio row. Session lifecycle actions are `start`, `stop`, and `delete`. A stopped session has `snapshot: null`; an inaccessible running session can have a null snapshot plus an error.

Commands optionally accept `capture_ms` for bounded event capture. `HerdrCatalog` contains `protocol`, `operations`, and `definitions`. Each operation has `method`, `group`, `readOnly`, `fields`, and `schema`. Each field has `name`, `required`, `kind`, `choices`, `description`, and `schema`; kinds are `string`, `number`, `boolean`, or `json`. The catalog comes from the installed schema, not a second static operation list.

The following raw field sets were observed by P2 `td-e74c33` on 2026-09-27. They are version-dependent external examples, not guaranteed Portfolio interfaces. Nested empty objects abbreviate opaque payloads.

```js
const workspace = {
	workspace_id: "w1", label: "app", number: 1, active_tab_id: "t1",
	agent_status: "…", focused: true, pane_count: 2, tab_count: 1,
};
const tab = {
	workspace_id: "w1", tab_id: "t1", label: "work", number: 1,
	agent_status: "…", focused: true, pane_count: 2,
};
const pane = {
	workspace_id: "w1", tab_id: "t1", pane_id: "p1", terminal_id: "…",
	agent: "…", agent_session: {}, agent_status: "…",
	cwd: "/projects/app", foreground_cwd: "/projects/app", focused: true,
	revision: 1, scroll: {}, terminal_title: "work", terminal_title_stripped: "work",
};
const agent = {
	workspace_id: "w1", tab_id: "t1", pane_id: "p1", terminal_id: "…",
	agent: "…", agent_session: {}, agent_status: "…",
	cwd: "/projects/app", foreground_cwd: "/projects/app", focused: true,
	revision: 1, terminal_title: "work", terminal_title_stripped: "work",
	screen_detection_skipped: false, state_change_seq: 1,
};
const layout = {
	workspace_id: "w1", tab_id: "t1", focused_pane_id: "p1", zoomed: false,
	area: {}, panes: [], splits: [],
};
const entity = {
	key: '["default","pane","p1"]', kind: "pane", id: "p1", label: "work",
	session: "default", workspace: "w1", tab: "t1", status: "…", agent: "…",
	cwd: "/projects/app", focused: true, details: pane,
};
```

`HerdrEntity` retains the raw record in `details`. Its key combines session, kind, and ID; a pane ID alone is not globally unique. Layout entities use the tab ID. Agent entities use the pane ID and represent pane-associated state, not a persisted Portfolio process. Workspaces contain tabs, which contain panes.

Back to the [index](index.md).
