import { Database } from "bun:sqlite";
import { basename, extname, join } from "node:path";

const ROOT = import.meta.dir;
const CLAUDE = join(process.env.HOME, "claude");
const DOCS = join(CLAUDE, "docs");
const db = new Database(join(ROOT, "portfolio.sqlite"), { create: true });
db.exec(await Bun.file(join(ROOT, "schema.sql")).text());

const index = JSON.parse(await Bun.file(join(CLAUDE, "index.json")).text());
const seen = new Set();
const upsert = db.query(`INSERT INTO items(type, title, description, content, rendered_html, source_path, toc, created_at, updated_at)
  VALUES ('document', ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(source_path) DO UPDATE SET title=excluded.title, description=excluded.description, content=excluded.content, rendered_html=excluded.rendered_html, updated_at=CURRENT_TIMESTAMP`);

for (const entry of index) {
  const htmlPath = join(CLAUDE, entry.file);
  const markdownPath = htmlPath.replace(/\.html$/i, ".md");
  const markdown = Bun.file(markdownPath);
  const legacy = Bun.file(htmlPath);
  const hasMarkdown = await markdown.exists();
  const hasLegacy = await legacy.exists();
  if (!hasMarkdown && !hasLegacy) {
    console.warn(`missing: ${entry.file}`);
    continue;
  }
  const source = hasMarkdown ? markdownPath : htmlPath;
  const content = hasMarkdown ? await markdown.text() : "";
  const rendered = hasMarkdown ? "" : await legacy.text();
  upsert.run(entry.title || basename(source, extname(source)), entry.desc || "", content, rendered, source, entry.ts || `${entry.date}T00:00:00`);
  seen.add(source);
}

const markdownFiles = new Bun.Glob("**/*.md");
for await (const path of markdownFiles.scan({ cwd: DOCS, absolute: true, onlyFiles: true })) {
  if (seen.has(path)) continue;
  const content = await Bun.file(path).text();
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path, extname(path));
  upsert.run(title, "", content, "", path, new Date().toISOString());
  seen.add(path);
}

const rebuild = db.query("INSERT INTO items_fts(items_fts) VALUES ('rebuild')");
rebuild.run();
const counts = db.query("SELECT type, count(*) count FROM items GROUP BY type ORDER BY type").all();
console.log(JSON.stringify({ imported: seen.size, database: join(ROOT, "portfolio.sqlite"), counts }, null, 2));
