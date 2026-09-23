# @portfolio/api

The desktop app's JSON HTTP API: every route in [`apps/desktop/CONTRACT.md`](../../apps/desktop/CONTRACT.md), built as a small `[method, path, handler]` route table over [@portfolio/db](db.md), [@portfolio/watch](watch.md), [@portfolio/ports](ports.md), and [@portfolio/render](render.md). No framework, no classes beyond what the other packages already use.

```ts
import { createApi } from "@portfolio/api";
import { openStore } from "@portfolio/db";

const store = openStore();
const api = createApi(store, { render, home, portsTtlMs: 10_000, log: console.log, watcher });
const response = await api(new Request("http://x/api/items"));
```

`createApi(store, options?) => (request: Request) => Promise<Response>`. It never opens a database or spawns a server itself — `src/server.ts` does that, so tests can call the handler directly with `new Request(...)` and no process, port, or Pandoc binary.

## Options

| Option | Default | Notes |
|--------|---------|-------|
| `render` | `@portfolio/render`'s `renderMarkdown` through Pandoc | `(markdown, { title, toc, sourcePath }) => Promise<string>` |
| `home` | `process.env.HOME` | used to expand `~/` in paths and to resolve slots |
| `portsTtlMs` | `10_000` | how long a ports scan is cached; repeated calls to `/api/ports` or a project view don't re-run the scanner |
| `log` | no-op | one line per unhandled route error |
| `watcher` | none | a `DirectoryWatcher`; when set, the `watched-directories` routes call `reload()` so file watching picks up the change immediately |
| `scanPorts` | `@portfolio/ports`'s `scanPorts` | overridable, mainly so tests never touch the real scanner |

## Routes

Every route in the contract is implemented: items (list/create/get/patch/delete, tags, `path-action`/`slot-path`, lazy HTML rendering cached back onto the row), `detect`/`quick` add, portfolios and cards (with `kind`/`config`), categories, settings/home/directories, watched directories (add/remove/sync), ports (cached snapshot, each entry annotated with its project via `matchPortsToProjects`), projects and project parents, tasks/reminders, and PRs (`/api/prs`). See the contract for exact paths, bodies, and response shapes — this package does not restate them.

Reminders use their own CRUD and completion endpoints under `/api/reminders`. `POST /api/reminders` accepts a title and schedule without a task; `task_id` is optional. The today endpoint returns `{ reminders: ReminderView[] }`, and due entries contain `{ reminder, due_at }`. Reminder completion never completes a task.

## PRs

`prs.ts` wires `/api/prs*` to the `prPoller` option (a `@portfolio/github` `PrPoller`). With no `prPoller`, `GET /api/prs` returns `{ mine: [], review_requested: [], watched: [], status }` where `status` is idle (`polling: false, gh_ok: false`) — the routes never touch `gh` themselves.

| Route | Notes |
|-------|-------|
| `GET /api/prs` | `{ mine, review_requested, watched, status }` straight from `store.github.listPrs()` and `prPoller.status()` |
| `POST /api/prs/refresh` | forces a poll through `prPoller.refresh()`, then returns the same shape as `GET`; 429 when called again within 30s |
| `POST /api/prs/watch { url, watched }` | `url` must match `github.com/:owner/:repo/pull/:number` (422 otherwise); an untracked PR is fetched once via `prPoller.fetchOne()` (503 with no poller), then `store.github.setWatched` links or creates the library `pr` item |
| `PATCH /api/prs/:id { ignored_checks }` | `store.github.setIgnoredChecks`, which also recomputes each check's `ignored` flag |
| `GET /api/prs/events?since=<id>` | `store.github.listUnseenEvents(since)` |
| `POST /api/prs/events/seen { ids }` | `store.github.markEventsSeen(ids)` |

`server.ts` calls `ghAuth()` on startup; when it succeeds it builds a `createPrPoller` (wrapping `ghGraphql`) and starts it, and passes it to `createApi` as `prPoller`. `GET`/`PATCH /api/settings` carry `github_ignored_checks: string[]` and `github_poll_minutes: number` alongside the existing keys.

Errors are `{ error: string }` with a 4xx/5xx status. An uncaught handler error becomes a 500 with the error's message; `readJson` fails a bad JSON body the same way.

## Files

| File | Holds |
|------|-------|
| `context.ts` | `Ctx`/`ApiOptions`, the ports-snapshot cache |
| `http.ts` | the route table type, `json`/`error`/`readJson`, `:param` path compilation |
| `items.ts` | item CRUD, tags, path actions, detect/quick add |
| `paths.ts` | `pathAndCategory` validation and `runPathAction` (copy/reveal/open/create via `open`/`pbcopy`, overridable with `PORTFOLIO_OPEN_BIN`/`PORTFOLIO_PBCOPY_BIN`) |
| `portfolios.ts`, `categories.ts`, `settings.ts`, `tasks.ts`, `reminders.ts`, `watched.ts` | one file per resource, same shape |
| `ports.ts` | the ports snapshot and kill route |
| `projects.ts` | building a `ProjectView` from a category member, and the project/project-parent routes |
| `server.ts` | `Bun.serve` on `PORTFOLIO_API_PORT` (default 4388), CORS on every response including `OPTIONS`, one log line per request, `idleTimeout` of 120s so a PR refresh or watch that waits on slow `gh` calls is not cut off at Bun's 10s default (the desktop proxy reported that cut-off as 502) |

## Example

```js
const store = openStore(":memory:");
const api = createApi(store, { render: async (md, o) => `<h1>${o.title}</h1>` });
await api(new Request("http://x/api/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "note", title: "Hi", content: "hi" }) }));
// Response 201 { id, href }
```

Tests: `packages/api/test/api.test.ts` — an in-memory store and a fake render/scanPorts, calling the handler directly for every route (no server, no Pandoc). Back to the [index](../index.md).
