# pf-add

Quick add: paste a URL, a path, or text.

## Synopsis

```bash
pf-add [args] [options]
```

## Usage

```bash
pf-add <TEXT...> [options]
```

Options:

```text
  -t, --type <val>      override the detected type
  -g, --tags <val>      comma-separated tags
      --title <val>     override the title
  -c, --category <val>  category name for file/dir items
  -o, --open            open the new item afterwards
  -j, --json            print the created item as JSON
  -h, --help            Show this help
```

## Examples

```bash
pf-add https://github.com/x/y/pull/12 -g review
pf-add https://remotion.dev/docs -g yt
pf-add ~/proj/thing -g project -c project
pf-add ~/notes/plan.md -g docs
echo '# Idea' | pf-add - -g ideas -o
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
