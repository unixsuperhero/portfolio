# @portfolio/db

SQLite storage on `bun:sqlite`. `schema.sql` is the same file the server uses. Every repo function takes the `Database` first, so nothing is hidden in module state; `openStore` binds them for convenience.

```ts
import { openDatabase, openStore, listItems, cardItems } from "@portfolio/db";

const db = openDatabase();                       // PORTFOLIO_DB or ~/proj/portfolio/portfolio.sqlite
const store = openStore(":memory:");             // tests
```

## Opening

| Function | Notes |
|----------|-------|
| `openDatabase(path?, { schema, create, readonly, migrate, log })` | applies the schema; rebuilds the `items` table for pre file/dir databases (backup at `<db>.before-kinds`) |
| `defaultDatabasePath()` | `PORTFOLIO_DB`, else `<PORTFOLIO_HOME or ~/proj/portfolio>/portfolio.sqlite` |
| `openStore(path?, options?)` | `{ db, items, tags, portfolios, categories, settings, watched, projects, close }` with every function pre-bound |
| `SCHEMA_PATH`, `readSchema()` | the packaged schema |

## Repos

`items.ts`

| Function | Does |
|----------|------|
| `getItem`, `findItemBySource`, `findItemByPath`, `countItems`, `countByType` | lookups |
| `upsertItem(db, { type, title, … })` | inserts, or updates the row that tracks the same `source_path`; returns the id |
| `updateItem(db, id, patch)` | only the given columns; bumps `updated_at` |
| `setRenderedHtml`, `setPathAndCategory` | targeted writes |
| `toggleItemField(db, id, "pinned" \| "starred")`, `setItemFlag(db, ids, field, value)` | flags |
| `deleteItems(db, ids)` | deletes and prunes orphan tags |
| `listItems(db, filter)` | pinned first, newest first; `filter` = `{ q, contents, pinned, starred, type, tag, tagName, category, limit }` |
| `ftsQuery(q, contents)` | the FTS5 expression: every token must match, scoped to title and description unless `contents` |
| `viewItem`, `viewItems` | row to `ItemView` with tag names and href |

`tags.ts`: `listTags` (with counts), `getTag`, `findTag`, `tagsFor`, `tagNamesFor`, `setTags`, `removeTags`, `removeTagById`, `pruneTags`, `renameTag`.

`portfolios.ts`: `listPortfolios` (with card counts), `getPortfolio`, `findPortfolio`, `createPortfolio`, `updatePortfolio`, `deletePortfolio`, `portfolioCards`, `getCard`, `createCard`, `updateCard`, `deleteCard`, `moveCard`, `cardItems`, `portfolioView`. Name clashes and empty titles throw with the same messages the server returns as 422s.

`categories.ts`: `listCategories` (with member counts), `getCategory`, `findCategory`, `createCategory`, `ensureCategory`, `updateCategory` (refuses a kind change while members exist), `deleteCategory`, `categoryMembers`, `memberSlots`, `setSlotOverride`.

`settings.ts`: `getSetting`, `setSetting`, `listSettings`, `getFlag`, `setFlag`.

`watched.ts`: `listWatchedDirectories`, `findWatchedDirectory`, `addWatchedDirectory`, `setWatchedRecursive`, `claimedItemIds`, `removeWatchedDirectory` (drops uncovered documents), `clearClaims`, `claimItem`, `hasClaim`.

`projects.ts`: `listProjectParents` (with counts), `addProjectParent`, `removeProjectParent`.

## Example

```js
const store = openStore(":memory:");
const id = store.items.upsertItem({ type: "link", title: "remotion.dev/docs", url: "https://remotion.dev/docs" });
store.tags.setTags(id, ["yt", "video"]);
const pid = store.portfolios.createPortfolio("YouTube");
const cid = store.portfolios.createCard(pid, { title: "Video links", tags: "yt", types: "link" });
store.portfolios.cardItems(store.portfolios.getCard(cid));
// { total: 1, items: [{ id, type: "link", title: "remotion.dev/docs", tags: ["video", "yt"], href: "https://remotion.dev/docs", … }] }
store.portfolios.portfolioView(store.portfolios.getPortfolio(pid));
// { id, name: "YouTube", description: "", cards: [{ id: cid, title: "Video links", tags: ["yt"], types: ["link"], total: 1, items: [...] }] }
```

## Concurrency

The database is in WAL mode, so the running server and any number of `pf-*` tools can read and write at the same time. Writers wait on each other briefly; readers never block.

Tests: `packages/db/test/db.test.ts`. Back to the [index](../index.md).
