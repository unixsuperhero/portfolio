# Suggestions

What to extract next, what to build differently, and what could become a tool of its own. These come from reading `app.js`, the hiiro bins, and the way this project has been rewritten before.

## Reusable tools worth pulling out

1. **A JSON API package (`@portfolio/api`).** The routes in `app.js` mix HTML and JSON. The JSON half (`/api/items`, `/api/items/:id`, `/api/detect`, `/items/quick`, `/api/documents`, `/api/portfolios/:id`, `/api/ports`, `/api/settings`) is a set of pure functions of `(store, request) → Response` now that every repo exists. Putting them in one package means the next UI, whether HTML, React, a TUI, or Claude, talks to the same thing. Roughly 300 lines; every function already has a package to call.

2. **Quick add as a library (`quickAdd(store, content, { type, tags })`).** `pf-add` and `app.js`'s `quickAdd` are the same twenty lines twice. Move it into `@portfolio/db` (or the api package) and both call it. Same for `importDocument`.

3. **A generic "saved queries over tagged things" package.** `core/cards.ts` is already independent of Portfolio's item types beyond the type list. Parameterize the type list and it is a library for any tagged collection: bookmarks, tasks, notes, photos. The `PortfolioCard` component is the same story on the UI side.

4. **`cli-kit` as its own repo.** It is hiiro's shape for Bun and has nothing Portfolio-specific in it. Every future TypeScript CLI can start from `cli("name", c => …)`. The one feature hiiro has that it lacks is the invocation log (`Hiiro::Invocation.record!`); a `onRun` hook that appends `{ bin, subcmd, args, at }` to a JSONL file would cover it.

5. **`ports-scan` in TypeScript.** It is Python today, so the `ports` package shells out. Porting it (lsof + ps + `herdr` parsing) would make `pf-ports` a single runtime and let the server call it in-process on an interval, with the snapshot cached so the page never blocks.

6. **A directory browser package.** `/api/settings/directories` plus the two copies of the browser script (settings page and quick-add modal) are one small thing: list dirs and files under a path, walk up, choose. As a component it is `<DirectoryPicker api={client} onPick={…} />`.

7. **A document page renderer package.** `templates/document.html` plus the copy-code buttons, theme toggle, and TOC highlighting that live inside it are a self-contained "render Markdown as a nice page" tool. `pf-render` exposes it already; the same template could be published as its own thing, with `mdoc`, Obsidian exports, and the docs skill all using it.

## A better way to build the next version

- **Grow the server from the packages, not the other way round.** Every rewrite so far started at the HTTP layer. Next time, start with `openStore()` and the `pf-*` tools, which already prove the data layer, and add routes one at a time as thin adapters. `docs/architecture.md` has the recipe.

- **One HTML strategy.** `app.js` renders with template strings; `@portfolio/ui` renders with React. Pick one for the next server. `toHtml()` from `@portfolio/ui/server` gives static HTML from the components with no client JavaScript, so server-rendered pages and the interactive demo can share the same source. The cost is one dependency (react-dom/server); the win is never writing a card twice.

- **Separate data from behavior in the schema too.** `items` carries columns for six types. It works, but the `path`/`source_path`/`url` triad and the `content`/`rendered_html` pair are where most conditionals in `app.js` come from. A `documents` side table (content, rendered_html, source_path, toc) keyed by item id would leave `items` as the thing every type shares, and the repos in `@portfolio/db` are the only place that would change.

- **Cache renders lazily, everywhere.** `rendered_html` is filled eagerly on import and on every watch reconcile, which is why a big watched tree takes seconds to sync. Storing a content hash and rendering on first view (the item page already does this when `rendered_html` is empty) makes reconcile instant and keeps Pandoc out of the write path.

- **Test at the package level, smoke at the tool level.** The 38 package tests run in under a second with no server. The older `test/*.test.js` suite boots the whole app per file. Keep both, but write new behavior in a package first, where the test is ten lines.

- **Docs from the code.** `scripts/gen-cli-docs.ts` regenerates the CLI reference from `--help`. Do the same for the API (a route table from the api package) and the data model (from the TypeScript types) so the docs cannot drift.

## Small things noticed on the way

- `bin/mdoc` in the repo differs from the copy in `~/bin`. `pf-docs push` does what `mdoc -r` does; once it is trusted, `mdoc` can become a two-line wrapper.
- `h-docs` reads `HDOCS_SERVER`; the new tools read `PORTFOLIO_SERVER` first and fall back to `HDOCS_SERVER`, so both keep working. Picking one name would be tidier.
- The card `max_items` cap is enforced in three places (form, SQL, `normalizeCard`). It is now only `normalizeCard`; the others can be deleted from `app.js` when it moves onto the packages.
- `.gitignore` ignores `bun.lock`. Committing it makes `bun install` reproducible across machines.

Back to the [index](index.md).
