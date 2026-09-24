# pf-watch

Watched directories.

## Synopsis

```bash
pf-watch <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `add` | `<DIR>` | watch a directory and sync it now |
| `ls`, `list` |  | watched directories and how many documents each claims |
| `rm`, `remove` | `<ID>` | stop watching; documents no other watch covers are removed (files stay on disk) |
| `run` |  | stay running and re-sync on file changes (what the server does in-process) |
| `scan` | `<DIR>` | list the documents a directory would import, without touching the database |
| `set` | `<ID> <recursive\|flat>` | turn subdirectories on or off for a watch, then sync |
| `sync` |  | scan every watched directory once |

### add

Watch a directory and sync it now.

```bash
pf-watch add <DIR> [options]
```

Options:

```text
  -r, --recursive  include subdirectories
  -h, --help       Show this help
```

### ls

Watched directories and how many documents each claims.

```bash
pf-watch ls [options]
```

Options:

```text
  -j, --json  print JSON
  -h, --help  Show this help
```

### rm

Stop watching; documents no other watch covers are removed (files stay on disk).

```bash
pf-watch rm <ID>
```

### run

Stay running and re-sync on file changes (what the server does in-process).

```bash
pf-watch run
```

### scan

List the documents a directory would import, without touching the database.

```bash
pf-watch scan <DIR> [options]
```

Options:

```text
  -r, --recursive  include subdirectories
  -j, --json       print JSON
  -h, --help       Show this help
```

### set

Turn subdirectories on or off for a watch, then sync.

```bash
pf-watch set <ID> <recursive|flat>
```

### sync

Scan every watched directory once.

```bash
pf-watch sync
```

## Examples

```bash
pf-watch add ~/notes/docs -r
pf-watch scan ~/notes/docs -r
pf-watch sync
pf-watch set 1 flat
pf-watch run
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
