# @portfolio/core

Pure domain logic. Imports only `node:path` and `node:fs` (for `detect` and `resolveSlots`), never a database or a server. Every other package builds on it.

```ts
import { detect, normalizeCard, runCard, resolveSlots, itemHref } from "@portfolio/core";
```

## Modules

| Module | Exports |
|--------|---------|
| `types.ts` | `Item`, `ItemView`, `Tag`, `Portfolio`, `CardSpec`, `Card`, `CardResult`, `Slot`, `ResolvedSlot`, `Category`, `WatchedDirectory`, `ProjectParent`, `Detection`, `ItemFilter` |
| `constants.ts` | `ITEM_TYPES`, `PATH_TYPES`, `EXTERNAL_TYPES`, `CARD_SORT_KEYS`, `CARD_SORT_LABELS`, `CARD_MAX_ITEMS`, `DOCUMENT_EXTENSIONS`, `KIND_LABELS`, `isItemType`, `isPathType`, `isCardSortKey` |
| `text.ts` | `escapeHtml`, `slugify`, `parseTags`, `firstHeading`, `firstLine`, `htmlTitle`, `documentTitle`, `textTitle`, `truncate` |
| `paths.ts` | `expandPath`, `abbreviatePath`, `normalizeItemPath`, `isHtmlPath`, `isMarkdownPath`, `isDocumentPath`, `localMarkdownLink` |
| `detect.ts` | `detect`, `detectUrl`, `detectPath`, `detectText`, `fsProbe`, `PathProbe` |
| `slots.ts` | `parseSlots`, `formatSlots`, `resolveSlots` |
| `cards.ts` | `BLANK_CARD`, `normalizeCard`, `parseCardRow`, `cardMatches`, `compareItems`, `runCard`, `describeCard` |
| `items.ts` | `kindLabel`, `isExternal`, `itemHref`, `toItemView`, `itemLabel` |

## Examples

Detection, with the disk probe swapped out:

```js
const probe = async path => (path.endsWith("/docs") ? "dir" : null);
await detect("~/docs", { probe, home: "/Users/me" });
// { shape: "path", type: "dir", title: "docs", path: "/Users/me/docs", exists: true }
```

Cards in memory (what the demo page does):

```js
const card = normalizeCard({ title: "YT", tags: "yt, slides", types: ["link"], sort_key: "title", sort_dir: "asc", max_items: "2" });
// { title: "YT", tags: ["yt", "slides"], types: ["link"], sort_key: "title", sort_dir: "asc", max_items: 2 }
runCard(card, itemViews);
// { total: 5, items: [ /* 2 ItemViews, links tagged yt or slides, by title */ ] }
describeCard(card);
// "#yt #slides link · title asc · max 2"
```

Slots:

```js
const slots = parseSlots("tasks | file | TASKS.md\nlogs | dir | ~/Library/Logs/x");
resolveSlots(slots, { memberPath: "/Users/me/proj/app", overrides: { logs: "/var/log/app" }, home: "/Users/me" });
// [
//   { name: "tasks", kind: "file", path: "/Users/me/proj/app/TASKS.md", overridden: false, exists: true },
//   { name: "logs",  kind: "dir",  path: "/var/log/app",                overridden: true,  exists: false },
// ]
```

Links between imported Markdown files:

```js
localMarkdownLink("/d/a.md", "sub/b.md#top");   // { sourcePath: "/d/sub/b.md", suffix: "#top" }
localMarkdownLink("/d/a.md", "https://x.dev");  // null
```

## Rules the code encodes

- A single-line `http(s)://` URL is a link, or a PR when it contains `/pull/N` or `/merge_requests/N`. Text that merely contains a URL is a note.
- A single-line path starting with `/` or `~/` is a dir when it exists as one, a document for `.md`, `.markdown`, `.html`, otherwise a file. It does not have to exist.
- Card tags are OR-ed, types AND-narrow, empty means any, and every type checked collapses to empty.
- Title sorting is case-insensitive, and ties break by newest id first, in both SQL and memory.

Tests: `packages/core/test/core.test.ts`. Back to the [index](../index.md).
