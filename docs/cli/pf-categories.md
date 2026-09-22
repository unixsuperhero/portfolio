# pf-categories

Categories and slots.

## Synopsis

```bash
pf-categories <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `add`, `new` | `<NAME>` | create a category |
| `assign` | `<ITEM_ID> <CATEGORY>` | put an item in a category (its type must match the category kind) |
| `edit`, `set` | `<CATEGORY> <NEW_NAME>` | rename a category, change its kind (only while empty), or replace its slots |
| `items`, `members` | `<CATEGORY>` | items in a category |
| `ls`, `list` |  | categories with member counts and slots |
| `override` | `<ITEM_ID> <SLOT> <PATH>` | give one member a different path for a slot; empty PATH clears it |
| `rm`, `delete`, `remove` | `<CATEGORY>` | delete a category; members are kept without one |
| `slots` | `<ITEM_ID>` | resolved slots of one member: path, exists, overridden |
| `unassign` | `<ITEM_ID>` | take an item out of its category |

### add

Create a category.

```bash
pf-categories add <NAME> [options]
```

Options:

```text
  -s, --slots <val>  slots, one per line: name | file or dir | path
  -k, --kind <val>   kind of item (dir, file, document, note, link, pr)
  -h, --help         Show this help
```

### assign

Put an item in a category (its type must match the category kind).

```bash
pf-categories assign <ITEM_ID> <CATEGORY>
```

### edit

Rename a category, change its kind (only while empty), or replace its slots.

```bash
pf-categories edit <CATEGORY> <NEW_NAME> [options]
```

Options:

```text
  -s, --slots <val>  slots, one per line: name | file or dir | path
  -k, --kind <val>   kind of item (dir, file, document, note, link, pr)
  -h, --help         Show this help
```

### items

Items in a category.

```bash
pf-categories items <CATEGORY> [options]
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

Categories with member counts and slots.

```bash
pf-categories ls [options]
```

Options:

```text
  -j, --json  print JSON
  -h, --help  Show this help
```

### override

Give one member a different path for a slot; empty PATH clears it.

```bash
pf-categories override <ITEM_ID> <SLOT> <PATH>
```

### rm

Delete a category; members are kept without one.

```bash
pf-categories rm <CATEGORY>
```

### slots

Resolved slots of one member: path, exists, overridden.

```bash
pf-categories slots <ITEM_ID> [options]
```

Options:

```text
  -j, --json  print JSON
  -h, --help  Show this help
```

### unassign

Take an item out of its category.

```bash
pf-categories unassign <ITEM_ID>
```

## Examples

```bash
pf-categories add project -k dir -s $'tasks | file | TASKS.md\nlogs | dir | ~/Library/Logs/x'
pf-categories assign 393 project
pf-categories slots 393
pf-categories override 393 tasks ~/other/TASKS.md
pf-categories items project -f
```

## Environment

| Variable | Meaning |
|----------|---------|
| `PORTFOLIO_DB` | SQLite file to use (default `<project>/portfolio.sqlite`) |
| `PORTFOLIO_HOME` | project root (default: the parent of `bin/`) |
| `PORTFOLIO_SERVER` | server URL for commands that open pages or call the API (default `HDOCS_SERVER` or `http://127.0.0.1:4387`) |
| `PF_PICKER` | fuzzy picker binary (default `sk`, then `fzf`) |
| `PF_DEBUG` | print stack traces on errors |

See also: [the pf toolbox](pf.md) · [cli-kit, the framework these are built on](../packages/cli-kit.md) · [back to the index](../index.md)
