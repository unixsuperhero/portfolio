# pf-tags

Tags in the Portfolio database.

## Synopsis

```bash
pf-tags <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `add` | `<TAG> <ID...>` | tag several items at once |
| `items`, `show` | `<TAG>` | items carrying a tag |
| `ls`, `list` |  | every tag with its item count |
| `prune` |  | delete tags that no item carries |
| `rename` | `<OLD> <NEW>` | rename a tag everywhere |
| `rm`, `remove` | `<TAG>` | remove a tag from every item |

### add

Tag several items at once.

```bash
pf-tags add <TAG> <ID...>
```

### items

Items carrying a tag.

```bash
pf-tags items <TAG> [options]
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

### ls

Every tag with its item count.

```bash
pf-tags ls [options]
```

Options:

```text
  -j, --json  print JSON
  -h, --help  Show this help
```

### prune

Delete tags that no item carries.

```bash
pf-tags prune
```

### rename

Rename a tag everywhere.

```bash
pf-tags rename <OLD> <NEW>
```

### rm

Remove a tag from every item.

```bash
pf-tags rm <TAG>
```

## Examples

```bash
pf-tags ls
pf-tags items yt -f
pf-tags rename yt youtube
pf-tags add review 41 42 43
pf-tags prune
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
