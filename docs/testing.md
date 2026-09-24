# Testing

```bash
bundle install
bundle exec ruby -Itest test/pf/pf_integration_test.rb
bun test packages
bun test packages/db         # one package
bun run typecheck            # tsc --noEmit over packages/*/src, packages/*/test, bin/*.ts
bun test                     # also runs the older test/*.test.js suite against app.js
```

The Ruby integration suite launches the real CLI against temporary databases,
files, and HOME directories. It covers offline mutations, collections, FTS,
Markdown imports and rendering, watched-directory reconciliation, and database
initialization and legacy migrations. Pandoc must be installed.

To compare read output with a saved copy of the former Bun executables:

```bash
PF_BASELINE_BIN=/path/to/original/bin bundle exec ruby -Itest test/pf/pf_integration_test.rb
```

The baseline must have access to the original workspace packages. Tests pass
the repository's TypeScript configuration to Bun explicitly.

What the tests cover:

| Package | Tests |
|---------|-------|
| core | escaping, slugs, tag parsing, titles, path expansion, local link resolution, detection with a fake probe, slot parsing and resolution, card normalization and in-memory runs, hrefs |
| db | upsert by source path, patches and toggles, every list filter including FTS, tag pruning, portfolios and cards end to end (OR tags, type narrowing, sort, cap, move, cascade), categories and slot overrides, watch claims and cleanup, the bound store |
| render | template rendering, link rewriting to `/items/:id`, AST link extraction, crawling with a missing-link error (skipped automatically when Pandoc is absent) |
| watch | a real temp directory: import, recursive off removes nested docs, deleted file removes the item, missing directory reports an error; project discovery stops at repositories |
| ports | URL building, lookup, kill guards, running a fake scanner script that succeeds and one that fails |
| client | URL and body construction with a fake fetch, error surfacing, connection refusal |
| cli-kit | option parsing in every form, prefix matching, dispatch (exact, alias, prefix, ambiguous, unknown, help, exit codes, nested child), external bins, default command, tables |
| ui | server-rendered markup of every component: card header and count, query line, sort order, capped count, empty state, grid, form values, editor, item rows, `toHtml` |

## Smoke test of the tools

The tools were exercised end to end against a copy of the real database. To repeat that safely:

```bash
sqlite3 portfolio.sqlite "VACUUM INTO '/tmp/scratch.sqlite'"
export PORTFOLIO_DB=/tmp/scratch.sqlite PF_PICKER=head
bin/pf-add https://github.com/x/y/pull/12 -g review
bin/pf-portfolios new Demo && bin/pf-cards add Demo "PRs" -t pr && bin/pf-portfolios show Demo
bin/pf-docs add -r docs/index.md && bin/pf-watch add /tmp/somedocs -r && bin/pf-watch ls
```

`PF_PICKER=head` makes the fuzzy picker non-interactive (first match wins).

## Maintaining the CLI reference

Update `docs/cli/` alongside the Ruby command declarations. The retained
`scripts/gen-cli-docs.ts` parses the former Bun help format; do not use it to
regenerate the Ruby CLI reference.

Back to the [index](index.md).
