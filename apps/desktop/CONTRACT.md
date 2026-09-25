# Desktop app contract

This file is the agreement between the four parts of the desktop app. Each part is built
by a different person or agent against this file, so change it only by editing this file
first and telling the others.

```text
apps/desktop/
  main.go, sidecar.go, pty.go, native.go                 Go (Wails v3) — owner: "go"
  frontend/src/terminal/**                                 Terminal — owner: "terminal"
  frontend/src/** (everything else)                        React shell — owner: "frontend"
packages/api, packages/db, packages/watch, packages/ports, packages/client, packages/core
                                                           Backend — owner: "backend"
```

Root of the monorepo is `~/proj/portfolio` (call it `REPO`). The desktop frontend is a bun
workspace member, so `@portfolio/ui`, `@portfolio/core`, `@portfolio/client` resolve from it.

## Processes and ports

```js
const processes = {
  "app.js":            { port: 4387, note: "the old HTML server, untouched, may or may not be running" },
  "@portfolio/api":    { port: 4388, env: "PORTFOLIO_API_PORT", cmd: "bun run REPO/packages/api/src/server.ts" },
  "wails desktop":     { spawns: "@portfolio/api as a sidecar, kills it on quit" },
  "vite dev":          { port: 9245, note: "only under `wails3 dev`" },
};
```

Both servers open the same `portfolio.sqlite` (WAL mode). The API server never serves HTML
pages; every route below returns JSON unless stated.

## Backend: `@portfolio/api` routes

`createApi(store, options?) => (request: Request) => Promise<Response>`, and
`packages/api/src/server.ts` wraps it in `Bun.serve` with CORS (`Access-Control-Allow-Origin: *`,
all methods, `content-type` header) so a Vite dev page and the wails:// origin can call it.
Errors: `{ error: string }` with 4xx/5xx. Bodies are JSON (`content-type: application/json`).

### Herdr

The `/herdr` desktop route mounts the browser-safe `HerdrPage` from `@portfolio/ui/herdr`.
It receives a client and URL query state; it imports no Wails APIs. The same component
works in the browser with the same backend. `@portfolio/herdr` owns local session
discovery, socket framing, installed API schema validation, and capability discovery.

```text
GET  /api/herdr                           → { sessions, updated_at }
GET  /api/herdr/catalog                   → { protocol, operations }
POST /api/herdr/command                   → { result, events? }
     { session, method, params, capture_ms? }
POST /api/herdr/session                   → { result }
     { name, action: "start" | "stop" | "delete" }
```

Every session includes its discovery metadata, complete snapshot, and an independent
error when unavailable. Commands resolve session names through local discovery, never
accept socket paths from HTTP callers, and validate parameters against the installed
Herdr schema. The catalog includes every socket method; complex values remain editable
as JSON. `events.subscribe` captures events for an explicit bounded interval.
Session deletion and mutating commands require an in-app confirmation. Refreshes do not
replace the page or reset selection, filters, scroll, focus, or draft controls.
These routes reject non-local browser origins and cross-site requests.

