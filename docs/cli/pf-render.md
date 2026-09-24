# pf-render

Markdown to HTML with the document template.

## Synopsis

```bash
pf-render <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `check` |  | report the pandoc binary in use |
| `template` |  | print the path of the default document template |

### check

Report the pandoc binary in use.

```bash
pf-render check
```

### template

Print the path of the default document template.

```bash
pf-render template
```

## Default (no subcommand)

```bash
pf-render <FILE> [options]
```

Options:

```text
  -t, --title <val>     document title (default: first heading or file name)
  -o, --out <val>       write to this file instead of stdout
      --toc             table of contents (default)
  -f, --fragment        HTML fragment only, no template
      --template <val>  pandoc template path
      --open            open the written file
  -h, --help            Show this help
```

## Examples

```bash
pf-render README.md -o README.html --open
pf-render README.md > out.html
echo '**hi**' | pf-render - --fragment
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
