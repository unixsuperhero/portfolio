import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "portfolio-mdoc-"));
const fixture = join(directory, "app");
let serverUrl;
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${serverUrl}/health`)).ok) return;
    } catch {}
    await Bun.sleep(25);
  }
  throw new Error("Portfolio did not start");
}

function mdoc(args, input) {
  return Bun.spawnSync({
    cmd: ["/bin/bash", "bin/mdoc", ...args],
    cwd: root,
    env: { ...process.env, MDOC_SERVER: serverUrl },
    stdin: input === undefined ? undefined : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function items() {
  return (await (await fetch(`${serverUrl}/api/items?limit=100`)).json()).items;
}

async function itemFor(path) {
  const item = (await items()).find(item => item.source_path === path);
  return (await (await fetch(`${serverUrl}/api/items/${item.id}`)).json());
}

function labeledPath(stdout, label) {
  const line = stdout.split("\n").find(entry => entry.startsWith(`mdoc: ${label} `));
  return line.slice(`mdoc: ${label} `.length);
}

async function unresolvedHrefs(site) {
  const bad = [];
  for (const name of (await readdir(site)).filter(name => name.endsWith(".html"))) {
    const text = await readFile(join(site, name), "utf8");
    for (const match of text.matchAll(/href="([^"]*)"/g)) {
      const href = match[1];
      if (href.includes("index.html") || href.includes(".html")) continue;
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) continue;
      bad.push(`${name} ${href}`);
    }
  }
  return bad;
}

beforeAll(async () => {
  await mkdir(join(fixture, "templates"), { recursive: true });
  await Promise.all([
    copyFile(join(root, "app.js"), join(fixture, "app.js")),
    symlink(join(root, "packages"), join(fixture, "packages"), "dir"),
    copyFile(join(root, "tsconfig.json"), join(fixture, "tsconfig.json")),
    copyFile(join(root, "schema.sql"), join(fixture, "schema.sql")),
    copyFile(join(root, "templates", "document.html"), join(fixture, "templates", "document.html")),
    copyFile(join(root, "templates", "external-images.lua"), join(fixture, "templates", "external-images.lua")),
  ]);
  server = Bun.spawn({
    cmd: [process.execPath, "app.js"],
    cwd: fixture,
    env: { ...process.env, PORT: "0", PORTFOLIO_DB: join(directory, "portfolio.sqlite") },
    stdout: "pipe",
    stderr: "ignore",
  });
  const { value } = await server.stdout.getReader().read();
  const output = new TextDecoder().decode(value);
  const port = output.match(/:(\d+)/)?.[1];
  if (!port) throw new Error(`Portfolio did not report a port: ${output}`);
  serverUrl = `http://127.0.0.1:${port}`;
  await waitForServer();
});

afterAll(async () => {
  server.kill();
  await rm(directory, { recursive: true, force: true });
});

