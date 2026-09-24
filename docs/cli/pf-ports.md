# pf-ports

Local TCP listeners.

## Synopsis

```bash
pf-ports <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `kill` | `<PORT>` | SIGTERM (or --kill for SIGKILL) the listener on PORT or with --pid |
| `ls`, `list` |  | every TCP listener |
| `open` | `<PORT>` | open http://localhost:PORT |
| `tree` | `<PORT>` | ancestors and children of the process listening on PORT |
| `which` |  | print the scanner script in use |

### kill

SIGTERM (or --kill for SIGKILL) the listener on PORT or with --pid.

```bash
pf-ports kill <PORT> [options]
```

Options:

```text
      --pid <val>  kill by pid instead
  -9, --kill       send SIGKILL
  -h, --help       Show this help
```

### ls

Every TCP listener.

```bash
pf-ports ls [options]
```

Options:

```text
  -j, --json        print the scanner JSON
  -p, --port <val>  only this port
  -h, --help        Show this help
```

### open

Open http://localhost:PORT.

```bash
pf-ports open <PORT>
```

### tree

Ancestors and children of the process listening on PORT.

```bash
pf-ports tree <PORT>
```

### which

Print the scanner script in use.

```bash
pf-ports which
```

## Examples

```bash
pf-ports ls
pf-ports ls -p 4387
pf-ports tree 4387
pf-ports kill 3000
pf-ports kill --pid 1234 -9
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
