import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findByPort, findPortEntry, killListener, matchPortsToProjects, portRows, portSiteUrl, scanPorts } from "../src/index.ts";

const snapshot = { scanned_at: "t", herdr_available: false, warnings: [], ports: [
  { port: 4387, host: "127.0.0.1", command: "bun", pid: 100, cwd: "/p", herdr: { pane_id: "p1", workspace_label: "W", match: "cwd" }, ai: { kind: "claude", session: "abcdefgh-1234" } },
  { port: 3000, host: "::", command: "node", pid: 200, cwd: "/n" },
  { port: 3001, host: "::", command: "node", pid: 200, cwd: "/n" },
] };

test("urls, lookup, rows", () => {
  expect(portSiteUrl({ host: "*", port: 80 })).toBe("http://localhost:80");
  expect(portSiteUrl({ host: "fe80::1", port: 80 })).toBe("http://[fe80::1]:80");
  expect(portSiteUrl({ host: "10.0.0.2", port: 80 })).toBe("http://10.0.0.2:80");
  expect(findPortEntry(snapshot, 200, 3001)?.port).toBe(3001);
  expect(findPortEntry(snapshot, 200)?.port).toBe(3000);
  expect(findPortEntry(snapshot, 999)).toBeNull();
  expect(findByPort(snapshot, 4387)).toHaveLength(1);
  expect(portRows(snapshot)[0]).toMatchObject({ process: "bun #100", herdr: "W p1 ~", ai: "claude abcdefgh" });
});

test("kill guards", () => {
  expect(killListener(0)).toMatchObject({ status: 422 });
  expect(killListener(process.pid, { snapshot })).toMatchObject({ status: 403 });
  expect(killListener(999, { snapshot })).toMatchObject({ status: 404 });
  expect(killListener(5, { snapshot: { ...snapshot, ports: [], error: "boom" } })).toMatchObject({ status: 502 });
});

test("matchPortsToProjects picks the longest matching project path prefix", () => {
  const projects = [{ id: 1, path: "/p" }, { id: 2, path: "/p/sub" }, { id: 3, path: "/other" }];
  const matched = matchPortsToProjects({ ...snapshot, ports: [{ ...snapshot.ports[0], cwd: "/p/sub/app" }, { ...snapshot.ports[1], cwd: "/p" }, { ...snapshot.ports[2], cwd: "/elsewhere" }] }, projects);
  expect(matched[0].project).toEqual({ id: 2, path: "/p/sub" });
  expect(matched[1].project).toEqual({ id: 1, path: "/p" });
  expect(matched[2].project).toBeNull();
});

test("scanPorts reads a scanner script and survives failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "ports-"));
  const good = join(dir, "good");
  writeFileSync(good, `#!/bin/sh\necho '${JSON.stringify(snapshot)}'\n`);
  chmodSync(good, 0o755);
  expect(scanPorts(good).ports).toHaveLength(3);
  const bad = join(dir, "bad");
  writeFileSync(bad, "#!/bin/sh\necho nope >&2\nexit 3\n");
  chmodSync(bad, 0o755);
  expect(scanPorts(bad)).toMatchObject({ ports: [], error: "nope" });
  expect(scanPorts(join(dir, "missing")).error).toBeTruthy();
});