test("builds a chunked site for recursive Markdown and resolves cross-file links", async () => {
  const docs = join(directory, "docs");
  const alpha = join(docs, "alpha.md");
  const beta = join(docs, "sub", "Beta, file;name.md");
  const gamma = join(docs, "sub", "gamma.markdown");
  const other = join(docs, "other.md");
  const alphaContent = "# Alpha\n\n[beta](sub/Beta%2C%20file%3Bname.md?mode=full#part)\n\n[other](other.md)\n\n[gamma][g]\n\n![image](sub/image.md)\n\n<https://example.com/a.md>\n\n`[fake](sub/nope.md)`\n\n[g]: sub/gamma.markdown#section\n";
  await mkdir(join(docs, "sub"), { recursive: true });
  await writeFile(alpha, alphaContent);
  await writeFile(beta, "# Beta\n\n[alpha](../alpha.md#top)\n\n## Part\n\nText.\n");
  await writeFile(gamma, "# Gamma\n");
  await writeFile(join(docs, "sub", "image.md"), "image\n");
  await writeFile(other, "# Other\n");

  const first = mdoc(["-r", alpha, other, alpha, "--no-open"]);
  expect(first.exitCode).toBe(0);
  expect(first.stderr.toString()).toBe("");
  const site = labeledPath(first.stdout.toString(), "site");
  const build = labeledPath(first.stdout.toString(), "build");
  expect(await unresolvedHrefs(site)).toEqual([]);
  expect((await readdir(build)).includes("src")).toBe(true);
  const pages = (await Promise.all((await readdir(site)).filter(name => name.endsWith(".html")).map(async name => readFile(join(site, name), "utf8")))).join("\n");
  expect(pages).toContain('href="https://example.com/a.md"');
  expect(pages).toContain('src="sub/image.md"');
  expect(pages).toMatch(/href="[^"]*beta-file[^"]*\.html/);
  expect(pages).toMatch(/href="[^"]*other\.md__other\.html"/);
  expect(pages).not.toContain('href="#other.md"');
  expect(pages).not.toContain("../alpha.md");
  expect((await items())).toHaveLength(0);

  const occupied = join(directory, "occupied-site");
  await mkdir(occupied);
  const refused = mdoc(["-r", alpha, "--out", occupied, "--no-open"]);
  expect(refused.exitCode).not.toBe(0);
  expect(refused.stderr.toString()).toContain("output directory already exists");
  expect((await items())).toHaveLength(0);
});

test("fails a recursive batch before it uploads missing linked Markdown", async () => {
  const bad = join(directory, "docs", "bad.md");
  await writeFile(bad, "# Bad\n\n[missing](missing.md)\n");
  const count = (await items()).length;
  const result = mdoc(["-r", bad, "--no-open"]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("linked Markdown not found");
  expect((await items())).toHaveLength(count);
});

test("builds a chunked site for several Markdown files without -r", async () => {
  const one = join(directory, "docs", "plain-one.md");
  const two = join(directory, "docs", "plain-two.md");
  await writeFile(one, "# One\n\n[two](plain-two.md)\n\n[Two setup](plain-two.md#Setup)\n");
  await writeFile(two, "# Two\n\n## Setup\n\nText.\n");
  const count = (await items()).length;
  const result = mdoc([one, two, "--no-open"]);
  expect(result.exitCode).toBe(0);
  const site = labeledPath(result.stdout.toString(), "site");
  expect(await unresolvedHrefs(site)).toEqual([]);
  const pages = (await Promise.all((await readdir(site)).filter(name => name.endsWith(".html")).map(async name => readFile(join(site, name), "utf8")))).join("\n");
  expect(pages).toMatch(/href="[^"]*plain-two\.md__two\.html"/);
  expect(pages).toMatch(/href="[^"]*plain-two\.md__two\.html#plain-two\.md__setup"/);
  expect((await items())).toHaveLength(count);
});

test("rolls back a server document when Pandoc cannot render it", async () => {
  const kept = join(directory, "docs", "kept.md");
  const broken = join(directory, "docs", "broken.md");
  const template = join(fixture, "templates", "document.html");
  const originalTemplate = await readFile(template, "utf8");
  await writeFile(kept, "# Kept\n");
  await writeFile(broken, "# Broken\n");
  const saved = mdoc([kept, "--no-open"]);
  expect(saved.exitCode).toBe(0);
  const keptItem = await itemFor(kept);
  const count = (await items()).length;
  await writeFile(template, "$if(");
  let result;
  try {
    result = mdoc([broken, "--no-open"]);
  } finally {
    await writeFile(template, originalTemplate);
  }
  expect(result.exitCode).not.toBe(0);
  expect((await items())).toHaveLength(count);
  expect((await itemFor(kept)).content).toBe(keptItem.content);
  expect((await itemFor(kept)).rendered_html).toBe(keptItem.rendered_html);
});

test("accepts stdin as a normal nonrecursive document", async () => {
  const result = mdoc(["-", "--title", "Piped", "--no-open"], "# From stdin\n");
  expect(result.exitCode).toBe(0);
  expect((await items()).some(item => item.title === "Piped")).toBe(true);
});

test("accepts an empty Markdown file", async () => {
  const empty = join(directory, "docs", "empty.md");
  await writeFile(empty, "");
  const result = mdoc([empty, "--no-open"]);
  expect(result.exitCode).toBe(0);
  expect((await itemFor(empty)).content).toBe("");
});