```text
GET    /health                                  → { ok: true, items: number }

GET    /api/items?q&contents&type&tag&tagName&pinned&starred&category&limit
                                                → { items: ItemView[] }
POST   /api/items          body CreateItemInput → { id, href }
GET    /api/items/:id                           → ItemDetail
PATCH  /api/items/:id      body ItemPatch & { tags?: string[] } → { ok: true }
DELETE /api/items/:id?delete_files              → { ok: true }
GET    /api/items/:id/html                      → text/html (renders Markdown lazily when rendered_html is empty; caches it)
POST   /api/items/:id/toggle   { field: "pinned" | "starred" } → { ok, value: boolean }
POST   /api/items/:id/tags     { tags: string[] }  → { tags: string[] }
DELETE /api/items/:id/tags/:name                → { tags: string[] }
POST   /api/items/:id/path-action { action: "copy"|"reveal"|"open"|"create", slot?: string } → { ok, path }
        create: makes the file (empty) or dir (mkdir -p). reveal/open create first when missing, like app.js.
POST   /api/items/:id/slot-path  { slot: string, path: string }  → { slots: ResolvedSlot[] }   ("" clears the override)

GET    /api/detect?content=                     → Detection
POST   /api/quick          { content, type?, tags? }  → { id, href, type, title }
GET    /api/tags                                → { tags: { id, name, count }[] }

GET    /api/portfolios                          → { portfolios: PortfolioSummary[] }
POST   /api/portfolios     { name, description? } → { id }
GET    /api/portfolios/:id                      → PortfolioView
PATCH  /api/portfolios/:id { name?, description? } → { ok }
DELETE /api/portfolios/:id                      → { ok }
POST   /api/portfolios/:id/cards   body CardInput → { id }
PATCH  /api/cards/:id      body CardInput       → { ok }
DELETE /api/cards/:id                           → { ok }
POST   /api/cards/:id/move { direction: "left"|"right" } → { ok }

GET    /api/categories                          → { categories: CategorySummary[] }
POST   /api/categories     { name, kind, slots }  → { id }      (slots: Slot[] or the text form)
GET    /api/categories/:id                      → Category & { members: ItemView[] }
PATCH  /api/categories/:id                      → { ok }
DELETE /api/categories/:id                      → { ok }

GET    /api/settings                            → Settings
PATCH  /api/settings       { home_portfolio_id?: number|null, pastry_enabled?: boolean } → Settings
GET    /api/home                                → { portfolio: PortfolioView | null }
GET    /api/directories?path&files              → { path, parent, directories: [{name,path}], files?: [{name,path}] }
POST   /api/watched-directories { path: string, recursive?: boolean } → { id }
DELETE /api/watched-directories/:id             → { ok: true }
POST   /api/watched-directories/sync            → { ok: true }

GET    /api/ports                               → PortsSnapshot with each entry + { project: { id, title, path } | null }
POST   /api/ports/kill     { pid, signal? }     → { ok, pid, signal }

GET    /api/projects                            → { projects: ProjectView[] }
GET    /api/projects/:id                        → ProjectView         (404 unless the item is a dir in the project category)
POST   /api/projects/scan                       → { added: string[] }
GET    /api/project-parents                     → { parents: ProjectParentSummary[] }
POST   /api/project-parents { path }            → { ok }
DELETE /api/project-parents/:id                 → { ok }

GET    /api/tasks?all                           → { tasks: TaskView[] }     (active only unless ?all=1)
POST   /api/tasks          body TaskInput       → { id }
GET    /api/tasks/:id                           → TaskView & { history: Completion[] }
PATCH  /api/tasks/:id      body Partial<TaskInput> & { active?: boolean } → { ok }
DELETE /api/tasks/:id                           → { ok }
POST   /api/tasks/:id/complete   { on?: "YYYY-MM-DD" } → TaskView
POST   /api/tasks/:id/uncomplete { on?: "YYYY-MM-DD" } → TaskView
GET    /api/reminders?all                       → { reminders: ReminderView[] }
POST   /api/reminders body ReminderCreateInput → { id }
GET    /api/reminders/:id                      → ReminderView
PATCH  /api/reminders/:id body Partial<ReminderCreateInput> → { ok }
DELETE /api/reminders/:id                      → { ok }
POST   /api/reminders/:id/complete   { on?: "YYYY-MM-DD" } → ReminderView
POST   /api/reminders/:id/uncomplete { on?: "YYYY-MM-DD" } → ReminderView
GET    /api/reminders/due?minutes=60            → { due: DueReminder[] }
GET    /api/reminders/today                     → { reminders: ReminderView[] }
```

### Shapes (additions to `@portfolio/core` types)

