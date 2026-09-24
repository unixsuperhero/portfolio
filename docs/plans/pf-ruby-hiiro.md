# Plan: convert `bin/pf` and `pf-*` to Ruby on hiiro

Status: Implemented and runtime-verified, Ruby-only. Original plan written 2026-09-23.

Goal: replace the Bun/TypeScript `pf` dispatcher and 14 `pf-*` tools with Ruby
executables built on the `hiiro` gem (`/Users/unixsuperhero/proj/hiiro`), the same
way hiiro's own `h-*` tools are built. `h-pf` already exists as a hiiro shim that
just `exec`s `bin/pf`; this plan folds `pf` itself into hiiro so `h-pf` (and `pf`)
become native hiiro dispatch instead of an exec wrapper.

## Execution decisions

The user's Ruby-only scope supersedes the API-only mutation proposal below.
The implementation preserves the former CLI's direct SQLite writes, original
server URL and launchd behavior, and multipart document uploads. TypeScript,
JavaScript, backend routes, and the canonical SQL schema remain unchanged.

The runtime is Ruby with hiiro 0.1.384, sqlite3, and standard-library Net::HTTP.
Dependencies live in the root Gemfile and lockfile. Shared code lives in
`lib/pf/`; integration verification is Ruby/Minitest in `test/pf/`.
`h-pf` retains its forwarding shim and Hiiro built-in commands.

Four non-Astra workers ran through `/swarm` for mutations, documents,
operations, and Ruby verification. The parent owns integration, disposable
runtime verification, documentation, and the commit.

Verification: six Ruby integration tests with 269 assertions passed, including
42 read-command comparisons against the original Bun executables. Disposable
runtime smoke checks covered the actual server's development mode and HTTP
commands, multipart document upload, live watch edits and deletions, overlapping
watch claims, failed scans, and signalling a test-owned TCP listener.
Live launchd installation and control were not run against the user's service.
The unchanged Bun package suite also passed: 139 tests, 601 assertions.

---

## 1. Hiiro API summary (as it applies to `pf`)

All paths relative to `/Users/unixsuperhero/proj/hiiro` unless noted.

### 1.1 App/command declaration

- `Hiiro.run(*ARGV, **values, &block)` — `lib/hiiro.rb:129` — build + immediately
  `.run` a CLI. Preferred entry point for any bin whose classes are already
  defined elsewhere (README "Adding Subcommands" section; `AGENTS.md` "Coding
  Rules" section: use `Hiiro.run` when the bin only *uses* existing classes, use
  `Hiiro.init` + manual `h.run` when the bin defines new classes first).
- `Hiiro.init(*ARGV, **values, &block)` — `lib/hiiro.rb:72` — same setup, does
  not run. Returns the `Hiiro` instance so you can attach helper classes before
  `.run`.
- `hiiro.add_cmd(*names, args: [], opts: [], passthrough: false, &block)` —
  `lib/hiiro.rb:360` — the declaration form with **declared options** (shows in
  help, `-h`/`--help` auto-handled). `opts:` names come from `hiiro.add_option` /
  `hiiro.add_flag` (global) or become auto-boolean flags if undeclared.
  Equivalent to `pf-cards`'s `c.cmd(names, spec, handler)` in `cli-kit`.
- `hiiro.add_subcmd` / `add_subcommand(*names, opts: nil, **values, &handler)` —
  `lib/hiiro.rb:325` — the lighter form, no declared-options help text; used
  everywhere in existing `h-*` bins (`bin/h-todo`, `bin/h-branch`) for commands
  that hand-parse their own args from `*args`.
