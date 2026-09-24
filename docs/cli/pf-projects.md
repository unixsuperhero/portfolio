# pf-projects

Project discovery.

## Synopsis

```bash
pf-projects <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `discover` | `<DIR>` | show what a scan of DIR would find, without touching the database |
| `ls`, `list` | `<QUERY...>` | project items (dir items in the project category) |
| `parents` | `<SUBCOMMAND>` | parent directories that get scanned |
| `scan` |  | scan every parent and add new projects (never removes) |

### discover

Show what a scan of DIR would find, without touching the database.

```bash
pf-projects discover <DIR> [options]
```

Options:

```text
  -d, --depth <val>  levels to walk (default 4)
  -j, --json         print JSON
  -h, --help         Show this help
```

### ls

Project items (dir items in the project category).

```bash
pf-projects ls <QUERY...> [options]
```

Options:

```text
  -t, --type <val>   only this item type
  -g, --tag <val>    only items with this tag name
  -p, --pinned       pinned only
  -s, --starred      starred only
  -c, --contents     search inside contents too
  -l, --limit <val>  at most N items
  -j, --json         print JSON
  -f, --full         show paths and urls
  -h, --help         Show this help
```

### parents

Parent directories that get scanned.

```bash

```

### scan

Scan every parent and add new projects (never removes).

```bash
pf-projects scan
```

## Examples

```bash
pf-projects parents add ~/proj
pf-projects scan
pf-projects ls -f
pf-projects discover ~/work -d 2
```

## Environment

| Variable | Meaning |
|----------|---------|
| `PORTFOLIO_DB` | SQLite file to use (default `<project>/portfolio.sqlite`) |
| `PORTFOLIO_HOME` | project root (default: the parent of `bin/`) |
| `PORTFOLIO_SERVER` | server URL for commands that open pages or call the API (default `HDOCS_SERVER` or `http://127.0.0.1:4387`) |
| `PF_PICKER` | fuzzy picker binary (default `sk`, then `fzf`) |
| `PF_DEBUG` | legacy Bun setting; Hiiro includes backtraces for unexpected errors without it |

See also: [the pf toolbox](pf.md) · [Ruby CLI helpers](../packages/cli.md) · [back to the index](../index.md)