```js
// Cards get a kind. "query" is what exists today; the others are dashboard widgets.
const CARD_KINDS = ["query", "tasks", "reminders", "ports", "clock", "note", "services"];
const card = {
  id: 3, portfolio_id: 1, position: 2, title: "Scripts",
  kind: "query",                       // NEW, default "query"
  config: {},                          // NEW, JSON object, per kind:
  // query:     { view: "list" | "tiles" }                 tiles = app-launcher grid like Homarr
  // tasks:     {}                                        active tasks, nested subtasks, completion checkboxes
  // reminders: { scope: "today" | "all" }
  // ports:     { project_id?: number }                    empty = every listener
  // clock:     { format: "24h" | "12h" }
  // note:      { text: "markdown" }                       CommonMark + GFM, edited in place; raw HTML ignored
  // services:  { project_id: number }                     scripts of one project, run buttons
  tags: ["yt"], types: ["document"], sort_key: "title", sort_dir: "asc", max_items: 100,
};
// normalizeCard(input) accepts kind and config (object or JSON string); unknown kind → "query"; bad config → {}.
// PortfolioView = Portfolio & { cards: (Card & { items: ItemView[]; total: number })[] }
//   For non-query kinds items = [] and total = 0.

const settings = { home_portfolio_id: 3 | null, pastry_enabled: false,
  watched_directories: [{ id, path, recursive: boolean }], project_parents: [{ id, path, count }] };

const itemDetail = { ...item, href, tags: ["a"], slots: [ResolvedSlot], project: ProjectView | null };

const projectView = {
  id: 12, title: "portfolio", path: "/Users/me/proj/portfolio", description: "~/proj/portfolio", tags: ["project"],
  services: { runner: "bun" | "pnpm" | "yarn" | "npm" | null, scripts: { dev: "bun run app.js" }, make_targets: ["build"] },
  ports: [PortEntry],                  // listeners whose cwd is inside path (from the cached snapshot)
  slots: [ResolvedSlot],
};
// packages/watch/src/services.ts:
//   projectServices(path) → { runner, scripts, make_targets }   (package.json scripts; lockfile picks the runner; Makefile targets)
//   serviceCommand(services, name, args = "") → "bun run dev --port 3000"  (the exact shell line to run)

const task = {
  id: 1, title: "Stretch", notes: "", recurrence: "daily" | "once", item_id: null, parent_id: null, active: true,
  created_at: "…",
  reminders: [{ id: 1, at: "08:30" }],           // daily: "HH:MM" local; once: "YYYY-MM-DDTHH:MM" local
  completed_today: true,                          // daily: a completion for today; once: any completion
  last_completed: "2026-09-22" | null,
  streak: 4,                                      // daily only: consecutive days ending today or yesterday
};
const taskInput = { title, notes?, recurrence?, item_id?, parent_id?, reminders?: ["08:30"] }; // recurrence defaults to "once"
const completion = { id, task_id, on: "2026-09-22", at: "2026-09-22 08:41:00" };
const reminder = { id: 1, title: "Call the dentist", notes: "", recurrence: "once", at: "2026-09-24T09:00", days: [], task_id: null, active: true, created_at: "…", completed_today: false, last_completed: null, streak: 0 };
const reminderInput = { title: "Call the dentist", at: "2026-09-24T09:00" }; // notes, recurrence, days, task_id, active are optional
const dueReminder = { reminder, due_at: "2026-09-24T09:00" };
// "due" = at-time within [now - minutes, now + minutes] and not completed (today for daily). The frontend polls
// this and never resets page state when it does.
```

Tasks also have Library items with `type: "task"` and a unique `task_id`. `GET /api/items/:id` includes `task_id`, which is null for other item types. Existing tasks receive Library entries during database migration. Titles and notes stay synchronized between the task and its item.

`parent_id` is a task ID, not an item ID. Null means top-level. Cycles and missing parents return 422. Deleting a parent keeps its direct children as top-level tasks. Completion is independent for each task. Reopening a once-task clears its completion even if it was completed on an earlier date.

The frontend exposes `/tasks` and `/tasks/:taskId`, with nested creation, editing, reparenting, deletion, and completion. Task item pages expose the same controls. Reminders are independent records. Their optional task link defaults to null; completing a reminder does not complete its task, and deleting a task detaches its reminders.

Schema additions (both `schema.sql` and `packages/db/src/schema.sql` stay identical):

```sql
-- cards: ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'query'; ADD COLUMN config TEXT NOT NULL DEFAULT '{}'
--        applied by a migration in packages/db/src/open.ts when PRAGMA table_info(cards) lacks them.
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  recurrence TEXT NOT NULL CHECK (recurrence IN ('daily','once')), item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL CHECK (parent_id != id));
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  recurrence TEXT NOT NULL CHECK (recurrence IN ('daily','once')), task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  at TEXT NOT NULL, days TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reminder_completions (id INTEGER PRIMARY KEY, reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  "on" TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (reminder_id, "on"));
CREATE TABLE IF NOT EXISTS completions (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  "on" TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (task_id, "on"));
```

