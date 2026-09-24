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

test("imports recursive batches, preserves raw Markdown, and rewrites Pandoc links", async () => {
  const docs = join(directory, "docs");
  const alpha = join(docs, "alpha.md");
  const beta = join(docs, "sub", "Beta, file;name.md");
  const gamma = join(docs, "sub", "gamma.markdown");
  const other = join(docs, "other.md");
  const alphaContent = "# Alpha\n\n[beta](sub/Beta%2C%20file%3Bname.md?mode=full#part)\n\n[gamma][g]\n\n![image](sub/image.md)\n\n<https://example.com/a.md>\n\n`[fake](sub/nope.md)`\n\n[g]: sub/gamma.markdown#section\n";
  await mkdir(join(docs, "sub"), { recursive: true });
  await writeFile(alpha, alphaContent);
  await writeFile(beta, "# Beta\n\n[alpha](../alpha.md#top)\n");
  await writeFile(gamma, "# Gamma\n");
  await writeFile(other, "# Other\n");

  const first = mdoc(["-r", alpha, other, alpha, "--no-open"]);
  expect(first.exitCode).toBe(0);
  expect(first.stdout.toString().match(/mdoc: saved/g)).toHaveLength(3);
  expect((await items())).toHaveLength(4);

  const alphaItem = await itemFor(alpha);
  const betaItem = await itemFor(beta);
  const gammaItem = await itemFor(gamma);
  expect(alphaItem.content).toBe(alphaContent);
  const rendered = await (await fetch(`${serverUrl}${alphaItem.href}`)).text();
  expect(rendered).toContain(`href="/items/${betaItem.id}?mode=full#part"`);
  expect(rendered).toContain(`href="/items/${gammaItem.id}#section"`);
  expect(rendered).toContain('href="https://example.com/a.md"');
  expect(rendered).toContain('src="sub/image.md"');
  const betaRendered = await (await fetch(`${serverUrl}${betaItem.href}`)).text();
  const gammaRendered = await (await fetch(`${serverUrl}${gammaItem.href}`)).text();
  expect(betaRendered).toContain(`href="/items/${alphaItem.id}#top"`);
  expect(gammaRendered).toContain('id="gamma"');

  await fetch(`${serverUrl}/items/${betaItem.id}/toggle`, { method: "POST", body: new URLSearchParams({ field: "starred" }) });
  const second = mdoc(["-r", alpha, other, "--no-open"]);
  expect(second.exitCode).toBe(0);
  expect((await itemFor(beta)).id).toBe(betaItem.id);
  expect(Boolean((await itemFor(beta)).starred)).toBe(true);

  const save = await fetch(`${serverUrl}/items/${alphaItem.id}/manage`, {
    method: "POST",
    body: new URLSearchParams({ type: "document", title: "Alpha", description: "", url: "", content: "# Alpha\n\n[beta](sub/Beta%2C%20file%3Bname.md#again)\n", toc: "on" }),
  });
  expect(save.status).toBe(200);
  const edited = await (await fetch(`${serverUrl}/items/${alphaItem.id}`)).text();
  expect(edited).toContain(`href="/items/${betaItem.id}#again"`);
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

test("rewrites links between nonrecursive roots in one batch", async () => {
  const one = join(directory, "docs", "plain-one.md");
  const two = join(directory, "docs", "plain-two.md");
  await writeFile(one, "# One\n\n[two](plain-two.md)\n");
  await writeFile(two, "# Two\n");
  const result = mdoc([one, two, "--no-open"]);
  expect(result.exitCode).toBe(0);
  const oneItem = await itemFor(one);
  const twoItem = await itemFor(two);
  const rendered = await (await fetch(`${serverUrl}${oneItem.href}`)).text();
  expect(rendered).toContain(`href="/items/${twoItem.id}"`);
});

test("rolls back a server batch when Pandoc cannot render a document", async () => {
  const broken = join(directory, "docs", "broken.md");
  const alphaPath = join(directory, "docs", "alpha.md");
  const template = join(fixture, "templates", "document.html");
  const originalTemplate = await readFile(template, "utf8");
  await writeFile(broken, "# Broken\n");
  const count = (await items()).length;
  const alpha = await itemFor(alphaPath);
  const originalContent = alpha.content;
  const originalRendered = alpha.rendered_html;
  await writeFile(template, "$if(");
  let result;
  try {
    result = mdoc([broken, alphaPath, "--no-open"]);
  } finally {
    await writeFile(template, originalTemplate);
  }
  expect(result.exitCode).not.toBe(0);
  expect((await items())).toHaveLength(count);
  expect((await itemFor(alphaPath)).content).toBe(originalContent);
  expect((await itemFor(alphaPath)).rendered_html).toBe(originalRendered);
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
