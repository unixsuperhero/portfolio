# Overview

## Layout

```text
portfolio/
  app.js                 the existing server (untouched)
  schema.sql             the existing schema (copied into packages/db/src)
  bin/
    pf                   dispatcher: pf <tool> <subcommand>
    pf-items … pf-server fourteen tools, one file each, Ruby + hiiro
    h-pf                 hiiro wrapper that execs pf
    h-docs, mdoc, …      the older tools, unchanged
  lib/pf.rb              shared Ruby bootstrap
  lib/pf/                Ruby domain and CLI helpers
  Gemfile, Gemfile.lock   Ruby runtime and test dependencies
  packages/
    core/                @portfolio/core      pure logic, no I/O beyond fs.stat
    db/                  @portfolio/db        bun:sqlite repos
    render/              @portfolio/render    Pandoc
    watch/               @portfolio/watch     watched dirs, project discovery
    ports/               @portfolio/ports     ports-scan wrapper
    client/              @portfolio/client    fetch client
    cli-kit/             @portfolio/cli-kit   hiiro-style CLI framework
    cli/                 @portfolio/cli       retained Bun CLI helpers
    ui/                  @portfolio/ui        React components + CSS
  scripts/
    gen-cli-docs.ts      legacy Bun help generator, not used for Ruby tools
  docs/                  this document set
```

Every TypeScript package is a Bun workspace: `bun install` at the root links them. Bun runs those packages directly; `packages/ui` also has a `build` script for consumers outside the repo. The `pf` tools run in Ruby and use `lib/pf/` instead of importing these packages.

## Install

```bash
cd ~/proj/portfolio
bundle install
bun install
bundle exec ruby -Itest test/pf/pf_integration_test.rb
bun test packages
bun run typecheck
```

Put `~/proj/portfolio/bin` on your `PATH` to call the tools as `pf-items`, or call them by path. `h-pf` is a hiiro bin, so `h pf items ls` works once `bin/` is on `PATH` too. Nothing was installed into `~/bin`.

## Five-minute tour

The tools talk straight to `portfolio.sqlite` (WAL mode, so the running server and a tool can both use it). Every tool answers `--help`, and every subcommand can be abbreviated to a unique prefix.

```bash
pf it count                              # counts by type
pf-items ls procedural -t document -f    # search with a table view
pf-items show 42                         # one item as JSON with tags and slots
pf-add https://github.com/x/y/pull/12 -g review
pf-portfolios new YouTube
pf-cards add YouTube "Scripts" -g yt,slides -t document -s title -d asc
pf-cards preview -g yt -t link -m 5      # run a query without saving a card
pf-portfolios show YouTube               # cards and what they match right now
pf-docs add -r docs/index.md             # import a linked set of Markdown files
pf-watch add ~/notes/docs -r             # pull a directory into the library
pf-ports ls                              # who listens where
pf-db backup                             # VACUUM INTO a timestamped copy
```

The React side has a demo:

```bash
bun run ui:demo                          # http://localhost:4390
```

## What each level is for

- Use a **package** when writing a new server, a script, a test, or a different UI. Packages never print, never exit, and never read `process.argv`.
- Use a **CLI tool** from the shell, from Claude, or from hiiro. Tools declare Hiiro commands, call Ruby helpers, and print.
- Use a **component** in any React app, or render it to a string on the server with `@portfolio/ui/server`.

Back to the [index](index.md).