- `hiiro.add_default(**values, &handler)` — `lib/hiiro.rb:321` — runs when no
  subcommand word matches (cli-kit's `c.default`). `h-pf` uses this today:
  `bin/h-pf:9` — `add_default { |*args| exec(PF, *args.map(&:to_s)) }`.
- `hiiro.run_child(subcmd=nil, args=nil, **kwargs, &block)` /
  `make_child(...)` — `lib/hiiro.rb:238,258` — nested command groups that share
  parent resolvers, e.g. `pf projects parents ls`. Equivalent to cli-kit's
  `c.child(names, desc, setup)` (`packages/cli-kit/src/cli.ts:76`).
- `Hiiro::Options.setup(&block)` / `hiiro.add_option` / `hiiro.add_flag` —
  `lib/hiiro/options.rb:9,52,59` — declare `option(name, short:, type:, default:,
  desc:, multi:, flag_ifs:)` and `flag(name, short:, default:, desc:)`; a
  `mutual_exclusion(hub, *spokes)` group is also available (`options.rb:73`),
  which cli-kit has no equivalent of yet.

### 1.2 Subcommand / prefix matching

- `Hiiro::Matcher` — `lib/hiiro/matcher.rb` — `by_prefix`, `by_substring`,
  `find_path`/`resolve_path` for `a/b` hierarchical names, `Result#exact_match`,
  `#one?`, `#ambiguous?`, `#resolved`. This is the direct analog of cli-kit's
  `matchByPrefix` (`packages/cli-kit/src/matcher.ts:4`), but richer (path
  matching, substring matching, ambiguity introspection) than cli-kit's single
  function.
- Dispatch order inside `Hiiro::Runners` (`lib/hiiro.rb:594-670`): exact name
  match → single unambiguous prefix match → default subcommand → help. External
  `<bin>-*` executables on `PATH` are discovered via `Runners.all_bins`
  (`lib/hiiro.rb:617`) unless `external_commands: false` is passed to
  `Hiiro.run`/`make_child` (used by `h-pf` today, `bin/h-pf:8`, so `h pf` doesn't
  pick up unrelated `pf-*`-prefixed executables on `PATH`).
- `Hiiro::Runners.remove_child_runners` (`lib/hiiro.rb:666`) drops a parent
  runner when a same-prefixed child runner also matches, avoiding double
  listing of e.g. `pf` and `pf-items` in one listing.

### 1.3 Options parsing

`Hiiro::Options::Args` (`lib/hiiro/options.rb:114`) supports:
- long (`--tag foo`, `--tag=foo`), short (`-t foo`, combined `-abc`), `--` to
  stop parsing, `[]`/`fetch`/`method_missing` (`opts.tag`, `opts.tag?`),
  `opts.args` for remaining positionals, `opts.help?`.
- `defn.coerce(value)` handles `:integer`/`:float` (`options.rb:311`); no
  built-in "multi" positional collector beyond `opts.args` (an array already).
- `options.select(opts)` (`options.rb:88`) builds a command-scoped subset from
  globally-declared + auto-flag names, with short-flag deconfliction — this is
  what `add_cmd(opts: %i[...])` calls internally.

### 1.4 Output helpers

Hiiro itself has **no built-in table/JSON printer** equivalent to cli-kit's
`packages/cli-kit/src/io.ts` `table()`/`json()`. Existing `h-*` bins print with
plain `puts` and hand-rolled formatting (e.g. `BranchManager#show_entry` in
`bin/h-branch`). For `pf`, this plan proposes a small `Hiiro::Cli` (new, see
§3) porting `table()`, `json()`, `pick()`/`pickOne()`, `openDefault()`,
`editFiles()`, `copyToClipboard()`, `readStdin()`, `confirm()`, `numberArg()`
straight out of `packages/cli-kit/src/io.ts:1-71`, since hiiro has close but
not identical primitives:
- `hiiro.fuzzyfind(lines)` / `fuzzyfind_from_map(hash)` —
  `Hiiro::Fuzzyfind.select`/`map_select` (`lib/hiiro/fuzzyfind.rb`) — same job
  as cli-kit's `pick`/`pickOne` (`io.ts:19,31`), backed by `sk`/`fzf` already.
- `hiiro.open_default(target)` — `lib/hiiro.rb:225` — same as cli-kit's
  `openDefault` (`io.ts:40`), uses `open`/`xdg-open`.
- `hiiro.edit_files(*files, max_splits: 3)` — `lib/hiiro.rb:208` — same as
  cli-kit's `editFiles` (`io.ts:45`), same vim `-O` split behavior.
- Nothing built-in for `table()`, `json()` pretty-printing, `readStdin`,
  `confirm`, `copyToClipboard`, `numberArg` — port these as plain Ruby helpers.

### 1.5 Config

- `Hiiro::Config` — `lib/hiiro/config.rb` — `BASE_DIR = ~/.config/hiiro`,
  `DATA_DIR = ~/.local/share/hiiro`, `Config.path(relpath)`,
  `Config.load_yaml(relpath, default:, permitted_classes:)`, `Config.yaml_dig`.
  `pf` does not need this (its "config" is `PORTFOLIO_HOME`/`PORTFOLIO_DB`/
  `PORTFOLIO_SERVER` env vars — see `packages/cli/src/index.ts:9-21` — so a
  parallel `Hiiro::Config`-style YAML store is not required for parity, only if
  we want e.g. a saved default server URL).

### 1.6 DB helpers

- `Hiiro::DB` (`lib/hiiro/db.rb`) is a **Sequel + SQLite** layer specific to
  hiiro's own `~/.config/hiiro/hiiro.db`. It is **not** reusable for Portfolio's
  `portfolio.sqlite` — schema, migrations, and models are hiiro's own
  (`Hiiro::TodoItem`, `Hiiro::TaskRecord`, etc., each doing
  `Hiiro::DB.register(self)` then `Sequel::Model(:table)`,
  see `lib/hiiro/task_record.rb:1-22`). For `pf`, the Ruby side would open
  `portfolio.sqlite` itself with `sqlite3`/`Sequel` and hand-roll repos mirroring
  `packages/db/src/*.ts`, or (per the architecture recommendation in §3) skip
  this and go through the HTTP API instead.

### 1.7 Effects / side-effect separation

`lib/hiiro/effects.rb` (`Hiiro::Effects`) defines:
- `Executor` — real: `capture`/`run`/`check` wrapping backticks/`system`.
- `NullExecutor` — test double: `stub(pattern, output)`, `called?(pattern)`,
  `calls_to(method)`, records every call (`effects.rb:20-76`).
- `Filesystem` / `NullFilesystem` — real vs. in-memory file I/O double
  (`effects.rb:79-150`), with `writes`/`deletes`/`renames`/`content_at` for
  assertions.

These exist specifically so side-effect-heavy code (tmux, git, launchctl, file
writes) can be unit-tested by injecting the Null* double instead of hitting the
real OS. `side-effect-separation-plan.md` (repo root) is a **transcript of a
prior planning conversation**, not a committed architecture doc — it records
the user picking "Option B + Option A": (B) only test the model/domain layer
directly, skip testing side-effect-heavy bin files as unit tests; (A)
incrementally extract presenter/domain objects from bin files whenever a file
is being touched anyway, rather than a big-bang refactor. There is no
`lib/hiiro/side_effect_separation.rb` or similar library file — the "plan" is
philosophy + the `Effects` module, not more code to point at.

**Applicability to `pf`:** `pf-server`'s `launchctl` calls and `pf-ports`'s
process/TCP scanning are exactly the side-effect-heavy code this pattern
targets. Wrap those two tools' OS calls behind a small `Executor`-shaped
adapter from day one (inject a `NullExecutor` in tests) rather than calling
`system`/backticks directly, matching hiiro's own convention.

### 1.8 Testing conventions (`test/`)

- Framework: Minitest (`test/test_helper.rb:3`), one `require "test_helper"`
  per file, `class FooTest < Minitest::Test`.
- `test/test_helper.rb:9` sets `ENV['HIIRO_TEST_DB'] = 'sqlite::memory:'`
  *before* `require "hiiro"` so any Sequel model tests run against an
  in-memory DB — **this only matters if pf-ruby uses `Hiiro::DB`, which per
  §1.6 it should not**; Portfolio's own SQLite tests would instead point
  `PORTFOLIO_DB` at a temp file or `:memory:` directly.
- `test/test_helper.rb:12-20` stubs `Hiiro::Config.plugin_files` to `[]` so
  test runs don't load the user's real `~/.config/hiiro/plugins/*.rb`.
- `test/hiiro/todo_test.rb:1-60` — plain unit tests against a domain object
  (`Hiiro::TodoItem`), no CLI invocation, no stdout capture — the "Option B"
  ideal: test the model, not the bin.
- `test/bin/*_test.rb` — bin-file tests via `Hiiro::TestHarness`
  (`test/test_helper.rb`, deprecated-but-present `SystemCallCapture`, and the
  newer `Effects::NullExecutor`/`NullFilesystem` injection pattern) — these
  capture the block passed to `Hiiro.run` and evaluate it with stubbed system
  calls, for the thin orchestration layer only.
- Run with `bundle exec rake test` (README "Testing" section).

### 1.9 Real subcommand structure (patterns to imitate)

- `bin/h-todo` (`cat -n` above): single flat `Hiiro.run(*ARGV) do ... add_subcmd(:ls) do |*ls_args| ... end ... end` block, hand-parsing `*args` inside each block — this is the pattern most `pf-*` tools with simple flag sets should imitate for a first pass (no `add_cmd`/declared options), since it is the majority style in the existing gem.
- `bin/h-branch` (`cat -n` above): defines a plain Ruby class (`BranchManager`) first, `Hiiro.init` after, per the "defines new classes → use init" rule in `AGENTS.md`.
- `lib/hiiro/task_record.rb:1-71`: `Sequel::Model(:table)` pattern for any table pf-ruby chooses to touch directly (only relevant if we pick architecture option (b)/(c) in §3).
- `lib/hiiro/registry.rb:1-40`: a generic `find_by_ref(ref, type:, substring:)` resolving by exact name → short_name → unambiguous prefix — a good template for `pf`'s many "resolve NAME_OR_ID" helpers (`portfolioOf`, `categoryOf`, `resolvePortfolio` in the TS source).

---

## 2. Inventory: every `pf`/`pf-*` tool today

Source: `bin/pf`, `bin/pf-*` (14 tools), `packages/cli-kit/src/*.ts`,
`packages/cli/src/index.ts`.

```js
// pf — dispatcher (bin/pf, 12 lines)
{
  commands: {
    "root":     { desc: "print the project root", calls: ["@portfolio/cli:projectRoot"] },
    "db-path":  { desc: "print the database path", calls: ["@portfolio/cli:databasePath"] },
    "tools":    { desc: "list the pf-* tools", calls: ["cli.commandNames()"] },
  },
  externalBins: true, // discovers pf-* on PATH/binDir automatically
}
```

| Tool | Commands | Backing package calls | Data touched |
|---|---|---|---|
| **pf-add** | default (add TEXT\|-) | `@portfolio/core: detect, documentTitle, isHtmlPath, isItemType, parseTags`; `@portfolio/render: renderMarkdown`; `@portfolio/cli: openDefaultStore, itemUrl`; `@portfolio/cli-kit: openDefault` | `store.items.{upsertItem,setPathAndCategory,setRenderedHtml,getItem}`, `store.tags.setTags`, `store.categories.findCategory` — writes `portfolio.sqlite` |
| **pf-detect** | default (detect TEXT\|stdin) | `@portfolio/core: detect` | none (pure) |
| **pf-render** | default (FILE→HTML), `template`, `check` | `@portfolio/render: renderMarkdown, renderFragment, pandocAvailable, pandocBin, DEFAULT_TEMPLATE`; `@portfolio/core: documentTitle` | none (pure, shells out to Pandoc) |
| **pf-items** | ls/list/search, recent, count, show/get, cat, open, vim/edit, path, pin/unpin/star/unstar, toggle, tag, untag, set, rm/remove/delete, export | `@portfolio/cli: LIST_OPTS, findItems, itemUrl, label, openDefaultStore, pickItem, printItems`; `@portfolio/core: abbreviatePath, parseTags`; `node:fs/promises: unlink` | `store.items.*` (get/list/view/set flags/update/delete), `store.tags.*`, `store.categories.memberSlots` — reads/writes `portfolio.sqlite` |
| **pf-tags** | ls/list, items/show, rename, rm/remove, prune, add | `@portfolio/cli: LIST_OPTS, openDefaultStore, printItems` | `store.tags.*`, raw `DELETE FROM tags` |
| **pf-portfolios** | ls/list, show, new/add/create, rename, rm/remove/delete, open | `@portfolio/cli: openDefaultStore`; `@portfolio/core: describeCard`; `@portfolio/client: defaultServer` | `store.portfolios.*` |
| **pf-cards** | ls/list, show/run, preview/query, add/new, edit/set, move, rm/remove/delete | `@portfolio/cli: openDefaultStore`; `@portfolio/core: describeCard, normalizeCard, ITEM_TYPES` | `store.portfolios.{portfolioCards,getCard,cardItems,createCard,updateCard,moveCard,deleteCard}` |
| **pf-categories** | ls/list, items/members, slots, add/new, edit/set, assign, unassign, override, rm/remove/delete | `@portfolio/cli: LIST_OPTS, openDefaultStore, printItems`; `@portfolio/core: abbreviatePath, formatSlots, parseSlots, isItemType` | `store.categories.*`, `store.items.{getItem,setPathAndCategory}` |
| **pf-db** | path, status, init, schema, q/query, backup, vacuum, reindex, sqlite | `@portfolio/db: SCHEMA_PATH, openDatabase`; `@portfolio/cli: databasePath, openDefaultStore` | raw `portfolio.sqlite` — schema, arbitrary SQL, VACUUM INTO, WAL checkpoint, FTS rebuild; shells to `sqlite3` |
| **pf-docs** | add/import, push, links, tracked, rerender | `@portfolio/render: crawlMarkdown, renderMarkdown`; `@portfolio/core: documentTitle, isHtmlPath, isMarkdownPath, abbreviatePath`; `@portfolio/cli: client, openDefaultStore, itemUrl` | `store.items.*` directly (add) OR **the HTTP API** `POST /api/documents` via `PortfolioClient` (push) |
| **pf-watch** | ls/list, add, set, rm/remove, sync, scan, run | `@portfolio/watch: DirectoryWatcher, reconcile, scanDirectory`; `@portfolio/render: renderMarkdown`; `@portfolio/core: abbreviatePath, expandPath` | `store.watched.*`; long-running `run` holds an fs watcher open indefinitely |
| **pf-projects** | ls/list, scan, discover, `parents` child (ls/list, add, rm/remove) | `@portfolio/watch: discoverProjects, scanProjects, PROJECT_SCAN_DEPTH`; `@portfolio/cli: LIST_OPTS, openDefaultStore, printItems`; `@portfolio/core: abbreviatePath, expandPath` | `store.categories.categoryMembers`, `store.projects.*` |
| **pf-ports** | ls/list, tree, open, kill, which | `@portfolio/ports: findByPort, findPortEntry, killListener, portRows, portSiteUrl, portsScanBin, scanPorts`; `@portfolio/cli: projectRoot` | none in `portfolio.sqlite`; shells to `bin/ports-scan` (17KB script) to enumerate `lsof`-style TCP listener state, kills PIDs |
| **pf-server** | url, health, open, setup, start, stop, restart, status, logs, dev, api, items | `@portfolio/cli: client, projectRoot`; `@portfolio/client: defaultServer` | **launchd** (`launchctl bootstrap/bootout/kickstart/print`), `~/Library/LaunchAgents/<label>.plist`, log tailing, spawns `app.js`; HTTP calls to the running API |

`@portfolio/cli/src/index.ts` (shared helpers every tool above imports):
`projectRoot()`, `databasePath()`, `openDefaultStore()`, `client()`,
`LIST_OPTS`/`filterFromOpts`/`findItems`, `label()`, `printItems()`,
`pickItem()`, `itemUrl()`.

`packages/cli-kit/src/*` (the framework itself): `cli()`/`Cli` (dispatch,
prefix matching, external-bin discovery, help), `parseOptions`/`flag`/`option`
(argv parsing), `matchByPrefix` (prefix matcher), `table`/`json`/`pick`/
`pickOne`/`openDefault`/`editFiles`/`copyToClipboard`/`readStdin`/`confirm`/
`numberArg` (`io.ts`).

---

## 3. Target architecture

### 3.1 Where the Ruby code lives

```
proj/portfolio/
  bin/
    pf                 # Ruby dispatcher (was Bun); h-pf calls this, or is retired — see §6
    pf-add             # Ruby (was Bun)
    pf-cards           # Ruby
    pf-categories      # Ruby
    pf-db              # Ruby
    pf-detect          # Ruby
    pf-docs            # Ruby
    pf-items           # Ruby
    pf-portfolios      # Ruby
    pf-ports           # Ruby
    pf-projects        # Ruby
    pf-render          # Ruby
    pf-server          # Ruby
    pf-tags            # Ruby
    pf-watch           # Ruby
    h-pf               # unchanged: hiiro shim, still `exec bin/pf`
  lib/pf/              # NEW — shared Ruby helpers, analog of packages/cli + packages/cli-kit's
                        #        Portfolio-specific bits (io helpers are gem-level, see below)
    client.rb          #   PortfolioClient — HTTP client for 127.0.0.1:4388 (analog of @portfolio/client)
    list_opts.rb        #   LIST_OPTS, filterFromOpts, findItems, printItems, pickItem, label, itemUrl
    project.rb          #   projectRoot, databasePath (fallback only, see 3.2)
  test/pf/              # NEW — Minitest, hiiro test conventions (see §5)
```

Two structural questions this raises, decided as follows:

- **Gem inside the repo, or plain `lib/` dir?** Plain `lib/pf/*.rb` required by
  each `bin/pf-*` via `$LOAD_PATH`, **not** a packaged gem. `pf` is
  Portfolio-repo-local tooling, not something installed independently on other
  machines (unlike hiiro itself, which is `gem install`-able and used across
  many repos). A `Gemfile` at the repo root (or `apps/` — TBD, see open
  questions) pins `hiiro` and any DB gem (`sqlite3`/`sequel` if architecture
  option (b)/(c) is chosen).
- **`bin/` shims?** No separate shim layer needed — the `pf-*` files stay
  directly executable Ruby (`#!/usr/bin/env ruby`), exactly like hiiro's own
  `bin/h-*`. `bin/pf` becomes the dispatcher via `Hiiro.run(*ARGV,
  external_commands: false)`  that either (a) hand-rolls its own prefix
  dispatch identical to today's 3 subcommands, or (b) becomes a thin
  `Hiiro.run` shell that finds and `add_subcmd`s each `pf-*` script as a child —
  simplest is to keep `external_commands: true` (the default) so hiiro's own
  `Runners.all_bins` (`lib/hiiro.rb:617`) auto-discovers `pf-*` executables on
  `PATH`/`bin/`, exactly like `pf`'s current TS `externalBins()`
  (`packages/cli-kit/src/cli.ts:82`) does. This is a direct win: hiiro already
  implements the exact behavior cli-kit's `Cli` class re-implemented in
  TypeScript.

### 3.2 How Ruby reaches the data — (a) HTTP API vs (b) direct SQLite vs (c) mixed

The project's binding rule (`apps/desktop/CONTRACT.md` intro + the instruction
in this task): **"CLI parity: anything the app can do a pf-* command must also
do; new capability lands as an API route first."** This means `@portfolio/api`
(port 4388) is already the canonical place new capability is defined — the DB
repo layer (`packages/db/src/*.ts`) is an implementation detail behind it for
anything the desktop app also needs to do.

