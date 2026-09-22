# pf-docs

Import and maintain tracked documents.

## Synopsis

```bash
pf-docs <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `add`, `import` | `<FILE...>` | import files into the database directly |
| `links` | `<FILE>` | local Markdown files a file links to, transitively |
| `push` | `<FILE...>` | import through the running server, like mdoc |
| `rerender` | `<ID...>` | re-render the HTML of Markdown documents from their stored content (or --from-disk) |
| `tracked` |  | documents with a tracked source file, and whether the file still exists |

### add

Import files into the database directly.

```bash
pf-docs add <FILE...> [options]
```

Options:

```text
  -r, --recursive    also import local Markdown linked from the roots
  -t, --title <val>  title for the first root
  -d, --desc <val>   description for the first root
      --toc          include a table of contents (default)
  -o, --open         open the roots afterwards
  -j, --json         print JSON
  -h, --help         Show this help
```

### links

Local Markdown files a file links to, transitively.

```bash
pf-docs links <FILE> [options]
```

Options:

```text
  -j, --json  print JSON
  -h, --help  Show this help
```

### push

Import through the running server, like mdoc.

```bash
pf-docs push <FILE...> [options]
```

Options:

```text
  -r, --recursive    also import local Markdown linked from the roots
  -t, --title <val>  title for the first root
  -d, --desc <val>   description for the first root
      --toc          include a table of contents (default)
  -o, --open         open the roots afterwards
  -j, --json         print JSON
  -h, --help         Show this help
```

### rerender

Re-render the HTML of Markdown documents from their stored content (or --from-disk).

```bash
pf-docs rerender <ID...> [options]
```

Options:

```text
      --disk  re-read the tracked source file first
  -a, --all   every Markdown-backed document
  -h, --help  Show this help
```

### tracked

Documents with a tracked source file, and whether the file still exists.

```bash
pf-docs tracked [options]
```

Options:

```text
  -j, --json     print JSON
  -m, --missing  only those whose source is gone
  -h, --help     Show this help
```

## Examples

```bash
pf-docs add -r docs/index.md
pf-docs push -r docs/index.md    # through the server, like mdoc
pf-docs links docs/index.md
pf-docs tracked --missing
pf-docs rerender --all --disk
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
