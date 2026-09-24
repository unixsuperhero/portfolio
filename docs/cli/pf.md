# pf

Portfolio command line tools.

`pf`, `h-pf`, and all 14 `pf-*` commands use Ruby and the hiiro gem.
Install their dependencies with `bundle install` at the repository root.
Pandoc is required for Markdown rendering and imports. Bun is needed only for
the existing server and for optional comparisons against the former CLI.

Data commands keep their original direct SQLite behavior and work without a
running server. `pf-docs push` and the HTTP commands in `pf-server` still use
the existing server. The TypeScript backend and its API remain unchanged.

## Synopsis

```bash
pf <subcommand> [args] [options]
```

## Tools

| Tool | Runs |
|------|------|
| `pf add` | [pf-add](pf-add.md) |
| `pf cards` | [pf-cards](pf-cards.md) |
| `pf categories` | [pf-categories](pf-categories.md) |
| `pf db` | [pf-db](pf-db.md) |
| `pf detect` | [pf-detect](pf-detect.md) |
| `pf docs` | [pf-docs](pf-docs.md) |
| `pf items` | [pf-items](pf-items.md) |
| `pf portfolios` | [pf-portfolios](pf-portfolios.md) |
| `pf ports` | [pf-ports](pf-ports.md) |
| `pf projects` | [pf-projects](pf-projects.md) |
| `pf render` | [pf-render](pf-render.md) |
| `pf server` | [pf-server](pf-server.md) |
| `pf tags` | [pf-tags](pf-tags.md) |
| `pf watch` | [pf-watch](pf-watch.md) |

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `db-path` |  | print the database path |
| `root` |  | print the project root |
| `tools` |  | list the pf-* tools |

### db-path

Print the database path.

```bash
pf db-path
```

### root

Print the project root.

```bash
pf root
```

### tools

List the pf-* tools.

```bash
pf tools
```

## Examples

```bash
pf items ls yt              # same as pf-items ls yt
pf it ls                    # prefix matching, like hiiro
pf tools
```

## Environment

| Variable | Meaning |
|----------|---------|
| `PORTFOLIO_DB` | SQLite file to use (default `<project>/portfolio.sqlite`) |
| `PORTFOLIO_HOME` | project root (default: the parent of `bin/`) |
| `PORTFOLIO_SERVER` | server URL for commands that open pages or call the API (default `HDOCS_SERVER` or `http://127.0.0.1:4387`) |
| `PF_PICKER` | fuzzy picker binary (default `sk`, then `fzf`) |
| `PF_DEBUG` | legacy Bun setting; Hiiro includes backtraces for unexpected errors without it |

See also: [Ruby CLI helpers](../packages/cli.md) · [back to the index](../index.md)
