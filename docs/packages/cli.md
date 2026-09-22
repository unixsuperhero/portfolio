# @portfolio/cli

The few helpers every `pf-*` tool shares, so each tool file stays a list of commands.

| Export | Does |
|--------|------|
| `projectRoot()` | `PORTFOLIO_HOME`, else the parent of the `bin/` directory the script runs from |
| `databasePath()` | `PORTFOLIO_DB`, else `<root>/portfolio.sqlite` |
| `openDefaultStore({ create, readonly })` | opens the store; a missing file is a clear error unless `create` |
| `client()` | a `PortfolioClient` for `PORTFOLIO_SERVER` |
| `LIST_OPTS` | the shared listing options: `-t type`, `-g tag`, `-p pinned`, `-s starred`, `-c contents`, `-l limit`, `-j json`, `-f full` |
| `filterFromOpts(args, opts)`, `findItems(store, args, opts)` | words become the search, options become the filter |
| `printItems(store, items, opts, out)` | labels, a table (`-f`), or JSON (`-j`) |
| `pickItem(store, args, opts)` | one item by numeric id, or a fuzzy pick among matches |
| `label(item)` | `Title [type #id]`, the same label `h-docs` prints |
| `itemUrl(item)` | absolute URL to open |

A new tool is:

```ts
#!/usr/bin/env bun
import { cli } from "@portfolio/cli-kit";
import { LIST_OPTS, findItems, openDefaultStore, printItems } from "@portfolio/cli";

cli("pf-mine", c => {
  c.cmd("ls", { desc: "my listing", args: ["QUERY..."], opts: LIST_OPTS }, ({ args, opts, out }) => {
    const store = openDefaultStore({ readonly: true });
    printItems(store, findItems(store, args, opts), opts, out);
  });
}, { desc: "my tool" }).run();
```

Save it as `bin/pf-mine`, `chmod +x`, and `pf mine ls` works.

Back to the [index](../index.md).
