# Ruby CLI helpers

`lib/pf.rb` loads hiiro and the shared helpers for `pf`, `h-pf`, and the 14
`pf-*` tools. Install the pinned dependencies with `bundle install`.

| Helper | Purpose |
|--------|---------|
| `Pf.run` | Hiiro command registration, prefix matching, options, and process exit codes |
| `Pf.project_root`, `Pf.database_path` | `PORTFOLIO_HOME` and `PORTFOLIO_DB`, with repository defaults |
| `Pf.store`, `Pf.writable_store` | Read-only or writable SQLite access; missing databases are errors |
| `Pf::Database.init!` | Create or migrate a database using `packages/db/src/schema.sql` |
| `Pf.client` | Ruby Net::HTTP client for the existing server |
| `Pf.add_list_options`, `Pf::LIST_OPTIONS` | Shared type, tag, pinned, starred, contents, limit, JSON, and full-output options |
| `Pf.find_items`, `Pf.pick_item`, `Pf.print_items` | Search, fuzzy selection, and item output |
| `Pf.label`, `Pf.item_url` | Item labels and absolute URLs |

Domain helpers in `lib/pf/` handle detection, Pandoc rendering and crawling,
collections, projects, watched directories, ports, and server operations.
Local mutations still write SQLite directly; they do not require a server.

A new tool:

```ruby
#!/usr/bin/env ruby
require_relative '../lib/pf'

Pf.run do
  Pf.add_list_options(self)
  add_cmd :ls, opts: Pf::LIST_OPTIONS do
    store = Pf.store
    Pf.print_items(store, Pf.find_items(store, opts.args, opts), opts)
  ensure
    store&.close
  end
end
```

Save it as `bin/pf-mine`, make it executable, and `pf mine ls` discovers it.

The TypeScript `@portfolio/cli` and `@portfolio/cli-kit` packages remain
unchanged for Bun consumers. The Ruby tools do not load them.

Back to the [index](../index.md).
