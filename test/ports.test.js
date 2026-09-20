import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "portfolio-ports-"));
const fixture = join(directory, "app");
let serverUrl;
let server;

const FIXTURE_SCAN = {
  scanned_at: "2026-09-20T00:00:00.000Z",
  herdr_available: true,
  warnings: [],
  ports: [
    {
      host: "127.0.0.1", port: 8123, proto: "TCP", command: "bun", pid: 1234,
      user: "tester", cwd: "/tmp/proj-a", ppid: 100, command_line: "bun run server.js",
      herdr: {
        workspace_id: "w1", workspace_label: "demo", tab_id: "w1:t1", pane_id: "w1:p1",
        agent: "codex", agent_status: "working", cwd: "/tmp/proj-a",
        foreground_cwd: "/tmp/proj-a", match: "process",
      },
      ai: { kind: "codex", session: "01a0dead-beef-0000-0000-000000000001", source: "herdr:codex" },
    },
    {
      host: "*", port: 8124, proto: "TCP", command: "python3", pid: 5678,
      user: "tester", cwd: "/tmp/other", ppid: 1, command_line: "python3 -m http.server 8124",
      herdr: null, ai: null,
    },
  ],
};

function mdoc(args) {
  return Bun.spawnSync({
    cmd: ["/bin/bash", "bin/mdoc", ...args],
    cwd: root,
    env: { ...process.env, MDOC_SERVER: serverUrl },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {}
    await Bun.sleep(25);
  }
  throw new Error("Portfolio did not start");
}

async function startServer(env) {
  const child = Bun.spawn({
    cmd: [process.execPath, "app.js"],
    cwd: fixture,
    env: { ...process.env, PORT: "0", PORTFOLIO_DB: join(directory, "portfolio.sqlite"), ...env },
    stdout: "pipe",
    stderr: "ignore",
  });
  const { value } = await child.stdout.getReader().read();
  const port = new TextDecoder().decode(value).match(/:(\d+)/)?.[1];
  if (!port) { child.kill(); throw new Error("Portfolio did not report a port"); }
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return { child, url };
}

beforeAll(async () => {
  await mkdir(join(fixture, "templates"), { recursive: true });
  await mkdir(join(fixture, "bin"), { recursive: true });
  await Promise.all([
    copyFile(join(root, "app.js"), join(fixture, "app.js")),
    copyFile(join(root, "schema.sql"), join(fixture, "schema.sql")),
    copyFile(join(root, "templates", "document.html"), join(fixture, "templates", "document.html")),
  ]);
  const scanner = join(fixture, "bin", "ports-scan");
  await writeFile(scanner, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(FIXTURE_SCAN)}\nEOF\n`);
  await Bun.$`chmod +x ${scanner}`.quiet();
  ({ child: server, url: serverUrl } = await startServer({ PORTS_SCAN_BIN: scanner }));
});

afterAll(async () => {
  server.kill();
  await rm(directory, { recursive: true, force: true });
});

test("api/ports returns scanner attribution shape", async () => {
  const snapshot = await (await fetch(`${serverUrl}/api/ports`)).json();
  expect(snapshot.herdr_available).toBe(true);
  expect(snapshot.ports).toHaveLength(2);
  const [first, second] = snapshot.ports;
  expect(first.port).toBe(8123);
  expect(first.cwd).toBe("/tmp/proj-a");
  expect(first.herdr.pane_id).toBe("w1:p1");
  expect(first.herdr.match).toBe("process");
  expect(first.ai.session).toContain("01a0dead");
  expect(second.herdr).toBeNull();
});

test("ports page renders listeners with pane and session", async () => {
  const response = await fetch(`${serverUrl}/ports`);
  expect(response.status).toBe(200);
  const page = await response.text();
  expect(page).toContain("8123");
  expect(page).toContain("w1:p1");
  expect(page).toContain("01a0dead");
  expect(page).toContain("/api/ports");
});

test("mdoc imports HTML files verbatim with title from <title>", async () => {
  const report = join(directory, "report.html");
  await writeFile(report, "<!doctype html><html><head><title>Test Report</title></head><body><p>hello-html</p></body></html>");
  const result = mdoc([report, "--no-open"]);
  expect(result.exitCode).toBe(0);
  const items = (await (await fetch(`${serverUrl}/api/items?limit=100`)).json()).items;
  const item = items.find(entry => entry.source_path === report);
  expect(item).toBeDefined();
  expect(item.title).toBe("Test Report");
  const full = await (await fetch(`${serverUrl}/api/items/${item.id}`)).json();
  expect(full.rendered_html).toContain("hello-html");
  const page = await (await fetch(`${serverUrl}${item.href}`)).text();
  expect(page).toContain("hello-html");
});

test("api/ports degrades gracefully when the scanner fails", async () => {
  const failing = await startServer({ PORTS_SCAN_BIN: "/bin/false" });
  try {
    const snapshot = await (await fetch(`${failing.url}/api/ports`)).json();
    expect(snapshot.ports).toHaveLength(0);
    expect(snapshot.error).toBeDefined();
    const page = await (await fetch(`${failing.url}/ports`)).text();
    expect(page).toContain("No listeners found");
  } finally {
    failing.child.kill();
  }
});
