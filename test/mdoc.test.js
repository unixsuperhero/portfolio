import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

test("combines recursive Markdown into standalone HTML with working cross-file links", async () => {
  const docs = join(directory, "docs");
  const alpha = join(docs, "alpha.md");
  const beta = join(docs, "sub", "Beta, file;name.md");
  const gamma = join(docs, "sub", "gamma.markdown");
  const other = join(docs, "other.md");
  await mkdir(join(docs, "sub"), { recursive: true });
  await writeFile(alpha, "# Alpha\n\n[beta](sub/Beta%2C%20file%3Bname.md?mode=full#part)\n\n[other](other.md)\n\n[gamma][g]\n\n![image](sub/image.png)\n\n<https://example.com/a.md>\n\n`[fake](sub/nope.md)`\n\n[g]: sub/gamma.markdown#section\n");
  await writeFile(beta, "# Beta\n\n[alpha](../alpha.md#top)\n\n## Part\n\nText.\n");
  await writeFile(gamma, "# Gamma\n");
  const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  await writeFile(join(docs, "sub", "image.png"), Buffer.from(image, "base64"));
  await writeFile(other, "# Other\n");
  const out = join(directory, "recursive.html");
  const count = (await items()).length;
  const first = mdoc(["-r", alpha, other, alpha, "--out", out, "--no-open"]);
  expect(first.stderr.toString()).toBe("");
  expect(first.exitCode).toBe(0);
  const html = await readFile(out, "utf8");
  expect(html).toContain('href="https://example.com/a.md"');
  expect(html).toContain('src="data:image/png;base64,' + image + '"');
  expect(html).toContain('href="#mdoc-3-part"');
  expect(html).toContain('href="#mdoc-2-other"');
  expect(html).toContain('href="#mdoc-1-alpha"');
  expect(html).toContain('href="#mdoc-4-gamma"');
  expect(html.match(/<h1\b[^>]*>[^<]*<\/h1>/g)).toEqual([
    '<h1 id="mdoc-1-alpha">Alpha</h1>', '<h1 id="mdoc-2-other">Other</h1>',
    '<h1 id="mdoc-3-beta">Beta</h1>', '<h1 id="mdoc-4-gamma">Gamma</h1>',
  ]);
  expect((await items())).toHaveLength(count + 1);
  const saved = first.stdout.toString().split("\n").find(line => line.startsWith("mdoc: saved ")).slice(12);
  const served = await fetch(saved, { redirect: "manual" });
  expect(served.status).toBe(200);
  expect(await served.text()).toContain('<h1 id="mdoc-4-gamma">Gamma</h1>');
  expect((await itemFor(out)).rendered_html).toBe(html);
  const refused = mdoc(["-r", alpha, "--out", out, "--no-open"]);
  expect(refused.exitCode).not.toBe(0);
  expect(refused.stderr.toString()).toContain("output file already exists");
  expect(await readFile(out, "utf8")).toBe(html);
  expect((await items())).toHaveLength(count + 1);
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

test("combines inputs in argument order with scoped headings, images, and stdin", async () => {
  const one = join(directory, "docs", "z-one.md");
  const two = join(directory, "docs", "sub", "a-two.md");
  await writeFile(one, "# Shared\n\nFIRST\n\n[two](sub/a-two.md)\n\n[Two setup](sub/a-two.md#Setup)\n\n[self](#shared)\n\n![first](sub/image.png)\n");
  await writeFile(two, "# Shared\n\nSECOND\n\n## Setup\n\n![second](image.png)\n");
  const count = (await items()).length;
  const result = mdoc([one, two, "--no-open"]);
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const output = labeledPath(result.stdout.toString(), "html");
  const html = await readFile(output, "utf8");
  expect(html).toContain('href="#mdoc-2-shared"');
  expect(html).toContain('href="#mdoc-2-setup"');
  expect(html).toContain('href="#mdoc-1-shared"');
  expect(html.indexOf("FIRST")).toBeLessThan(html.indexOf("SECOND"));
  expect(html.match(/<h1\b[^>]*>[^<]*<\/h1>/g)).toEqual([
    '<h1 id="mdoc-1-shared">Shared</h1>', '<h1 id="mdoc-2-shared">Shared</h1>',
  ]);
  expect(html).toContain('id="TOC"');
  expect([...html.matchAll(/<img\b[^>]*src="([^"]*)"/g)].map(match => match[1].startsWith("data:image/png;base64,"))).toEqual([true, true]);
  expect((await items())).toHaveLength(count + 1);
  const piped = mdoc([one, "-", "--no-toc", "--no-open"], "# Piped second\n\nFROM-STDIN\n");
  expect(piped.exitCode).toBe(0);
  const pipedOutput = labeledPath(piped.stdout.toString(), "html");
  const pipedHtml = await readFile(pipedOutput, "utf8");
  expect(pipedHtml).toContain("FROM-STDIN");
  expect(pipedHtml.indexOf("FIRST")).toBeLessThan(pipedHtml.indexOf("FROM-STDIN"));
  expect(pipedHtml).not.toContain('id="TOC"');
  await rm(output);
  await rm(pipedOutput);
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
