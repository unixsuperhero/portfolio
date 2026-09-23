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
| `openDatabase(path?, { schema, create, readonly, migrate, log })` | applies the schema; rebuilds older `items` tables for task, file, and directory types, with a backup at `<db>.before-tasks`; adds `tasks.parent_id` and Library entries for existing tasks; migrates card columns and task-owned reminders into independent reminder records while preserving schedules and completion history |
| `defaultDatabasePath()` | `PORTFOLIO_DB`, else `<PORTFOLIO_HOME or ~/proj/portfolio>/portfolio.sqlite` |
| `openStore(path?, options?)` | `{ db, items, tags, portfolios, categories, settings, watched, projects, tasks, reminders, github, close }` with every function pre-bound |
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

`portfolios.ts`: `listPortfolios` (with card counts), `getPortfolio`, `findPortfolio`, `createPortfolio`, `updatePortfolio`, `deletePortfolio`, `portfolioCards`, `getCard`, `createCard`, `updateCard`, `deleteCard`, `moveCard`, `cardItems`, `portfolioView`. Name clashes and empty titles throw with the same messages the server returns as 422s. `createCard`/`updateCard` persist `kind` and `config` (JSON); `portfolioView` only runs `cardItems` for `kind: "query"` cards — every other kind comes back with `items: []`, `total: 0` and no SQL.

`categories.ts`: `listCategories` (with member counts), `getCategory`, `findCategory`, `createCategory`, `ensureCategory`, `updateCategory` (refuses a kind change while members exist), `deleteCategory`, `categoryMembers`, `memberSlots`, `setSlotOverride`.

`settings.ts`: `getSetting`, `setSetting`, `listSettings`, `getFlag`, `setFlag`, `getHomePortfolioId`, `setHomePortfolioId` (the `home_portfolio_id` setting; `null` clears it).

`watched.ts`: `listWatchedDirectories`, `findWatchedDirectory`, `addWatchedDirectory`, `setWatchedRecursive`, `claimedItemIds`, `removeWatchedDirectory` (drops uncovered documents), `clearClaims`, `claimItem`, `hasClaim`.

`projects.ts`: `listProjectParents` (with counts), `addProjectParent`, `removeProjectParent`.

`tasks.ts`: task CRUD, hierarchy, `setReminders(db, taskId, reminders)`, task completion, and `taskView`/`listTaskViews`. Task schedule inputs remain strings or `{ at, days? }`; they create linked reminder records using the task's title, notes, and recurrence.

`reminders.ts`: `createReminder`, `getReminder`, `updateReminder`, `deleteReminder`, `listReminders`, `reminderView`, `listReminderViews`, `completeReminder`, `uncompleteReminder`, `dueReminders`, and `todayReminders`. A reminder owns its title, notes, recurrence, schedule, active state, and completion history. `task_id` is nullable. Completing a reminder does not complete a task; deleting a task detaches its reminders. Due selection suppresses reminders linked to completed or inactive tasks.

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