**Recommendation: (c) mixed, weighted toward (a) HTTP for anything the desktop
app also does; direct SQLite only for tools that are inherently
database-shaped and have no HTTP surface today.**

Reasoning:

| Option | Pros | Cons |
|---|---|---|
| (a) HTTP only | Parity is automatic — Ruby literally cannot drift from what the app can do, since it uses the same route. No schema duplication in Ruby. Works whether or not this machine has a local SQLite file mounted (e.g. driving Portfolio on a remote host later). | Requires the server running (`pf-server start`) for *every* command — today, most `pf-*` tools work standalone (`openDefaultStore()` opens the file directly) with no daemon. Adds latency + a new failure mode ("no database at ...", now "connection refused") for simple reads. `pf-db`'s raw-SQL `q`/`schema`/`vacuum`/`reindex`/`backup` have **no API route** and never should (they're maintenance ops on the file itself, not app capability) — HTTP-only is a non-starter for `pf-db`. |
| (b) direct SQLite only | No server dependency; fast; matches today's default `openDefaultStore()` behavior for read-heavy tools. | Every write path (`pf-add`, `pf-items rm`, `pf-cards add`, etc.) must reimplement the exact business rules already coded in `packages/db/src/*.ts` (`upsertItem`, `setPathAndCategory`, category/kind validation, `cardItems` query logic, tag normalization) in Ruby. That is real schema+logic duplication, and it is exactly the parity rule the project explicitly wants to avoid — a Ruby bug or missed validation branch could write data the app's own routes would reject. |
| (c) mixed | Per-tool judgment: use the API where a route exists and the tool's job matches what the app does (items/tags/cards/portfolios/categories/watch/projects/ports/documents), so identical validation and identical future feature additions apply to both. Use direct SQLite only for `pf-db` (which *is* the database maintenance tool, definitionally below the API layer) and `pf-render`/`pf-detect` (pure, no DB at all). `pf-server` is process control, no DB. | Two data-access code paths to maintain in Ruby (an `PortfolioClient`-style HTTP client, and a `pf-db`-only raw `sqlite3` connection) instead of one. Slightly more design work up front. |

