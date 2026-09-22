# pf-server

The Portfolio service.

## Synopsis

```bash
pf-server <subcommand> [args] [options]
```

## Subcommands

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `api` | `<PATH>` | GET an API path and print the JSON |
| `dev` | `<PORT>` | run app.js in the foreground on PORT (default 4388) against the default database |
| `health` |  | GET /health |
| `items` | `<QUERY...>` | list items over HTTP (the same query params as /api/items) |
| `logs` |  | tail the service logs |
| `open` | `<PATH>` | open the library in the browser |
| `restart` |  | restart the LaunchAgent |
| `setup` |  | run bin/install (LaunchAgent, ~/bin copies of h-docs and mdoc) |
| `start` |  | start the LaunchAgent |
| `status` |  | launchctl print for the service |
| `stop` |  | stop the LaunchAgent |
| `url` |  | print the server URL in use |

### api

GET an API path and print the JSON.

```bash
pf-server api <PATH>
```

### dev

Run app.js in the foreground on PORT (default 4388) against the default database.

```bash
pf-server dev <PORT>
```

### health

GET /health.

```bash
pf-server health
```

### items

List items over HTTP (the same query params as /api/items).

```bash
pf-server items <QUERY...> [options]
```

Options:

```text
  -l, --limit <val>  limit
  -j, --json         JSON
  -h, --help         Show this help
```

### logs

Tail the service logs.

```bash
pf-server logs [options]
```

Options:

```text
  -f, --follow  keep following
  -h, --help    Show this help
```

### open

Open the library in the browser.

```bash
pf-server open <PATH>
```

### restart

Restart the LaunchAgent.

```bash
pf-server restart
```

### setup

Run bin/install (LaunchAgent, ~/bin copies of h-docs and mdoc).

```bash
pf-server setup
```

### start

Start the LaunchAgent.

```bash
pf-server start
```

### status

Launchctl print for the service.

```bash
pf-server status
```

### stop

Stop the LaunchAgent.

```bash
pf-server stop
```

### url

Print the server URL in use.

```bash
pf-server url
```

## Examples

```bash
pf-server health
pf-server restart
pf-server logs -f
pf-server items yt -l 5
pf-server api /api/portfolios/1
pf-server dev 4388
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
