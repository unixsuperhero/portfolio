# Testing

```bash
bun test packages            # every package: 38 tests, ~1 s
bun test packages/db         # one package
bun run typecheck            # tsc --noEmit over packages/*/src, packages/*/test, bin/*.ts
bun test                     # also runs the older test/*.test.js suite against app.js
```

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

## Regenerating the CLI reference

```bash
bun scripts/gen-cli-docs.ts     # rewrites docs/cli/*.md from --help output
```

Back to the [index](index.md).
