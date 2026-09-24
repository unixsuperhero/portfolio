# pf-cards

Cards: saved queries inside portfolios.

## Synopsis

```bash
pf-cards <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `add`, `new` | `<PORTFOLIO> <TITLE>` | add a card to a portfolio |
| `edit`, `set` | `<CARD_ID> <TITLE...>` | change a card's title or query; only given options change |
| `ls`, `list` | `<PORTFOLIO>` | cards of a portfolio |
| `move` | `<CARD_ID> <left\|right>` | move a card earlier (left) or later (right) |
| `preview`, `query` |  | run an unsaved card query from options, without touching any portfolio |
| `rm`, `delete`, `remove` | `<CARD_ID>` | delete a card; items are kept |
| `show`, `run` | `<CARD_ID>` | run a card's query and list what it matches |

### add

Add a card to a portfolio.

```bash
pf-cards add <PORTFOLIO> <TITLE> [options]
```

Options:

```text
  -g, --tags <val>   comma-separated tags; an item matches with any one
  -t, --types <val>  comma-separated types to narrow to (document,note,link,pr,file,dir,task)
  -s, --sort <val>   created_at | updated_at | title | type
  -d, --dir <val>    asc | desc
  -m, --max <val>    max items, 1-1000
  -h, --help         Show this help
```

### edit

Change a card's title or query; only given options change.

```bash
pf-cards edit <CARD_ID> <TITLE...> [options]
```

Options:

```text
  -g, --tags <val>   comma-separated tags; an item matches with any one
  -t, --types <val>  comma-separated types to narrow to (document,note,link,pr,file,dir,task)
  -s, --sort <val>   created_at | updated_at | title | type
  -d, --dir <val>    asc | desc
  -m, --max <val>    max items, 1-1000
  -h, --help         Show this help
```

### ls

Cards of a portfolio.

```bash
pf-cards ls <PORTFOLIO> [options]
```

Options:

```text
  -j, --json  print JSON
  -h, --help  Show this help
```

### move

Move a card earlier (left) or later (right).

```bash
pf-cards move <CARD_ID> <left|right>
```

### preview

Run an unsaved card query from options, without touching any portfolio.

```bash
pf-cards preview [options]
```

Options:

```text
  -g, --tags <val>   comma-separated tags; an item matches with any one
  -t, --types <val>  comma-separated types to narrow to (document,note,link,pr,file,dir,task)
  -s, --sort <val>   created_at | updated_at | title | type
  -d, --dir <val>    asc | desc
  -m, --max <val>    max items, 1-1000
  -j, --json         print JSON
  -h, --help         Show this help
```

### rm

Delete a card; items are kept.

```bash
pf-cards rm <CARD_ID>
```

### show

Run a card's query and list what it matches.

```bash
pf-cards show <CARD_ID> [options]
```

Options:

```text
  -j, --json  print JSON
  -h, --help  Show this help
```

## Examples

```bash
pf-cards add YouTube 'Scripts' -g yt,slides -t document -s title -d asc
pf-cards ls YouTube
pf-cards show 3
pf-cards preview -g yt -t link,pr -m 5
pf-cards edit 3 -m 10
pf-cards move 3 left
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
