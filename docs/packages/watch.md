# @portfolio/watch

Two jobs: keep documents from watched directories in sync with the database, and discover projects under parent directories. Both are the server's behavior lifted out so a CLI or a different server can run them.

```ts
import { scanDirectory, reconcile, DirectoryWatcher, discoverProjects, scanProjects } from "@portfolio/watch";
```

## Watched directories

| Function | Does |
|----------|------|
| `scanDirectory(path, recursive)` | `Map<sourcePath, { sourcePath, content, title, html }>` of every `.md`, `.markdown`, `.html` file |
| `reconcile(db, render, directories?)` | one full pass over every watch: upsert documents, rewrite claims, delete documents nothing claims, re-render Markdown so cross-links resolve. Returns `{ states, upserted, removed }` |
| `sourceItemIds(db)` | `source_path` to id for link rewriting |
| `new DirectoryWatcher(db, render, { debounceMs, onError })` | one `fs.watch` per directory; `schedule()` debounces, `sync()` never overlaps and queues at most one more run, `reload()` rebuilds the watchers from the table, `close()` stops |

`render` is injected: `(markdown, { title, toc, sourcePath, resolveId }) => html`. The tests pass a fake; the tools pass `renderMarkdown` from [@portfolio/render](render.md).

A directory that fails to scan keeps its previous claims, so a temporarily unmounted volume does not wipe its documents. Turning recursion off or removing a watch does remove the documents no other watch covers; source files are never touched.

## Projects

| Function | Does |
|----------|------|
| `discoverProjects(parent, depth = 4)` | every direct child, plus any deeper directory with `.git` at its top; stops descending at a repository; skips hidden directories and `node_modules` |
| `scanProjects(db, home?)` | ensures the `project` category (kind `dir`, one slot `tasks \| file \| TASKS.md`), adds new projects as `dir` items with the `project` tag, returns the added paths; never removes |

## Example

```js
const store = openStore();
store.watched.addWatchedDirectory("/Users/me/notes/docs", true);
const result = await reconcile(store.db, (md, o) => renderMarkdown(md, o));
result.states.get(1);   // { error: null, lastSyncedAt: "2026-09-22T…", count: 37 }
```

Tests: `packages/watch/test/watch.test.ts` (real temp directories, no Pandoc needed). Back to the [index](../index.md).