`@portfolio/client` gains a method per new route (`home()`, `tasks()`, `createTask()`, `complete()`,
`projects()`, `project(id)`, `updateSettings()`, `itemHtml(id)`, `pathAction()`, `cards…`) and its
existing methods keep working against the new server.

## Go: services and events

Package `main`, module `portfolio-desktop`. Every service is registered in `main.go` and
bindings are generated with `wails3 generate bindings -ts -i` into `frontend/bindings/portfolio-desktop/`.

```go
// sidecar.go
type SidecarService struct{}
func (s *SidecarService) Status() SidecarStatus            // { Url string; Running bool; Pid int; Error string }
// On ServiceStartup: find REPO (env PORTFOLIO_HOME, else walk up from the executable and cwd until package.json
// with "name": "portfolio"), spawn `bun run packages/api/src/server.ts` with PORTFOLIO_API_PORT=4388,
// wait for GET /health (≤10s), log to REPO/logs/desktop-api.log. On ServiceShutdown: SIGTERM, then SIGKILL after 2s.
// If port 4388 already answers /health, adopt it and spawn nothing.

// pty.go
type PtyService struct{}
func (p *PtyService) Create(opts PtyOptions) (string, error)  // PtyOptions{ Cwd string; Cols, Rows int; Command string }
//   Command "" → login shell: $SHELL -l. Otherwise: $SHELL -l -c Command (so PATH and aliases apply). Returns session id.
func (p *PtyService) Write(id string, data string) error      // data is raw text typed by the user (UTF-8)
func (p *PtyService) Resize(id string, cols, rows int) error
func (p *PtyService) Close(id string) error
func (p *PtyService) List() []PtyInfo                         // { Id, Cwd, Command, Pid, Running }
// Events (application.RegisterEvent):
//   "pty:data" → { Id string; Data string }   Data is base64 of the raw bytes read from the pty (binary safe)
//   "pty:exit" → { Id string; Code int }

// native.go
type NativeService struct{}
func (n *NativeService) Reveal(path string) error            // open -R
func (n *NativeService) OpenPath(path string) error          // open
func (n *NativeService) OpenWith(path, app string) error     // open -a app
func (n *NativeService) OpenUrl(url string) error            // system browser
func (n *NativeService) CopyText(text string) error          // clipboard
func (n *NativeService) Notify(title, body string) error     // osascript display notification (works unsigned)
func (n *NativeService) Home() string                        // $HOME
```

`main.go` opens one main window titled "Portfolio", 1400x900, URL "/", hidden-inset title bar.
Bindings live at `frontend/bindings/portfolio-desktop/{sidecarservice,ptyservice,nativeservice}.ts`.

## Frontend

Vite + React 19 + TypeScript, `react-router` v7 with a hash router, CSS from `@portfolio/ui`
(`tokens.css`, `cards.css`) plus `src/app.css`. No Tailwind.

```text
frontend/src/
  main.tsx, App.tsx                 router + layout: left sidebar, top search, content, bottom terminal dock
  api.ts                            one PortfolioClient at http://127.0.0.1:4388 (override: VITE_PORTFOLIO_API)
  native.ts                         Go binding wrappers; browser-only window.open / clipboard APIs
                                    use URL-based Wails detection, so `bun run dev` also works in a browser
  context-menu/                     the right-click menu; see below
  pages/{Home,Portfolio,Library,Item,Categories,Category,Projects,Project,Ports,Reminders,Notifications,Settings}.tsx
  cards/{QueryCard,TilesCard,TasksCard,RemindersCard,PortsCard,ClockCard,NoteCard,ServicesCard}.tsx   one per card kind
  terminal/                         OWNED BY THE TERMINAL PART — see below
```

Context menu rules (document-level `contextmenu` listener, one component):