(c) is recommended specifically because it turns the CLI-parity rule into an
enforced constraint rather than a discipline problem: any Ruby command that
maps to something the desktop app can also do (add an item, tag it, create a
portfolio card, watch a directory, kill a port listener) goes through
`/api/*`, so a new feature added to the API is *automatically* available to
the Ruby CLI with zero duplicated logic, and vice versa a Ruby-only feature
must land as a route first (satisfying the rule by construction, not by
reviewer vigilance). The two exceptions (`pf-db`, `pf-render`/`pf-detect`) are
principled: `pf-db` operates *on* the database file itself (schema, backup,
integrity) which is out of scope for an app-facing HTTP API by design, and
`pf-render`/`pf-detect` are pure functions with no data at all.

Concretely, in Ruby:

```ruby
# lib/pf/client.rb — the Ruby analog of packages/client
class Pf::Client
  BASE = ENV['PORTFOLIO_SERVER'] || 'http://127.0.0.1:4388'

  def get(path)  = request(:get, path)
  def post(path, body = {}) = request(:post, path, body)
  # ... uses Net::HTTP or `httpx`/`faraday` gem — TBD, open question
end
```

One nuance: several read-heavy tools (`pf items ls`, `pf tags ls`, `pf
categories ls`) currently work with **no server running** by opening
`portfolio.sqlite` read-only directly (`openDefaultStore({ readonly: true })`).
Going through HTTP for these would newly *require* `pf-server start` for basic
listing, which is a regression in standalone usability. Given the CLI-parity
rule is about *write/mutate* capability drifting from the app, not about
read-availability, this plan proposes: **reads may still go direct-to-SQLite
(read-only connection) for speed and no-daemon convenience; every write goes
through the API.** This mirrors what `pf-docs push` already does today (writes
via API) vs `pf-docs add` (writes direct — flagged below as a pre-existing
parity gap worth closing during the port, not introduced by it).

