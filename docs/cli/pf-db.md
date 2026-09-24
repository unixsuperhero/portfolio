# pf-db

The Portfolio SQLite database.

## Synopsis

```bash
pf-db <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `backup` | `<DEST>` | copy the database to DEST (or portfolio.sqlite.<timestamp>) using VACUUM INTO |
| `init` |  | create the database and apply the schema (safe to re-run) |
| `path` |  | print the database path |
| `q`, `query` | `<SQL...>` | run SQL (SELECT prints a table; anything else prints changes) |
| `reindex` |  | rebuild the full-text search index |
| `schema` |  | print schema.sql, or the live schema with --live |
| `sqlite` |  | open the database in the sqlite3 shell |
| `status` |  | file size, tables, and row counts |
| `vacuum` |  | VACUUM and checkpoint the WAL |

### backup

Copy the database to DEST (or portfolio.sqlite.<timestamp>) using VACUUM INTO.

```bash
pf-db backup <DEST>
```

### init

Create the database and apply the schema (safe to re-run).

```bash
pf-db init
```

### path

Print the database path.

```bash
pf-db path
```

### q

Run SQL (SELECT prints a table; anything else prints changes).

```bash
pf-db q <SQL...> [options]
```

Options:

```text
  -j, --json  print JSON
  -a, --all   no 50-row limit
  -h, --help  Show this help
```

### reindex

Rebuild the full-text search index.

```bash
pf-db reindex
```

### schema

Print schema.sql, or the live schema with --live.

```bash
pf-db schema [options]
```

Options:

```text
  -l, --live  read from the database instead of schema.sql
  -h, --help  Show this help
```

### sqlite

Open the database in the sqlite3 shell.

```bash
pf-db sqlite
```

### status

File size, tables, and row counts.

```bash
pf-db status
```

### vacuum

VACUUM and checkpoint the WAL.

```bash
pf-db vacuum
```

## Examples

```bash
pf-db status
pf-db q "select type, count(*) n from items group by type"
pf-db backup ~/backups/portfolio.sqlite
pf-db schema --live
pf-db reindex
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