```js
// External links and elements with an external data-url:
["Open in system browser", "Copy link"]
// Any element with data-path (item rows, slot rows, project rows):
["Copy path", "Reveal in Finder", "Open", "Open terminal here", ...(data-kind==="file" ? ["Create if missing"] : [])]
// Any element with data-item (an item id): the above plus
["Pin/Unpin", "Star/Unstar", "Edit"]
// External links always use the system browser. No embedded-browser preference.
// Normal, modified, and middle clicks must never navigate the main screen away.
```

Only navigation within the current app document, including hash-router links, remains
in the main screen. Same-origin content paths are external destinations, not app routes.
Native content URLs are mapped to the sidecar's HTTP address. All URL-opening buttons
and terminal hyperlinks use `openSystem`, which calls `NativeService.OpenUrl` in Wails
and opens a separate tab in the web version. Native binding failures do not fall back
to `window.open`. The obsolete browser service and its generated bindings are removed.

Terminal contract (the frontend imports only these two modules from `terminal/`):

```ts
// src/terminal/store.ts
export interface TerminalRequest { cwd?: string; command?: string; title?: string }
export function openTerminal(request?: TerminalRequest): string;    // creates a tab, shows the dock, returns tab id
export function useTerminalStore(): { tabs: TerminalTab[]; active: string | null; open: boolean; setOpen(v: boolean): void; focus(id: string): void; close(id: string): void };
export interface TerminalTab { id: string; title: string; cwd: string; command?: string; ptyId: string | null; exited: number | null }
// src/terminal/TerminalDock.tsx
export function TerminalDock(): JSX.Element;    // renders nothing when closed; tabs + one GhosttyTerminal per tab
```