### 3.3 Ruby ↔ TypeScript schema coupling for reads

Since reads still touch `portfolio.sqlite` directly, Ruby needs to read (not
write) the same tables `packages/db/src/schema.sql` defines. This is a small,
well-contained duplication (SELECT-shaped queries only, no migrations, no
constraint logic) — acceptable because `pf-db schema` already exists as a live
source of truth to diff Ruby's expectations against in CI/tests (see §5).

---

## 4. Per-tool conversion sketches, simplest → riskiest

Order chosen by: pure functions first, then read-only DB tools, then
write-heavy DB tools, then process/OS-control tools last (riskiest).

### 4.1 `pf-detect` (pure, no DB, no HTTP) — simplest

```ruby
#!/usr/bin/env ruby
require 'hiiro'
require_relative '../lib/pf/detect' # port of @portfolio/core: detect()

Hiiro.run(*ARGV, external_commands: false) do
  add_flag :json, short: 'j', desc: 'print JSON (default when not a TTY)'
  add_flag :type, short: 't', desc: 'print only the type'

  add_default do |*args|
    raw = args.any? ? args.join(' ') : $stdin.read.chomp
    detected = Pf::Detect.call(raw)
    next puts detected.type if opts.type
    next puts JSON.generate(detected.to_h) if opts.json || !$stdout.tty?
    puts "#{detected.type.upcase}  #{detected.title}"
    puts "url:    #{detected.url}" if detected.url
    puts "path:   #{detected.path}#{detected.exists ? '' : '  (does not exist yet)'}" if detected.path
  end
end
```

### 4.2 `pf-render` (pure, shells to Pandoc) — simplest

