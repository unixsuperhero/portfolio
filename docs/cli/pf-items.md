# pf-items

Items in the Portfolio database.

## Synopsis

```bash
pf-items <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `cat` | `<ID\|QUERY...>` | print an item's Markdown (or tracked source) |
| `count` |  | item counts by type |
| `export` | `<QUERY...>` | dump matching items as JSON lines, one item per line, with content |
| `ls`, `list`, `search` | `<QUERY...>` | list items; words search title and description |
| `open` | `<ID\|QUERY...>` | open the item in the browser (links and PRs go to their URL) |
| `path` | `<QUERY...>` | print the path of file/dir items and tracked sources |
| `pin` | `<ID...>` | pin items by id |
| `recent` | `<N>` | the newest N items (default 10) |
| `rm`, `delete`, `remove` | `<ID\|QUERY...>` | remove items from the database (never deletes source files unless --files) |
| `set` | `<ID> <FIELD> <VALUE...>` | set title, description, url, or type on an item |
| `show`, `get` | `<ID\|QUERY...>` | one item as JSON, with tags and resolved slots |
| `star` | `<ID...>` | star items by id |
| `tag` | `<ID> <TAGS>` | add comma-separated tags to an item |
| `toggle` | `<ID> <pinned\|starred>` | toggle pinned or starred on one item |
| `unpin` | `<ID...>` | unpin items by id |
| `unstar` | `<ID...>` | unstar items by id |
| `untag` | `<ID> <TAGS>` | remove comma-separated tags from an item |
| `vim`, `edit` | `<QUERY...>` | edit the tracked source files of matching items |

### cat

Print an item's Markdown (or tracked source).

```bash
pf-items cat <ID|QUERY...> [options]
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

### count

Item counts by type.

```bash
pf-items count
```

### export

Dump matching items as JSON lines, one item per line, with content.

```bash
pf-items export <QUERY...> [options]
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

List items; words search title and description.

```bash
pf-items ls <QUERY...> [options]
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

### open

Open the item in the browser (links and PRs go to their URL).

```bash
pf-items open <ID|QUERY...> [options]
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
  -a, --all          open every match
  -h, --help         Show this help
```

### path

Print the path of file/dir items and tracked sources.

```bash
pf-items path <QUERY...> [options]
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
      --copy         copy the first path to the clipboard
  -h, --help         Show this help
```

### pin

Pin items by id.

```bash
pf-items pin <ID...>
```

### recent

The newest N items (default 10).

```bash
pf-items recent <N> [options]
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

### rm

Remove items from the database (never deletes source files unless --files).

```bash
pf-items rm <ID|QUERY...> [options]
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
      --files        also delete the tracked source file
  -y, --yes          do not ask
  -h, --help         Show this help
```

### set

Set title, description, url, or type on an item.

```bash
pf-items set <ID> <FIELD> <VALUE...>
```

### show

One item as JSON, with tags and resolved slots.

```bash
pf-items show <ID|QUERY...> [options]
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

### star

Star items by id.

```bash
pf-items star <ID...>
```

### tag

Add comma-separated tags to an item.

```bash
pf-items tag <ID> <TAGS>
```

### toggle

Toggle pinned or starred on one item.

```bash
pf-items toggle <ID> <pinned|starred>
```

### unpin

Unpin items by id.

```bash
pf-items unpin <ID...>
```

### unstar

Unstar items by id.

```bash
pf-items unstar <ID...>
```

### untag

Remove comma-separated tags from an item.

```bash
pf-items untag <ID> <TAGS>
```

### vim

Edit the tracked source files of matching items.

```bash
pf-items vim <QUERY...> [options]
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

## Examples

```bash
pf-items ls -l 20
pf-items ls procedural -t document -f
pf-items recent 5 -j
pf-items show 42
pf-items open 42
pf-items tag 42 yt,slides
pf-items pin 42 43
pf-items rm 42 -y
pf-items export -g yt > yt.jsonl
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
