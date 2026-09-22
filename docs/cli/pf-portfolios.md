# pf-portfolios

Portfolios: pages of query cards.

## Synopsis

```bash
pf-portfolios <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `ls`, `list` |  | every portfolio with its card count |
| `new`, `add`, `create` | `<NAME> <DESCRIPTION...>` | create a portfolio |
| `open` | `<NAME\|ID>` | open the portfolio page in the browser |
| `rename` | `<NAME\|ID> <NEW_NAME>` | rename a portfolio or change its description |
| `rm`, `delete`, `remove` | `<NAME\|ID>` | delete a portfolio and its cards; items are kept |
| `show` | `<NAME\|ID>` | a portfolio with its cards and their matching items |

### ls

Every portfolio with its card count.

```bash
pf-portfolios ls [options]
```

Options:

```text
  -j, --json  print JSON
  -h, --help  Show this help
```

### new

Create a portfolio.

```bash
pf-portfolios new <NAME> <DESCRIPTION...>
```

### open

Open the portfolio page in the browser.

```bash
pf-portfolios open <NAME|ID>
```

### rename

Rename a portfolio or change its description.

```bash
pf-portfolios rename <NAME|ID> <NEW_NAME> [options]
```

Options:

```text
  -d, --description <val>  new description
  -h, --help               Show this help
```

### rm

Delete a portfolio and its cards; items are kept.

```bash
pf-portfolios rm <NAME|ID>
```

### show

A portfolio with its cards and their matching items.

```bash
pf-portfolios show <NAME|ID> [options]
```

Options:

```text
  -j, --json  print JSON, the same payload as /api/portfolios/:id
  -h, --help  Show this help
```

## Examples

```bash
pf-portfolios new YouTube 'everything for the channel'
pf-portfolios show YouTube
pf-portfolios show 1 -j   # same payload as GET /api/portfolios/1
pf-portfolios open YouTube
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
