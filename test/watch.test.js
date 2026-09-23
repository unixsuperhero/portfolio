import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "portfolio-watch-"));
const fixture = join(directory, "app");
let serverUrl;
let server;

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await check();
    if (value) return value;
    await Bun.sleep(25);
  }
  throw new Error(message);
}

async function items() {
  return (await (await fetch(`${serverUrl}/api/items?limit=100`)).json()).items;
}

async function itemFor(path) {
  const summary = (await items()).find(item => item.source_path === path);
  return summary ? (await (await fetch(`${serverUrl}/api/items/${summary.id}`)).json()) : null;
}

beforeAll(async () => {
  await Promise.all([
    mkdir(join(fixture, "templates"), { recursive: true }),
    mkdir(join(fixture, "public"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(join(root, "app.js"), join(fixture, "app.js")),
    symlink(join(root, "packages"), join(fixture, "packages"), "dir"),
    copyFile(join(root, "tsconfig.json"), join(fixture, "tsconfig.json")),
    copyFile(join(root, "schema.sql"), join(fixture, "schema.sql")),
    copyFile(join(root, "templates", "document.html"), join(fixture, "templates", "document.html")),
    copyFile(join(root, "public", "app.css"), join(fixture, "public", "app.css")),
  ]);
  server = Bun.spawn({
    cmd: [process.execPath, "app.js"],
    cwd: fixture,
    env: {
      ...process.env,
      PORT: "0",
      PORTFOLIO_DB: join(directory, "portfolio.sqlite"),
      PORTFOLIO_WATCH_DEBOUNCE_MS: "20",
    },
    stdout: "pipe",
    stderr: "inherit",
  });
  const { value } = await server.stdout.getReader().read();
  const output = new TextDecoder().decode(value);
  const port = output.match(/:(\d+)/)?.[1];
  if (!port) throw new Error(`Portfolio did not report a port: ${output}`);
  serverUrl = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${serverUrl}/health`)).ok, "Portfolio did not start");
});

afterAll(async () => {
  server.kill();
  await rm(directory, { recursive: true, force: true });
});

test("pulls watched files and applies the recursive setting", async () => {
  const docs = join(directory, "docs");
  const top = join(docs, "top.md");
  const added = join(docs, "added.markdown");
  const nested = join(docs, "nested", "child.md");
  await mkdir(join(docs, "nested"), { recursive: true });
  await writeFile(top, "# Top\n\nFirst version.\n");
  await writeFile(nested, "# Child\n");

  const addResponse = await fetch(`${serverUrl}/settings/watched-directories`, {
    method: "POST",
    body: new URLSearchParams({ path: docs }),
  });
  expect(addResponse.ok).toBe(true);
  expect((await itemFor(top))?.content).toContain("First version");
  expect(await itemFor(nested)).toBeNull();

  await writeFile(top, "# Top\n\nUpdated from disk.\n");
  await waitFor(async () => (await itemFor(top))?.content.includes("Updated from disk"), "Watched edit was not pulled");

  await writeFile(added, "# Added\n");
  await waitFor(async () => itemFor(added), "New watched file was not pulled");

  const settings = await (await fetch(`${serverUrl}/api/settings`)).json();
  const watchId = settings.watched_directories[0].id;
  const recursiveResponse = await fetch(`${serverUrl}/settings/watched-directories/${watchId}`, {
    method: "POST",
    body: new URLSearchParams({ recursive: "on" }),
  });
  expect(recursiveResponse.ok).toBe(true);
  expect((await itemFor(nested))?.title).toBe("Child");

  await unlink(nested);
  await waitFor(async () => !(await itemFor(nested)), "Deleted watched file remained in Portfolio");

  const removeResponse = await fetch(`${serverUrl}/settings/watched-directories/${watchId}/delete`, { method: "POST" });
  expect(removeResponse.ok).toBe(true);
  expect(await itemFor(top)).toBeNull();
  expect(await itemFor(added)).toBeNull();
});

test("lists directories for the inline folder browser", async () => {
  const browseRoot = join(directory, "browse");
  await Promise.all([
    mkdir(join(browseRoot, "zeta"), { recursive: true }),
    mkdir(join(browseRoot, "Alpha"), { recursive: true }),
    writeFile(join(directory, "not-a-directory.txt"), "file"),
  ]);

  const response = await fetch(`${serverUrl}/api/settings/directories?${new URLSearchParams({ path: browseRoot })}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    path: browseRoot,
    parent: directory,
    directories: [
      { name: "Alpha", path: join(browseRoot, "Alpha") },
      { name: "zeta", path: join(browseRoot, "zeta") },
    ],
  });

  const relative = await fetch(`${serverUrl}/api/settings/directories?path=relative`);
  expect(relative.status).toBe(400);

  const file = await fetch(`${serverUrl}/api/settings/directories?${new URLSearchParams({ path: join(directory, "not-a-directory.txt") })}`);
  expect(file.status).toBe(422);
});


