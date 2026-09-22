# @portfolio/ports

A typed wrapper around `bin/ports-scan` (the Python script that joins `lsof`, `ps`, and Herdr). It never throws from a scan; failures come back inside the snapshot.

```ts
import { scanPorts, findByPort, findPortEntry, portSiteUrl, killListener, portRows, matchPortsToProjects } from "@portfolio/ports";
```

| Function | Does |
|----------|------|
| `portsScanBin(root?)` | `PORTS_SCAN_BIN`, else `<root>/bin/ports-scan` |
| `scanPorts(bin?)` | runs the scanner; on any failure returns `{ ports: [], error }` |
| `portSiteUrl({ host, port })` | `http://localhost:PORT` for wildcard and loopback binds, bracketed IPv6 otherwise |
| `findPortEntry(snapshot, pid, port?)`, `findByPort(snapshot, port)` | lookups |
| `killListener(pid, { signal, snapshot, self })` | refuses pid ≤ 1 and this process, requires the pid to be a current listener, maps `ESRCH`/`EPERM` to 404/403; returns `{ ok, status, message }` |
| `portRows(snapshot)` | flat rows for a terminal table |
| `matchPortsToProjects(snapshot, projects)` | annotates each entry with `{ project: { id, path } \| null }` — the project whose path is the longest prefix of the entry's `cwd` (or equal to it) |

The types (`PortEntry`, `PortsSnapshot`, `HerdrPane`, `AiSession`, `TreeNode`) document the scanner's JSON; see the [data model](../data-model.md#ports-snapshot).

Tests: `packages/ports/test/ports.test.ts` (runs a fake scanner script). Back to the [index](../index.md).