Direct port of `bin/pf-render`; `pandoc_available?`/`pandoc_bin` become a small
`Pf::Pandoc` module (`system`/`` ` ` `` wrapped, injectable `Effects::Executor`
per §1.7 so tests don't require Pandoc installed).

```ruby
Hiiro.run(*ARGV, external_commands: false) do
  add_option :title,    short: 't'
  add_option :out,      short: 'o'
  add_flag   :toc,      default: true
  add_flag   :fragment, short: 'f'
  add_option :template
  add_flag   :open

  add_cmd :DEFAULT, args: %w[FILE], opts: %i[title out toc fragment template open] do
    # renderMarkdown/renderFragment port lives in lib/pf/render.rb
  end
  add_subcmd(:template) { puts Pf::Render::DEFAULT_TEMPLATE }
  add_subcmd(:check) { puts "#{Pf::Pandoc.bin}  #{Pf::Pandoc.available? ? 'ok' : 'MISSING'}"; exit(Pf::Pandoc.available? ? 0 : 1) }
end
```

### 4.3 `pf-db` — read/write raw SQLite, no HTTP by design

```ruby
require 'sqlite3' # or sequel — see open questions

Hiiro.run(*ARGV, external_commands: false) do
  add_subcmd(:path) { puts Pf::Project.database_path }
  add_subcmd(:status) { ... }              # file size + table row counts
  add_subcmd(:init) { ... }                # apply packages/db/src/schema.sql verbatim (shared file, not duplicated)
  add_subcmd(:schema) { |*args| ... }       # cat schema.sql, or --live introspection
  add_subcmd(:q, :query) { |*args| ... }    # raw SQL passthrough — same shape as today
  add_subcmd(:backup) { |*args| ... }       # VACUUM INTO
  add_subcmd(:vacuum) { ... }
  add_subcmd(:reindex) { ... }
  add_subcmd(:sqlite) { exec('sqlite3', Pf::Project.database_path) }
end
```

`init`/`schema` read `packages/db/src/schema.sql` directly off disk (single
source of truth, zero duplication) rather than a Ruby copy.

### 4.4 `pf-items`, `pf-tags`, `pf-cards`, `pf-portfolios`, `pf-categories`, `pf-projects`, `pf-docs`, `pf-watch` — the API-backed group

All eight follow one shape: reads hit SQLite read-only via a shared
`Pf::Store` (thin `sqlite3` wrapper exposing the same `list_items`/`get_item`
query shapes as `packages/db/src/items.ts` etc.), writes go through
`Pf::Client` to the matching `/api/*` route from `CONTRACT.md`.

```ruby
# bin/pf-tags (illustrative — full parity with all 6 pf-tags subcommands)
require 'hiiro'
require_relative '../lib/pf/store'
require_relative '../lib/pf/client'
require_relative '../lib/pf/list_opts'

Hiiro.run(*ARGV, external_commands: false) do
  add_subcmd(:ls, :list) do |*args|
    opts = Pf::ListOpts.parse(args)
    store = Pf::Store.open_readonly
    tags = store.list_tags
    puts opts.json? ? JSON.generate(tags) : Pf::Table.render(tags)
  end

  add_subcmd(:items, :show) do |*args|
    tag = args.shift or raise Hiiro::Error, 'tag name required'
    store = Pf::Store.open_readonly
    Pf::ListOpts.print_items(store.list_items(tag_name: tag), *args)
  end

  add_subcmd(:rename) do |old_name, new_name|
    raise Hiiro::Error, 'usage: pf-tags rename OLD NEW' unless old_name && new_name
    result = Pf::Client.new.post("/api/tags/#{old_name}/rename", name: new_name) # NEW route — see open questions
    puts "#{old_name} → #{new_name}"
  end

  # rm/prune/add: same pattern — mutate via Pf::Client, read via Pf::Store
end
```

**Flag for this group:** `CONTRACT.md` has **no `/api/tags/*` mutation routes
today** (rename/rm/prune/add-to-items are all direct-DB in the current
TypeScript `pf-tags`). Per the CLI-parity rule, these need new API routes
added *first* (a `packages/api` change, out of scope for this Ruby port) or
this plan explicitly carves out tag-mutation as a **documented, temporary
direct-SQLite exception** until routes exist. This is one of the open
questions in §7 — do not silently decide it.

Similarly: `pf-categories override`/`assign`/`unassign`/`slots`,
`pf-cards preview/query` (an unsaved, non-persisted "run this filter" — no
natural REST resource), and `pf-projects discover` (a dry-run scan, no
persistence) have no 1:1 API route either. Same flag applies.

### 4.5 `pf-add` — mixed, moderate risk

`pf-add` currently writes **directly** to SQLite (`store.items.upsertItem`,
`setPathAndCategory`, `setRenderedHtml`, `store.tags.setTags`) even though
`POST /api/quick` (`CONTRACT.md`) exists and does the same job for the desktop
app's quick-add box. This is the clearest case where the *existing* TypeScript
code already violates the stated CLI-parity spirit (two code paths building
the same kind of item). The Ruby port should route `pf-add` through
`POST /api/quick` unconditionally, closing this gap rather than reproducing
it — flagged for user sign-off since it changes existing behavior (see §7).

### 4.6 `pf-ports` — risky: shells to `bin/ports-scan` (a 17KB Python/bash-ish
scanner script), process/PID semantics, kill signals

```ruby
# lib/pf/ports.rb
module Pf::Ports
  SCAN_BIN = File.join(Pf.project_root, 'bin', 'ports-scan')

  def self.scan
    JSON.parse(`#{SCAN_BIN.shellescape}`, symbolize_names: true)
  rescue JSON::ParserError => e
    { error: e.message, ports: [] }
  end

  def self.kill(pid, signal: 'TERM')
    Process.kill(signal, pid)
    { ok: true, signal: signal, pid: pid }
  rescue Errno::ESRCH
    { ok: false, message: 'no such process' }
  end
end
```

`bin/ports-scan` itself is **not converted** — it stays as-is (it's the actual
OS-scanning script, language-agnostic to the CLI calling it); only the
`pf-ports` wrapper becomes Ruby. Risk: `killListener`
(`packages/ports/src/index.ts`, not read in full during this research pass —
flagged) may have safety checks (only kill processes matching the snapshot,
confirm pid still owns the port) that must be ported faithfully, not
re-derived from scratch, to avoid a Ruby version that kills the wrong PID.
**Action before implementing:** read `packages/ports/src/index.ts` in full
(this plan did not) to port `killListener`'s exact safety logic.

### 4.7 `pf-docs` — risky: Pandoc rendering + link-crawling + two write paths

`crawlMarkdown` (`packages/render/src/crawl.ts`) does recursive local-link
discovery across a directory tree — port faithfully (regex/AST link
extraction, cycle avoidance for `-r`) since a bug here means either infinite
recursion or silently missing linked docs. `add`/`import` should be
reconsidered as an API-backed path (`POST /api/items` per-file, batched) to
converge with `push` (which already goes through `POST /api/documents`) —
another pre-existing two-path situation like `pf-add`, flagged for the same
reason.

### 4.8 `pf-watch` — risky: long-running `run` subcommand holds an fs watcher

`DirectoryWatcher` (`packages/watch/src/watcher.ts`) needs a Ruby equivalent
using a file-system-events gem (`listen`, or Ruby's coarser `Dir.glob` polling
— TBD, open question, since Ruby has no built-in equivalent to Node's
`fs.watch`). This is squarely CLI-vs-app duplicate-logic risk: the desktop app
runs the same watcher in-process (`apps/desktop/CONTRACT.md`), so `pf-watch
run`'s reconcile logic (`reconcile()`, `packages/watch/src/reconcile.ts`) must
match exactly — recommend `pf-watch sync` (one-shot) be the priority Ruby
target, and `pf-watch run` (the daemon loop) be deprioritized or explicitly
kept as a TypeScript-only capability owned by the desktop app, since running a
second independent long-lived watcher process risks racing the app's own
watcher over the same DB rows. **Flagged as an open question**, not decided
here.

### 4.9 `pf-server` — riskiest: launchd management

```ruby
# bin/pf-server (illustrative)
LABEL  = "com.#{ENV['USER']}.portfolio"
DOMAIN = "gui/#{Process.uid}"
TARGET = "#{DOMAIN}/#{LABEL}"
PLIST  = File.join(Dir.home, 'Library/LaunchAgents', "#{LABEL}.plist")

