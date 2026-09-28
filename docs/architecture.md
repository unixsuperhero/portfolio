# Architecture

## Dependency graph

This overview groups reusable packages by responsibility; it is not an exhaustive import graph. The table under [reuse boundaries](#reuse-boundaries) includes the GitHub, Herdr, and HTTP adapters.

```text
                      ┌──────────────┐
                      │ @portfolio/  │
                      │    core      │   types, detect, paths, slots, cards, text
                      └──────┬───────┘
          ┌───────────┬──────┼──────────┬───────────────┐
          ▼           ▼      ▼          ▼               ▼
      ┌───────┐  ┌────────┐ ┌────────┐ ┌────────┐   ┌─────────┐
      │  db   │  │ render │ │ client │ │   ui   │   │ cli-kit │  (no core dependency)
      └───┬───┘  └───┬────┘ └────────┘ └────────┘   └────┬────┘
          │          │                                    │
          ▼          │                                    │
      ┌───────┐      │                                    │
      │ watch │◄─────┘ (render is injected, not imported) │
      └───────┘                                           │
          ┌───────┐                                       │
          │ ports │ (standalone)                          │
          └───────┘                                       │
                        ┌──────────────┐                  │
                        │ @portfolio/  │◄─────────────────┘
                        │     cli      │  + db + client
                        └──────────────┘
```

The graph describes the retained TypeScript packages. The Ruby CLI has a
separate dependency path: `bin/pf*` → `lib/pf/` → hiiro, sqlite3, Pandoc, and
Ruby's Net::HTTP. It shares the canonical SQL schema with the application,
preserves local database writes, and uses the existing HTTP API only where
the former CLI did. No TypeScript backend changes are required.

Design rules that kept this small:

- **Data first.** Records are plain objects (see [data model](data-model.md)). Repos are functions that take `db` first: `getItem(db, id)`. `openStore(path)` binds them for callers that want `store.items.getItem(id)`.
- **Inject the slow parts.** `watch` needs a renderer but takes it as an argument, so its tests run without Pandoc. `detect` takes a `probe` so path detection is testable without a disk.
- **One shape for the outside world.** `ItemView` is what the API returns, what the client types, and what the components take.
- **Tools are thin.** A `pf-*` file declares Hiiro commands; handlers call Ruby helpers and print.

Herdr is a separate local-control boundary:

```text
desktop route ──► @portfolio/ui/herdr ──► injected HerdrClient
                                             │
                                       PortfolioClient.request
                                             │ HTTP
                                      @portfolio/api/herdr
                                             │
                                    @portfolio/herdr/server
                                             │ Unix socket / fixed CLI argv
                                  running named Herdr sessions
```

The entity-first view retains full snapshots and uses the installed JSON Schema for
control forms. This combines the navigability of curated entity views with complete
schema-defined capability coverage; a manually maintained method-per-button layer
would drift as Herdr changes. Browser code knows session names and opaque entity IDs,
not how to discover or connect sockets. Server code owns validation, bounded transport,
session discovery, and persistent headless startup. The desktop adapter supplies only
HTTP transport and URL state; the web host mounts the same component and styles.

## How app.js maps onto the packages

Every function in `app.js` now has a home. This is the map to use when the next server is written.

| app.js | Package | Function |
|--------|---------|----------|
| `escapeHtml`, `slugify`, `documentTitle` | core | same names |
| `localMarkdownLink`, `expandPath`, `abbreviatePath`, `normalizeItemPath` | core | same names |
| `detectType` | core | `detect` (+ `detectUrl`, `detectPath`, `detectText`) |
| `parseSlots`, `formatSlots`, `memberSlots` | core / db | `parseSlots`, `formatSlots`, `resolveSlots` / `memberSlots(db, item)` |
| `cardFields`, `CARD_SORTS`, `CARD_SORT_LABELS` | core | `normalizeCard`, `CARD_SORT_LABELS`; SQL sorts inside `db.cardItems` |
| `itemHref`, `icon` | core | `itemHref`, `kindLabel` |
| `migrateItemKinds`, schema load | db | `openDatabase`, `migrateItemKinds` |
| `upsertItem`, `listItems`, `tagsFor`, `setTags`, `removeTags`, `deleteRecords` | db | `upsertItem`, `listItems`, `tagsFor`, `setTags`, `removeTags`, `deleteItems` |
| `portfolioCards`, `cardItems`, `moveCard` | db | same names, plus create/update/delete for portfolios and cards |
| `listCategories`, `categoryFields` | db | `listCategories`, `createCategory`, `updateCategory` (validation included) |
| `getSetting`, `setSetting`, `pastryEnabled` | db | `getSetting`, `setSetting`, `getFlag` |
| `watchedDirectories`, watched-directory routes | db | `listWatchedDirectories`, `addWatchedDirectory`, `removeWatchedDirectory` |
| `scanWatchedDirectory`, `performWatchedReconciliation`, `reloadWatchedDirectories` | watch | `scanDirectory`, `reconcile`, `DirectoryWatcher` |
| `discoverProjects`, `scanProjects` | watch | same names |
| `runPandoc`, `renderMarkdown`, `rewriteLinks`, `sourceItemIds` | render / watch | `runPandoc`, `renderMarkdown`, `rewriteLinks` / `sourceItemIds` |
| `mdoc`'s Python link crawler | render | `crawlMarkdown` |
| `getPortsSnapshot`, `portSiteUrl`, `findPortEntry`, `killPortProcess` | ports | `scanPorts`, `portSiteUrl`, `findPortEntry`, `killListener` |
| `h-docs`'s `PortfolioApi` (Ruby) | client | `PortfolioClient` |
| `itemRows`, `railSection`, `cardSection`, `cardForm` (template strings) | ui | `ItemList`, `RailSection`, `PortfolioCard`, `CardForm` |

Still only in `app.js`: the HTTP routing, the HTML shell and page layouts, the quick-add modal script, the directory browser, the Pastry upload widget, and `createDocumentBatch`. Those are the next extraction targets; see [suggestions](suggestions.md).

## A rewrite recipe

With the packages in place, a new server is a routing layer over them:

```js
import { openStore } from "@portfolio/db";
import { renderMarkdown } from "@portfolio/render";
import { DirectoryWatcher } from "@portfolio/watch";
import { toHtml } from "@portfolio/ui/server";
import { PortfolioGrid } from "@portfolio/ui";

const store = openStore();
const watcher = new DirectoryWatcher(store.db, (md, o) => renderMarkdown(md, o));
await watcher.reload();

Bun.serve({ fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/items") return Response.json({ items: store.items.viewItems(store.items.listItems({ q: url.searchParams.get("q") ?? "" })) });
  const m = url.pathname.match(/^\/portfolios\/(\d+)$/);
  if (m) {
    const view = store.portfolios.portfolioView(store.portfolios.getPortfolio(Number(m[1]))!);
    return new Response(shell(view.name, toHtml(PortfolioGrid, { cards: view.cards })), { headers: { "content-type": "text/html" } });
  }
  return new Response("not found", { status: 404 });
} });
```

The same UI package supports server rendering and browser interaction. The Ruby tools cover library and query-card workflows, but do not exercise every repository or domain operation. The [CLI coverage audit](cli/coverage.md) records the missing command families and the checks actually performed.

## Reuse boundaries

Epic `td-623ef3` asks for reusable models and adapters rather than another application-specific implementation. The [data model](data-model.md) identifies each record's authority, relationships, and storage. Existing package boundaries already separate most of those concerns.

| Responsibility | Existing module | What stays outside |
| --- | --- | --- |
| Shared records and pure detection, path, slot, and card rules | `@portfolio/core` | SQL, process lifecycle, HTTP routing |
| SQLite rows, joins, migrations, and view projections | `@portfolio/db` | UI state and external polling |
| Markdown rendering and link rewriting | `@portfolio/render` | Watch ownership and scheduling |
| Watch reconciliation, project discovery, service metadata | `@portfolio/watch` | A hard dependency on a particular renderer; rendering is injected |
| GitHub queries, parsing, ignored checks, change events, polling | `@portfolio/github` | Presentation; the poller accepts its database and command dependencies |
| Herdr session discovery, schema catalog, socket commands | `@portfolio/herdr/server` | Browser code and Portfolio persistence |
| Herdr records, entity projection, injected HTTP request client | `@portfolio/herdr` | Socket discovery in browser code |
| Listener and process snapshots | `@portfolio/ports` | Durable project or service identity |
| HTTP validation and routing | `@portfolio/api` | Page layouts |
| HTTP transport | `@portfolio/client` | SQLite access in consumers |
| Reusable views | `@portfolio/ui` | Direct SQL and socket access |
| Ruby command declarations and helpers | `bin/pf-*`, `lib/pf/` | Assumed parity with every TypeScript repository method |

A rewrite can reuse a plain record without inheriting its storage mechanism. For example, these relationships remain different even when one page displays them together:

```js
const task = { id: 12, item_id: 43, parent_id: null };
const owningLibraryItem = { id: 47, type: "task", task_id: 12 };
const relatedDocument = { id: 43, type: "document" };
const reminder = { id: 5, task_id: 12, at: "09:00", recurrence: "daily" };
```

The database owns synchronization between task 12 and item 47. Item 43 is optional context, not the task's identity. Reminder 5 has its own completion history. Reimplementing these links in a page or CLI command would duplicate domain rules.

External records need a different boundary. A Herdr pane belongs to a named session, a process listener is a transient observation, and a GitHub PR may have several local checkouts. None is interchangeable with a project item ID. The [Git adapter and normalized-check proposals](data-model.md#git-repositories-branches-and-worktrees) remain unimplemented; the current checks stay embedded in the PR record.

The Ruby CLI shares the canonical schema but implements its own helpers. Reuse of SQL constraints does not prove equivalent validation, projections, or command coverage. The [coverage audit](cli/coverage.md#remaining-epic-scope) separates existing operations from the work required before claiming CLI parity.

## Sharing with other apps

- A different app that wants "cards of saved queries over tagged things" needs only `core` (the card rules) and `ui` (the card). Its items just have to look like `ItemView`.
- A different app that wants "pull a folder of Markdown into SQLite and keep it in sync" needs `db` + `watch` + `render`.
- Any Bun CLI can be built on `cli-kit` alone.

Back to the [index](index.md).
