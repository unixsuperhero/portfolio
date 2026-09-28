# CLI domain coverage

This reference records the command coverage requested by epic `td-623ef3` and audited by P2 `td-e74c33`. The P2 inventory closed on 2026-09-27. Documentation task `td-456238` checked the declarations and repeated the safe CLI checks on 2026-09-28. No new command families were implemented.

The [data model](../data-model.md) defines the records. [Architecture](../architecture.md#reuse-boundaries) identifies the reusable modules. Ruby commands in [bin](../../bin/) call [lib/pf](../../lib/pf/); sharing the SQL schema does not give them every TypeScript repository operation.

## Repository commands

There are 14 repository `pf-*` binaries. `bin/pf tools` reports commands resolved by the dispatcher; external executables on PATH can extend that set. SQL and generic HTTP access are not substitutes for validated domain commands.

| Binary | Current coverage | Missing coverage or intentional boundary |
| --- | --- | --- |
| [pf-add](pf-add.md) | Detect and create items from text, URL, or path; type, tags, title, category overrides | No dedicated task input or reminder scheduling workflow |
| [pf-detect](pf-detect.md) | Detection record and type-only output | Intentionally does not persist records |
| [pf-items](pf-items.md) | List, search, recent, show, cat, open, edit local files, flags, tags, selected field updates, delete, export | No recurrence, parent, or completion commands; `edit` opens local paths, not inline note content; `set` allows title, description, URL, type, and content |
| [pf-tags](pf-tags.md) | List, members, rename, delete, prune, add associations | No standalone empty-tag creation; prune removes unused tags |
| [pf-categories](pf-categories.md) | List, members, slots, create, edit, assign, unassign, override, delete | No core CRUD omission identified in declarations; help is not full behavioral verification |
| [pf-portfolios](pf-portfolios.md) | List, show, create, rename, description, delete, open | No options for portfolio tags or `item_filter` |
| [pf-cards](pf-cards.md) | List, show/run, preview, create, edit, move, delete query cards | No `kind` or `config` options for domain widgets |
| [pf-projects](pf-projects.md) | List, discover, scan, manage parent directories | No service execution or Git repository, branch, or worktree commands |
| [pf-docs](pf-docs.md) | Import, push, crawl links, tracked/missing documents, rerender | Document operations, not general task or note editing |
| [pf-watch](pf-watch.md) | List, add, recursive/flat setting, remove, sync, scan, run | Claims are managed internally; arbitrary claim CRUD is not needed |
| [pf-render](pf-render.md) | Render to stdout or file, fragment, template, TOC, dependency check | Intentionally separate from persistence |
| [pf-db](pf-db.md) | Path, status, init, canonical/live schema, query, backup, vacuum, reindex, SQLite shell | Raw SQL bypasses application validation and is not domain parity |
| [pf-ports](pf-ports.md) | List, process tree, open, kill, scanner lookup | Live OS operations, not durable service or Git records |
| [pf-server](pf-server.md) | URL, health, open, setup, lifecycle, status, logs, dev, API GET, items | Generic API access is GET-only, not typed task, PR, or Herdr mutation coverage |

There is no repository `pf-tasks`, `pf-reminders`, `pf-github`, `pf-prs`, `pf-herdr`, `pf-git`, or `pf-settings` binary. This does not imply that the application APIs or external Git and Herdr CLIs lack those operations.

Collection support is uneven. `pf-items ls` accepts a query, type, tag, pinned/starred flags, content search, limit, and JSON, but no sort option. Cards have query sort options. Some other listings expose only JSON. Full search/filter/sort parity is still part of the epic, not a property established by this audit.

## Verification on 2026-09-28

| Check | Observed result | Limit |
| --- | --- | --- |
| Each repository `bin/pf-* --help` | All 14 exited 0 with no stderr | Does not exercise each subcommand |
| `bin/pf tools` | All 14 commands appeared, plus dispatcher commands | PATH-dependent discovery |
| `bin/pf db schema` and `bin/pf db schema --live` | Same 16 application tables and column-name sets | Not byte-identical schema, default, index, or migration verification |
| Isolated database workflow through `bin/pf` | Note creation, content update/read, tagging, filtered lookup, portfolio/card creation, exact card item ID, note deletion, empty listing and empty card result passed | Query-card and library workflow only |
| `bin/pf render check` | Pandoc available at `/opt/homebrew/bin/pandoc` | Availability, not full rendering or import coverage |
| `bin/pf server health` | Connection refused at configured `http://docs.h:4387/health` | HTTP-backed behavior remains unverified in this configuration |

The smoke workflow used `PORTFOLIO_DB` pointing to a fresh temporary SQLite file and `PORTFOLIO_HOME` pointing to this checkout. The temporary directory was removed afterward. No application records were written to the user's database. No server was started or stopped, and no process was killed.

The executed workflow used these commands in order. `NOTE_ID` and `CARD_ID` were taken from JSON results, not assumed:

```sh
bin/pf db init
bin/pf add 'Documentation smoke note' --type note --json
bin/pf items set NOTE_ID content 'Updated documentation content'
bin/pf items cat NOTE_ID
bin/pf tags add docs-smoke NOTE_ID
bin/pf items ls --tag docs-smoke --json
bin/pf portfolios new 'Docs smoke'
bin/pf cards add 'Docs smoke' 'Smoke notes' --tags docs-smoke --types note
bin/pf cards ls 'Docs smoke' --json
bin/pf cards run CARD_ID --json
bin/pf items rm NOTE_ID --yes
bin/pf items ls --json
bin/pf cards run CARD_ID --json
```

This is an execution record, not a script to paste against a live database. Schema comparison parsed ordinary `CREATE TABLE` statements into separate in-memory databases and compared table/column sets. FTS tables were excluded. Live schema output orders objects for inspection and is not necessarily a restore script in that order.

P2's historical evidence also includes a successful Herdr session listing and read-only socket snapshot on 2026-09-27. Its observed counts were 8 workspaces, 8 tabs, 17 panes, 8 agents, and 8 layouts. Those counts are not invariants and were not remeasured for this documentation update. The raw examples in the data model retain that provenance.

Watch reconciliation, service lifecycle, port termination, GitHub network operations, and Herdr mutations were not exercised in this update. No automated test suite was run for these documentation-only changes.

## Remaining epic scope

These are unresolved implementation scopes, not completed work or silently accepted exclusions:

1. Task and reminder commands need list/show/create/update/delete, parent assignment, completion/uncompletion, and scheduling. Acceptance must distinguish task completion from reminder completion and the task's owning library item from its optional associated item.
2. Cards need `kind` and `config`; portfolios need tags and `item_filter`. Partial edits must preserve unspecified fields, and existing query-card behavior must remain intact.
3. GitHub commands need list/show/refresh/watch/ignore, check rules, and events, including `source_dir`. A library PR link is not a fetched GitHub PR record.
4. Herdr commands need the installed schema and session-scoped IDs. Session/server, workspace, tab, pane, agent, and layout inspection must remain distinguishable without a second hardcoded operation catalog.
5. Read-only Git adapter records need agreed identity and missing/bare/detached worktree behavior before implementation. Filling a command checklist does not justify new persistence or destructive worktree operations.
6. Each new collection command needs defined search, filters, sorting, and machine-readable output. Mutations need boundary validation and verification of ownership, foreign keys, completion history, and preservation of unspecified fields in an isolated database or deliberately selected integration target.

The epic cannot be called complete until these gaps are implemented or explicitly accepted as exclusions. Embedded PR checks remain current behavior; normalized Check/PrCheck records remain [deferred proposals](../data-model.md#check-identity-and-proposed-normalization).

Back to the [documentation index](../index.md).