Hiiro.run(*ARGV, external_commands: false) do
  add_subcmd(:start) { ... launchctl bootstrap/kickstart, same TARGET math ... }
  add_subcmd(:stop)  { ... }
  add_subcmd(:status){ ... }
  add_subcmd(:logs)  { |*args| exec('tail', *(args.include?('-f') ? ['-f'] : ['-n', '40']), *log_paths) }
  add_subcmd(:health){ puts JSON.generate(Pf::Client.new.get('/health')) }
end
```

Risk is entirely in **exact `launchctl` domain/target string reproduction**
(`gui/<uid>/<label>` — `process.getuid?.() ?? 501` in TS, `Process.uid` in
Ruby should match, but must be verified on the actual machine, not assumed)
and in **not double-managing the same LaunchAgent from two languages** during
the transition window (see §6 — only one implementation should ever call
`launchctl bootstrap` for this label at a time).

---

## 5. Testing strategy

### 5.1 Unit tests, hiiro conventions

- `test/pf/` mirrors hiiro's `test/hiiro/` + `test/bin/` split:
  - `test/pf/detect_test.rb`, `render_test.rb` — pure-function tests, no I/O,
    modeled on `test/hiiro/todo_test.rb:1-60`.
  - `test/pf/store_test.rb` — open a temp SQLite file seeded with known rows,
    assert `Pf::Store#list_items`/`#list_tags` etc. match expectations — same
    spirit as the in-memory-DB pattern in `test/test_helper.rb:8-9`, except
    against Portfolio's own schema (a temp file via `Dir.mktmpdir`, not
    `sqlite::memory:`, since `packages/db/src/schema.sql` is applied via
    `sqlite3 file.db < schema.sql`, simplest as a real temp file).
  - `test/pf/client_test.rb` — stub `Net::HTTP`/whatever HTTP gem is chosen
    (an `Effects::NullExecutor`-shaped double per §1.7, or `webmock`), assert
    `Pf::Client#post('/api/items', ...)` builds the right request; do not hit
    a real server in unit tests.
  - `test/pf/bin/pf_ports_test.rb`, `pf_server_test.rb` — inject
    `Pf::Effects::NullExecutor` (a `Hiiro::Effects::NullExecutor`-alike, reuse
    the gem's class directly via `Hiiro::Effects::NullExecutor.new` since it's
    generic, not hiiro-specific) so `launchctl`/`kill`/`ports-scan` calls are
    recorded, not executed — directly following `effects.rb:20-76`'s stated
    usage pattern.
- Apply the plan's own "Option B + Option A" (from `side-effect-separation-plan.md`,
  §1.7): write solid tests for `Pf::Store`, `Pf::Detect`, `Pf::Render`,
  `Pf::ListOpts` (the domain/model layer); accept thinner or absent tests for
  `pf-server`/`pf-ports` bin orchestration beyond the `NullExecutor` call-recording
  tests, rather than forcing full launchd/process integration tests.

### 5.2 Parity check: run old (Bun) and new (Ruby) side by side

A dedicated script, e.g. `bin/pf-parity-check` (bash), runs a fixed matrix of
read-only invocations against both binaries and diffs stdout:

```bash
#!/usr/bin/env bash
# bin/pf-parity-check — run each ARGV combination against both the Bun and
# Ruby builds of a pf-* tool and diff stdout. Exits non-zero on any diff.
set -euo pipefail
TOOL="$1"; shift
OLD="bin/${TOOL}.bun"   # old build kept under a suffix during transition, see §6
NEW="bin/${TOOL}"       # new Ruby build
diff <("$OLD" "$@") <("$NEW" "$@") && echo "OK: $TOOL $*"
```

