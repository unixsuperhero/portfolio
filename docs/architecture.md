# Architecture

## Dependency graph

Arrows point at what a package imports. Nothing points back up, and nothing below `core` knows about a server.

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

The same components render on the server for a no-JavaScript page and hydrate in the browser for an interactive one, and the `pf-*` tools already exercise every repo, so the data layer is proven before the first route exists.

## Sharing with other apps

- A different app that wants "cards of saved queries over tagged things" needs only `core` (the card rules) and `ui` (the card). Its items just have to look like `ItemView`.
- A different app that wants "pull a folder of Markdown into SQLite and keep it in sync" needs `db` + `watch` + `render`.
- Any Bun CLI can be built on `cli-kit` alone.

Back to the [index](index.md).