Keyboard: `Cmd+K` focus search, `` Ctrl+` `` toggle the terminal dock, `Cmd+T` inside the dock = new tab.

Polling rules (absolute): reminder and PR notifications (60s after each completed poll), ports
(every 15s when the ports page or card is visible) update only their own slice of state.
They never navigate, never reset forms, never scroll. Notification popups expire after 8s
without marking records dismissed. `/notifications` exposes URL-backed New/Dismissed tabs,
search, source filters, sort, and selection; top-bar Dismiss all affects all New records.
History persists per app/browser origin in `portfolio.notifications.v1` local storage.
PR delivery acknowledgment follows successful local persistence, not user dismissal.

## Terminal part

Vendored from `~/proj/t3code/apps/web/src/terminal/ghostty/` (MIT, T3 Tools Inc.) into
`frontend/src/terminal/ghostty/` with `LICENSE-t3code` and `LICENSE-ghostty` beside it. The four
t3code imports (`lib/utils`, `lib/selectionActions`, `terminal-links`, `appearanceFonts`) become
local shims in `frontend/src/terminal/shims/`. Tailwind class strings in `surface.ts` become plain
classes styled in `terminal.css`. `GhosttyTerminal.tsx` mounts a `GhosttyTerminalSurface`, wires
`onData` → `PtyService.Write`, `onResize` → `PtyService.Resize`, and `pty:data` events → `surface.write`
through a per-tab `TextDecoder("utf-8", { stream: true })` after base64 decoding. Theme colours come
from the CSS tokens (`--bg`, `--text`, `--accent`) read once at mount, with a 16-colour ANSI palette.

## Pull requests (added 2026-09-22)

A top-level "PRs" page and a `prs` card kind. GitHub is reached ONLY through the `gh` CLI
(`gh api graphql`), from the API sidecar, never from the frontend or Go.

```js
// packages/github: pure parsing + diffing, and one runner that shells out to gh.
const pr = {
  id: 7,                                  // row id in github_prs
  url: "https://github.com/acme/app/pull/12", owner: "acme", repo: "app", number: 12,
  title: "Add widgets", author: "jearsh", is_draft: false,
  state: "open" | "closed" | "merged",
  review_decision: "approved" | "changes_requested" | "review_required" | null,
  updated_at: "2026-09-22T14:00:00Z",
  comments: 4,                            // issue comments + review comments + reviews
  checks: [{ name: "ci/test", status: "success" | "failure" | "pending" | "skipped" | "cancelled" | "neutral", url: "…", ignored: false }],
  checks_summary: "success" | "failure" | "pending" | "none",   // over NON-ignored checks only
  watched: true, ignored_checks: ["codecov/patch"],             // per PR; settings.github_ignored_checks is global (glob patterns like "codecov/*")
  ignored: false,                         // hidden from every list and never raises events; polling never changes it
  lists: ["mine", "review_requested"],    // which search lists it currently appears in ([] for watched-only)
  item_id: 42 | null,                     // the library `pr` item, created when watched
  source_dir: "/Users/me/work/carrot" | null, // the settings.github_dirs entry gh ran from; null = the API's own cwd
  fetched_at: "2026-09-22T14:02:00Z",
};
const prEvent = { id: 1, pr_id: 7, kind: "state" | "comments" | "checks" | "review", message: "acme/app#12 merged", at: "…", seen: false };
const prStatus = { last_poll_at, next_poll_at, rate: { remaining, reset_at } | null, polling: true, error: null | string, gh_ok: true, login: "jearsh" };
```

Schema: `github_prs` (id, url UNIQUE, owner, repo, number, title, author, is_draft, state, review_decision, updated_at,
comments, checks JSON, lists JSON, watched 0/1, ignored_checks JSON, ignored 0/1, item_id nullable FK, fetched_at) and
`github_pr_events` (id, pr_id FK cascade, kind, message, at, seen 0/1). Settings keys: `github_ignored_checks` (JSON array),
`github_ignored_repos` (JSON array of `owner/repo` globs like `acme/*`, default `[]`), `github_poll_minutes` (default 2),
`github_dirs` (JSON array of absolute paths, default `[]`). A PR is *hidden* when its own `ignored` is set or its
`owner/repo` matches a `github_ignored_repos` glob: hidden PRs stay stored and polled with the lists, but are left out of
`mine`/`review_requested`/`watched`, raise no events, and are not sent in the watched batch.

Polling (in `packages/api/src/server.ts`, started only when `gh auth status` succeeds):
- `gh` runs from each `github_dirs` entry in turn (cwd only; gh resolves the host and credentials from that directory's git
  remote). With no entries it runs from the API's own cwd. A PR belongs to the first directory that returns it (`source_dir`);
  a directory that fails is reported in `prStatus.error` and skipped, and the tick fails only when every directory fails.
- Per directory, one GraphQL request refreshes both search lists: `search(query:"is:pr is:open author:@me")` and
  `search(query:"is:pr is:open -is:draft review-requested:@me")` as two aliases, first 50 each, plus the viewer ID,
  each candidate's `reviewRequests`, and `rateLimit { remaining resetAt }`. A review candidate enters `review_requested`
  only when its requested reviewers contain a `User` whose immutable ID equals the viewer ID; team requests are excluded.
  `issueCount` identifies complete search results so removed memberships are reconciled without truncating a larger result set.
- One GraphQL request refreshes every watched PR not already in those results: `repository(owner,name){ pullRequest(number) }`
  aliases, batched (≤ 25 per request) and grouped by the PR's `source_dir`, so each batch runs from its own directory.
- Cadence: every `github_poll_minutes` (2) when at least one PR is watched, else every 10 minutes; also on
  `POST /api/prs/refresh` (rate-limited to once per 30s). Never more than 2 requests per directory per cycle. If `rateLimit.remaining < 200`
  skip cycles until `resetAt`. On error: exponential backoff up to 15 minutes, error surfaced in `prStatus`.
- Diffing (pure, tested): compare the stored row to the new one and append events for: state change, review_decision change,
  comments increase (message says how many new), and checks_summary change computed over non-ignored checks (global + per PR).

Routes:
```text
GET    /api/prs                        → { mine: Pr[], review_requested: Pr[], watched: Pr[], ignored: Pr[], status: PrStatus }   (ignored = every hidden PR; pr.ignored false there means the repo is ignored)
POST   /api/prs/refresh                → same as GET after a forced poll (429 { error } when called within 30s)
POST   /api/prs/watch { url, watched }  → Pr        (creates the github_prs row from a URL if unknown, trying each github_dirs entry until one returns it; creates/links a library `pr` item when watched)
PATCH  /api/prs/:id { ignored_checks?, ignored? }  → Pr   (each key applied only when present)
GET    /api/prs/events?since=<id>      → { events: PrEvent[] }   (unseen and newer than since)
POST   /api/prs/events/seen { ids }    → { ok }
GET/PATCH /api/settings                 gain github_ignored_checks: string[], github_ignored_repos: string[], github_poll_minutes: number, and github_dirs: string[] (absolute paths; 422 otherwise)
```

Frontend: sidebar entry "PRs" → `/prs`, a single full-width list deduplicated by PR ID.
Collection selects visible, mine, direct review-requested, watched, ignored, or all loaded PRs.
The **My Reviews** shortcut selects direct requests plus the open, non-draft lifecycle.
Lifecycle is Draft only when `state === "open" && is_draft`; merged/closed take precedence.
Text, SVG icons, semantic color, and row borders distinguish Draft/Open/Merged/Closed.
Draft uses a dashed border; terminal drafts retain a secondary Draft flag badge.
Reviews, watch/ignore status, and checks have separate labeled indicators. Check details
show all six check outcomes, ignored flags, and URL-backed collection controls; No checks
and All checks ignored are explicit, distinct states.

Primary filters cover lifecycle, draft flag, review, and checks summary. More filters cover
every PR data field: identifiers, text/URLs, people/repository/directory, flags, memberships,
linked items, comments, timestamps, check counts, patterns, and individual-check fields.
Combined individual-check predicates apply to the same check. Search indexes all PR data;
sort/order and filters are URL-backed, including ignored PRs and null-valued fields.
Lifecycle and My Reviews shortcuts show counts under the other active filters. Nested check filters use
`pr<ID>_check_*` query keys so they do not change the page's PR filters.

Watch/Unwatch is a row action. Manage exposes Ignore/Unignore, Ignore repo, and Ignore checks.
Every Ignore / Ignore repo action first uses the in-app confirmation dialog. The selection
bar retains bulk actions and supports clearing individual PR ignore flags. Ignored repository
rules have separate search, sort, selection, and restore controls. Links retain `data-url`;
the `prs` dashboard card keeps using the same rows without changing its config contract.

Notifications remain independent of the page: new events produce an expiring popup,
native notification, and WebAudio ping, then delivery acknowledgment after history is saved.
Settings keeps global ignored checks, ignored repositories, poll cadence, and GitHub directories.

## Native pickers, reminder days, projects filters (added 2026-09-22, round 2)

```go
// native.go — additions. Both return "" (no error) when the user cancels.
func (n *NativeService) PickDirectory(title string, start string) (string, error)   // Wails v3 open dialog, CanChooseDirectories
func (n *NativeService) PickFile(title string, start string) (string, error)        // CanChooseFiles
```

Frontend: every form field that holds a file or directory path renders `src/components/PathField.tsx`
(`{ value, onChange, kind: "file" | "dir", label?, placeholder? }`): a read-mostly text input plus a
"Choose…" button. Inside Wails the button calls the picker above (start = current value or $HOME);
in a plain browser it falls back to the existing directory-browser modal for dirs and a plain input for
files. Fields: Settings (watched directories, project parents), Library quick-add path, item create
and edit (path), slot overrides on the item page, category slot editor (absolute paths only).

```js
// Reminders gain weekdays; once-tasks pick a date.
const reminder = { id: 1, at: "08:30", days: [1, 3, 5] };   // 0 = Sunday … 6 = Saturday; [] = every day
// TaskInput.reminders accepts either "08:30" or { at: "08:30", days?: [1,3,5] }; once-tasks use "YYYY-MM-DDTHH:MM".
// dueReminders / todayReminders: daily reminders with non-empty days fire only on those weekdays (local time).
// Tasks without schedules do not appear in reminder lists.
// Schema: ALTER TABLE reminders ADD COLUMN days TEXT NOT NULL DEFAULT '[]' (migration in open.ts + both schema files).
```

The Reminders form creates one independent schedule per record, using `<input type="time">` and weekday toggles for daily reminders or `<input type="datetime-local">` for once reminders. Task association is optional. The list shows `08:30 · Mon Wed Fri`.

Projects page: client-side over `GET /api/projects`. Search box (`q` in the URL) matches title, path,
tags, script names. Sort: name, recently updated, running ports, script count. Filters: runner
(bun / pnpm / yarn / npm / none), "has running ports", tag. State lives in the URL query so it survives reload.