Driven from a checked-in list of read-only command lines per tool (e.g.
`pf-items ls`, `pf-items count`, `pf-tags ls`, `pf-portfolios ls`, `pf-cards ls
1`, `pf-categories ls`, `pf-db status`, `pf-ports ls --json`, `pf-detect
https://example.com`) — write-mutating commands are excluded from automatic
parity checking (they'd double-write) and instead get manual before/after
comparison against a disposable copy of `portfolio.sqlite`
(`cp portfolio.sqlite /tmp/parity.sqlite && PORTFOLIO_DB=/tmp/parity.sqlite ...`
run against both builds, diff the resulting file's dumped rows).

---

## 6. Migration / rollout

1. **Keep both builds side by side** during conversion: rename the current Bun
   executables to `bin/pf-items.bun`, etc. (or move them to
   `bin/legacy-ts/pf-items`, TBD — open question) as each is ported, so `pf
   items` (hiiro's `Runners.all_bins` prefix match) always finds exactly one
   `pf-items` on `PATH`/`bin/` — **only one implementation may be named
   exactly `pf-<tool>` at a time**, since hiiro's exact-match dispatch has no
   concept of "two candidates, prefer Ruby."
2. Port order: §4's ordering (`pf-detect`, `pf-render` → `pf-db` → the
   API-backed group → `pf-add`/`pf-docs` → `pf-ports` → `pf-watch` →
   `pf-server` last).
3. After each tool's Ruby version passes its `test/pf/*_test.rb` suite and
   `bin/pf-parity-check <tool>` on the full read-only matrix, delete the `.bun`
   sibling and the corresponding TS source file, then update `docs/cli/<tool>.md`.
4. `bin/pf` (dispatcher) converts **last**, once every `pf-*` child is Ruby —
   until then it can keep working exactly as today (it's Bun, and shells out
   or discovers executables by name; it does not care what language a
   discovered `pf-<name>` binary is written in, since it just execs the path).
5. `h-pf` (`bin/h-pf`) needs **no change at all** — it already just
   `exec`s `bin/pf` regardless of what `bin/pf` is implemented in
   (`bin/h-pf:6,9`). Once `bin/pf` itself is Ruby, `h-pf` could additionally be
   simplified to skip the `exec` and instead directly compose `Hiiro.run` with
   `pf`'s command table (removing one process hop) — but this is an
   optimization, not required for correctness, and is listed as optional
   future work, not part of this migration's critical path.
6. `~/bin` shims: today only `h-docs`, `mdoc`, `ports-scan` are copied to
   `~/bin` by `bin/install` (`bin/install:16-20`) — **no `pf-*` tool is copied
   to `~/bin` today**; they're run from the repo's `bin/` directly (via `PATH`
   entry to the repo, presumably, or always `cd`'d into). This plan does not
   change that; `pf-server setup` (which calls `bin/install`) is unaffected by
   language choice, aside from `pf-server` itself being Ruby now.
7. Rollback: since old and new sit side by side under different filenames
   until a tool is confirmed, rollback for one tool is `mv bin/pf-x
   bin/pf-x.rb-broken && mv bin/pf-x.bun bin/pf-x` — no combined rollback
   needed across tools since each is switched independently.

---

## 7. Open questions (not decided by this plan — need the user)

1. **HTTP client gem for Ruby.** Net::HTTP (stdlib, no new dependency) vs.
   `faraday`/`httpx` (nicer API, one more Gemfile entry). Hiiro itself uses no
   HTTP gem anywhere in `lib/hiiro/*` to copy a convention from.
2. **SQLite gem for Ruby read paths.** Plain `sqlite3` gem (matches what
   `pf-db sqlite` already shells out to) vs. `sequel` (matches hiiro's own
   `Hiiro::DB` convention in `lib/hiiro/db.rb`, but pulls in a heavier
   dependency and an ORM-style model layer that may be overkill for read-only
   SELECT helpers). Not decided.
3. **Missing API routes for tag mutation (`rename`/`rm`/`prune`/`add`),
   category slot overrides/assign/unassign, and any other direct-DB write
   found in §4.4's "no 1:1 route" list.** Does the user want (a) new
   `packages/api` routes added first (proper CLI-parity fix, more work, out of
   this plan's stated scope of "convert pf/pf-* to Ruby"), or (b) an explicitly
   documented, temporary exception where Ruby writes directly to SQLite for
   these specific operations until routes exist? This plan does not choose.
4. **`pf-add` and `pf-docs add` currently bypass the API for writes that have
   an equivalent route (`POST /api/quick`, and document-creation logic close
   to `push`'s `POST /api/documents`).** Should the Ruby port close this gap
   (route everything through HTTP, changing today's behavior/dependency on a
   running server) or preserve today's direct-write behavior for parity with
   the *existing* tool rather than the *desktop app*? Flagged, not decided.
5. **`pf-watch run` (the long-running daemon subcommand).** Should this be
   ported to Ruby at all, given the desktop app already runs an equivalent
   watcher in-process, and two independent watchers writing to the same
   `portfolio.sqlite` rows risk races? Options: port it anyway (accept the
   race risk, document it), drop it from the Ruby CLI and document "use the
   app, or `pf-watch sync` on a cron/loop instead," or make watching
   API-brokered (the CLI asks the running server to watch, rather than
   watching itself). Not decided.
6. **`pf-ports kill` safety logic.** This plan did not read
   `packages/ports/src/index.ts`'s `killListener` implementation in full (only
   its call site in `bin/pf-ports`). Before implementing `pf-ports` in Ruby,
   that function's exact PID-ownership/safety checks need to be read and
   ported faithfully — is that acceptable to defer to implementation time, or
   does the user want it specified in this plan now?
7. **Where does the Ruby `Gemfile`/dependency boundary live?** Repo root
   (`/Users/unixsuperhero/proj/portfolio/Gemfile`), or nested under a `pf/` or
   `ruby/` subdirectory to keep the Bun workspace's root `package.json` and a
   Ruby `Gemfile` from visually colliding? Not decided.
8. **`bin/pf-x.bun` naming for the transition period (§6.1)** — is the
   `.bun`-suffix / `legacy-ts/` naming convention acceptable, or does the user
   have a preferred way to keep two implementations addressable side by side
   without hiiro's exact-match dispatch picking the wrong one?
9. **Does "convert ALL of bin/pf and the pf-* tools to Ruby" include
   `bin/ports-scan` and `bin/install`/`bin/mdoc`** (adjacent scripts in `bin/`
   that `pf-ports`/`pf-server` shell out to but that are not `pf-*`-named
   tools themselves)? This plan assumed **no** — those stay as-is, only the
   `pf`-prefixed wrapper tools convert — but the instruction's "ALL" wording
   makes this worth confirming explicitly.

---

## Verification of this plan

- File written to `/Users/unixsuperhero/proj/portfolio/docs/plans/pf-ruby-hiiro.md`.
- Every hiiro API name cited in §1 was grepped/read directly from
  `/Users/unixsuperhero/proj/hiiro` source (not from memory): `Hiiro.run`/`Hiiro.init`
  (`lib/hiiro.rb:129,72`), `add_cmd`/`add_subcmd`/`add_default`/`run_child`/`make_child`
  (`lib/hiiro.rb:360,325,321,258,238`), `Hiiro::Matcher` (`lib/hiiro/matcher.rb`),
  `Hiiro::Options`/`Options::Args`/`Options::Definition` (`lib/hiiro/options.rb`),
  `Hiiro::Config` (`lib/hiiro/config.rb`), `Hiiro::DB` (`lib/hiiro/db.rb`),
  `Hiiro::Effects::{Executor,NullExecutor,Filesystem,NullFilesystem}`
  (`lib/hiiro/effects.rb`), `Hiiro::TaskRecord`/`Sequel::Model` pattern
  (`lib/hiiro/task_record.rb`), `Hiiro::RegistryEntry.find_by_ref`
  (`lib/hiiro/registry.rb`), `hiiro.fuzzyfind`/`fuzzyfind_from_map`/
  `open_default`/`edit_files` (`lib/hiiro.rb:554,558,225,208`), plus the real
  `bin/h-pf`, `bin/h-todo`, `bin/h-branch` for structural precedent, and
  `test/test_helper.rb`, `test/hiiro/todo_test.rb` for testing conventions.
- Every `pf`/`pf-*` command in §2's inventory table was read directly from
  `bin/pf` and all 14 `bin/pf-*` files in this repo, plus
  `packages/cli-kit/src/{cli,matcher,options,io}.ts` and `packages/cli/src/index.ts`.
- `apps/desktop/CONTRACT.md`'s route table and `bin/install` were read to ground
  §3's architecture recommendation and §6's rollout plan.
- `packages/ports/src/index.ts` was **not** read in full — flagged as open
  question 6 rather than guessed at.
