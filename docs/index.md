# Portfolio toolset

Portfolio is a local library of documents, notes, links, PRs, files, and directories, with tags, portfolios of query cards, categories with slots, watched directories, project discovery, and a ports view. This set of documents describes the reusable pieces that were carved out of the app so the next rewrite starts from parts instead of from zero.

There are three levels, and every level is complete on its own:

| Level | What | Where |
|-------|------|-------|
| Packages | TypeScript modules with no UI: domain logic, SQLite storage, Pandoc rendering, watching, ports, an HTTP client, and a CLI framework | `packages/*` |
| CLI tools | `pf` and fifteen `pf-*` executables built on the packages, in the hiiro style | `bin/pf*`, `bin/h-pf` |
| UI components | React components for the cards, rails, rows, badges, and forms, with the CSS tokens they use | `packages/ui` |

## Start here

- [Overview](overview.md) — the layout, how to install, and a five-minute tour
- [Data model](data-model.md) — every record shape as JavaScript data, with examples
- [Architecture](architecture.md) — how the packages depend on each other, and how `app.js` maps onto them
- [Suggestions](suggestions.md) — reusable tools worth extracting next, and a better way to build the next version
- [Testing](testing.md) — running tests, the typecheck, and the smoke script

## Packages

- [@portfolio/core](packages/core.md) — types, constants, detection, paths, slots, cards, text helpers
- [@portfolio/db](packages/db.md) — SQLite schema, migration, and repos for every table
- [@portfolio/render](packages/render.md) — Markdown to HTML through Pandoc, link rewriting, link crawling
- [@portfolio/watch](packages/watch.md) — watched directories, project discovery, and per-project services
- [@portfolio/ports](packages/ports.md) — TCP listener snapshots, safe kills, and matching ports to projects
- [@portfolio/api](packages/api.md) — the desktop app's JSON HTTP API, a route table over db/watch/ports/render/github
- [@portfolio/client](packages/client.md) — fetch client for the HTTP API
- [@portfolio/github](packages/github.md) — GitHub pull requests through the `gh` CLI: query building, parsing, diffing, and a poller
- [@portfolio/cli-kit](packages/cli-kit.md) — the hiiro-style CLI framework for Bun
- [@portfolio/cli](packages/cli.md) — shared helpers the `pf-*` tools use
- [@portfolio/ui](packages/ui.md) — React components and CSS

## CLI tools

- [pf](cli/pf.md) — the toolbox dispatcher; `pf items ls` runs `pf-items ls`
- [pf-items](cli/pf-items.md) — list, search, show, flag, tag, open, remove items
- [pf-tags](cli/pf-tags.md) — tags and what carries them
- [pf-portfolios](cli/pf-portfolios.md) — portfolios of cards
- [pf-cards](cli/pf-cards.md) — cards: saved queries, previewed or saved
- [pf-categories](cli/pf-categories.md) — categories, slots, overrides
- [pf-detect](cli/pf-detect.md) — what a pasted thing is
- [pf-add](cli/pf-add.md) — quick add from the terminal
- [pf-docs](cli/pf-docs.md) — import Markdown and HTML, follow links, re-render
- [pf-render](cli/pf-render.md) — Markdown to HTML with the document template
- [pf-watch](cli/pf-watch.md) — watched directories
- [pf-projects](cli/pf-projects.md) — project discovery
- [pf-ports](cli/pf-ports.md) — local TCP listeners
- [pf-db](cli/pf-db.md) — the SQLite file: status, queries, backups
- [pf-server](cli/pf-server.md) — the launchd service and HTTP calls
- [h-pf](cli/h-pf.md) — the hiiro entry point that forwards to `pf`

## UI

- [Components](ui/components.md) — `PortfolioCard`, `PortfolioGrid`, `CardForm`, `CardEditor`, `RailSection`, `RailItem`, `ItemRow`, `ItemList`, badges, hooks
- [Demo and theming](ui/demo.md) — the live demo page, the CSS tokens, light and dark
