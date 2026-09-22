# pf-detect

Type detection for the quick-add box.

## Synopsis

```bash
pf-detect [args] [options]
```

## Usage

```bash
pf-detect <TEXT...> [options]
```

Options:

```text
  -j, --json  print JSON (default when not a TTY)
  -t, --type  print only the type
  -h, --help  Show this help
```

## Examples

```bash
pf-detect https://github.com/x/y/pull/12
pf-detect -t ~/proj/thing
echo '# Plan' | pf-detect
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
