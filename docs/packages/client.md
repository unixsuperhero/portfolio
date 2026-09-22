# @portfolio/client

A `fetch`-based client for the server's HTTP API. Works in Bun, Node 18+, and browsers, so the React components and the CLI share it. This replaces the `PortfolioApi` class inside the Ruby `h-docs` and the curl calls inside `mdoc`.

```ts
import { PortfolioClient, desktopServer } from "@portfolio/client";
const legacy = new PortfolioClient();                          // PORTFOLIO_SERVER, HDOCS_SERVER, or http://127.0.0.1:4387 (the old HTML server)
const desktop = new PortfolioClient(desktopServer());          // http://127.0.0.1:4388 (@portfolio/api, port `API_PORT`)
const custom = new PortfolioClient("http://docs.h:4388", { fetch: myFetch, headers: {} });
```

Every method below sends and parses JSON against [@portfolio/api](api.md) (`request()` sets `content-type: application/json` whenever a `json` body is given). `createDocuments` and `pastry` are the two exceptions — they only exist on the old HTML server, so `bin/pf-docs` and Pastry uploads keep working there.

| Method | Calls |
|--------|-------|
| `health()` | `GET /health` |
| `items(filter)`, `item(id)` / `itemDetail(id)`, `itemHtml(id)` | `GET /api/items…`, `…/:id` (with tags, slots, project), `…/:id/html` (renders lazily) |
| `createItem(fields)`, `updateItem(id, patch)`, `deleteItem(id, deleteFiles?)` | `POST/PATCH/DELETE /api/items[/:id]` |
| `toggle(id, field)`, `addTags(id, tags)`, `removeTag(id, name)`, `tags()` | pinned/starred, tags |
| `pathAction(id, action, slot?)`, `setSlotPath(id, slot, path)` | copy/reveal/open/create, and slot overrides |
| `detect(content)`, `quickAdd(content, { type, tags })` | `GET /api/detect`, `POST /api/quick` |
| `portfolios()`, `portfolio(id)`, `createPortfolio`, `updatePortfolio`, `deletePortfolio` | portfolios |
| `createCard(portfolioId, card)`, `updateCard(id, card)`, `deleteCard(id)`, `moveCard(id, direction)` | cards, with `kind`/`config` |
| `categories()`, `category(id)`, `createCategory`, `updateCategory`, `deleteCategory` | categories and their members |
| `settings()`, `updateSettings(patch)`, `home()`, `directories(path, files?)` | settings, the home portfolio, the directory browser |
| `addWatchedDirectory(path, recursive?)`, `removeWatchedDirectory(id)`, `syncWatchedDirectories()` | watched directories |
| `ports()`, `killPort(pid, signal)` | the ports snapshot (each entry annotated with its `project`), and killing a listener |
| `projects()`, `project(id)`, `scanProjects()`, `projectParents()`, `addProjectParent`, `removeProjectParent` | project discovery |
| `tasks(all?)`, `task(id)`, `createTask`, `updateTask`, `deleteTask`, `completeTask(id, on?)`, `uncompleteTask(id, on?)`, `dueReminders(minutes?)`, `todayTasks()` | tasks and reminders |
| `createDocuments(docs, { roots, title, description, toc })`, `pastry(id, format, visibility)` | old server only |
| `url(path, query)`, `absolute(href)` | URL helpers |

Errors are `PortfolioApiError` with `status` (0 when the server is unreachable) and the parsed body.

```js
const view = await desktop.portfolio(1);
// { id: 1, name: "YouTube", cards: [{ id: 3, title: "Scripts", kind: "query", config: {}, tags: ["yt"], types: [], total: 12, items: [ItemView…] }] }
```

Tests: `packages/client/test/client.test.ts`, exercised end to end against a real `createApi` handler (no server process, no network). Back to the [index](../index.md).
