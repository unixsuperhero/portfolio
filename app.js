import { Database } from "bun:sqlite";
import { basename, extname, join, resolve, sep } from "node:path";
import { unlink } from "node:fs/promises";

const ROOT = import.meta.dir;
const DB_PATH = process.env.PORTFOLIO_DB ?? join(ROOT, "portfolio.sqlite");
const TEMPLATE = join(ROOT, "templates", "document.html");
const LEGACY_ROOT = resolve(process.env.PORTFOLIO_LEGACY_ROOT ?? join(process.env.HOME, "claude", "docs"));
const PORT = Number(process.env.PORT ?? 4387);
const HOST = process.env.HOST ?? "127.0.0.1";
const db = new Database(DB_PATH, { create: true });
db.exec(await Bun.file(join(ROOT, "schema.sql")).text());

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const redirect = (location, status = 303) => new Response(null, { status, headers: { location } });
const text = (value, status = 200) => new Response(value, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const html = (value, status = 200) => new Response(value, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const field = (form, name) => String(form.get(name) ?? "").trim();

function renderMarkdown(markdown, title, toc = true) {
  const args = [
    "/opt/homebrew/bin/pandoc",
    "--from=markdown+lists_without_preceding_blankline-blank_before_header-blank_before_blockquote+autolink_bare_uris+emoji+mark+wikilinks_title_before_pipe",
    `--template=${TEMPLATE}`,
    "--syntax-highlighting=breezedark",
    "--standalone",
    "--section-divs",
    "--html-q-tags",
    "--wrap=none",
    "--metadata", `title=${title}`,
    "--metadata", `date=${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
  ];
  if (toc) args.push("--toc", "--toc-depth=3");
  const result = Bun.spawnSync({ cmd: args, stdin: Buffer.from(markdown), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || "pandoc failed");
  return result.stdout.toString();
}

function upsertItem(item) {
  const existing = item.source_path ? db.query("SELECT id FROM items WHERE source_path = ?").get(item.source_path) : null;
  if (existing) {
    db.query(`UPDATE items SET type = ?, title = ?, description = ?, content = ?, rendered_html = ?, url = ?, toc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(item.type, item.title, item.description, item.content, item.rendered_html, item.url, item.toc, existing.id);
    return existing.id;
  }
  return Number(db.query(`INSERT INTO items(type, title, description, content, rendered_html, url, source_path, toc, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) RETURNING id`)
    .get(item.type, item.title, item.description, item.content, item.rendered_html, item.url, item.source_path, item.toc, item.created_at ?? null).id);
}

function itemHref(item) {
  if (item.type === "document" && !item.content && item.source_path?.endsWith(".html")) return `/legacy/${encodeURIComponent(basename(item.source_path))}`;
  if ((item.type === "link" || item.type === "pr") && item.url) return item.url;
  return `/items/${item.id}`;
}

function tagsFor(itemId) {
  return db.query("SELECT tags.* FROM tags JOIN taggings ON taggings.tag_id = tags.id WHERE taggings.item_id = ? ORDER BY tags.name").all(itemId);
}

function icon(type) {
  return { document: "DOC", note: "NOTE", link: "LINK", pr: "PR" }[type] ?? type.toUpperCase();
}

function itemRows(items) {
  if (!items.length) return `<div class="empty"><strong>Nothing here.</strong><span>Change the filters or add an item.</span></div>`;
  return `<div class="items">${items.map(item => {
    const tags = tagsFor(item.id);
    const external = ["link", "pr"].includes(item.type) ? ` target="_blank" rel="noreferrer"` : "";
    return `<article class="item ${item.pinned ? "is-pinned" : ""}">
      <label class="item-select"><input type="checkbox" name="ids" value="${item.id}" aria-label="Select ${escapeHtml(item.title)}"></label>
      <div class="item-date">${escapeHtml(item.created_at.slice(0, 10))}</div>
      <div class="item-main">
        <div class="item-line"><span class="kind">${icon(item.type)}</span><a href="${escapeHtml(itemHref(item))}"${external}>${escapeHtml(item.title)}</a></div>
        ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
        ${tags.length ? `<div class="tag-list">${tags.map(tag => `<a class="tag" href="/tags/${tag.id}">${escapeHtml(tag.name)}</a>`).join("")}</div>` : ""}
      </div>
      <div class="item-actions">
        <button type="button" class="icon-button toggle-button ${item.pinned ? "active" : ""}" data-id="${item.id}" data-field="pinned" title="${item.pinned ? "Unpin" : "Pin"}" aria-label="${item.pinned ? "Unpin" : "Pin"}"><svg viewBox="0 0 24 24"><path d="M8 3h8l-1 6 3 3v2h-5v7l-2-2v-5H6v-2l3-3-1-6Z"/></svg></button>
        <button type="button" class="icon-button toggle-button ${item.starred ? "active star" : ""}" data-id="${item.id}" data-field="starred" title="${item.starred ? "Unstar" : "Star"}" aria-label="${item.starred ? "Unstar" : "Star"}"><svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg></button>
        <a class="icon-button edit-link" href="/items/${item.id}/manage" title="Edit" aria-label="Edit ${escapeHtml(item.title)}">Edit</a>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function shell(title, body, active = "all") {
  const nav = [["all", "/", "Library"], ["starred", "/starred", "Starred"], ["tags", "/tags", "Tags"], ["new", "/new", "Add"]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Portfolio</title><link rel="stylesheet" href="/assets/app.css"></head><body>
    <header class="topbar"><a class="brand" href="/">Portfolio</a><nav>${nav.map(([key, href, label]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("")}</nav></header>
    <main>${body}</main><script>
      document.querySelectorAll('.toggle-button').forEach(button=>button.addEventListener('click',async()=>{const data=new FormData();data.set('field',button.dataset.field);const response=await fetch('/items/'+button.dataset.id+'/toggle',{method:'POST',body:data});if(response.ok)location.reload()}));
      const all=document.querySelector('[data-select-all]');if(all)all.addEventListener('change',()=>document.querySelectorAll('input[name="ids"]').forEach(input=>input.checked=all.checked));
      const bulk=document.querySelector('.bulk-form');if(bulk)bulk.addEventListener('submit',event=>{const action=bulk.elements.action.value;const count=bulk.querySelectorAll('input[name="ids"]:checked').length;if(!count){event.preventDefault();alert('Select at least one item.');return}if(action==='delete_files'&&!confirm('Remove selected records and permanently delete their tracked source files?'))event.preventDefault();});
    </script></body></html>`;
}

function listItems(url, forced = {}) {
  const q = url.searchParams.get("q")?.trim() ?? "";
  const pinned = forced.pinned ?? url.searchParams.has("pinned");
  const starred = forced.starred ?? url.searchParams.has("starred");
  const contents = url.searchParams.has("contents");
  const type = url.searchParams.get("type") ?? "";
  const tag = forced.tag ?? Number(url.searchParams.get("tag") || 0);
  const where = ["1=1"], params = [];
  let join = "";
  if (q) {
    const phrase = q.split(/\s+/).filter(Boolean).map(token => `"${token.replaceAll('"', '""')}"`).join(" AND ");
    join += " JOIN items_fts ON items_fts.rowid = items.id";
    where.push(contents ? "items_fts MATCH ?" : "items_fts MATCH ?");
    params.push(contents ? phrase : `{title description} : (${phrase})`);
  }
  if (tag) { join += " JOIN taggings filter_tagging ON filter_tagging.item_id = items.id"; where.push("filter_tagging.tag_id = ?"); params.push(tag); }
  if (pinned) where.push("items.pinned = 1");
  if (starred) where.push("items.starred = 1");
  if (type && ["document", "note", "link", "pr"].includes(type)) { where.push("items.type = ?"); params.push(type); }
  return db.query(`SELECT DISTINCT items.* FROM items${join} WHERE ${where.join(" AND ")} ORDER BY items.pinned DESC, datetime(items.created_at) DESC, items.id DESC`).all(...params);
}

function libraryPage(url, options = {}) {
  const items = listItems(url, options);
  const q = url.searchParams.get("q") ?? "";
  const checked = key => url.searchParams.has(key) ? " checked" : "";
  const heading = options.heading ?? "Your working library";
  const subhead = options.subhead ?? `${db.query("SELECT count(*) count FROM items").get().count} items, searchable and close at hand.`;
  return shell(heading, `<section class="page-head"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(subhead)}</p></section>
    <form class="filters" method="get"><label class="search"><span>Search</span><input type="search" name="q" value="${escapeHtml(q)}" placeholder="Title, description, or content"><button>Search</button></label>
      <div class="filter-row"><label><input type="checkbox" name="contents"${checked("contents")}> Search contents</label><label><input type="checkbox" name="pinned"${checked("pinned")}> Pinned only</label><label><input type="checkbox" name="starred"${checked("starred")}> Starred only</label>
      <select name="type" aria-label="Item type"><option value="">All types</option>${["document", "note", "link", "pr"].map(type => `<option${url.searchParams.get("type") === type ? " selected" : ""}>${type}</option>`).join("")}</select><button class="quiet">Apply filters</button></div></form>
    <form class="bulk-form" method="post" action="/items/bulk">
      <div class="bulk-bar"><label><input type="checkbox" data-select-all> Select all</label><select name="action" aria-label="Bulk action"><option value="star">Star</option><option value="unstar">Unstar</option><option value="pin">Pin</option><option value="unpin">Unpin</option><option value="add_tags">Add tags</option><option value="remove_tags">Remove tags</option><option value="delete">Remove from database</option><option value="delete_files">Remove and delete source files</option></select><input name="tags" placeholder="tags for tag actions"><button>Apply</button></div>
      <div class="result-count">${items.length} result${items.length === 1 ? "" : "s"}</div>${itemRows(items)}
    </form>`, options.active ?? "all");
}

async function createItem(request) {
  const form = await request.formData();
  const upload = form.get("file");
  const type = field(form, "type") || "document";
  let content = field(form, "content");
  let sourcePath = field(form, "source_path") || null;
  if (upload instanceof File && upload.size) content = await upload.text();
  let title = field(form, "title");
  if (!title && content) title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? (upload instanceof File ? upload.name.replace(/\.md$/i, "") : "Untitled");
  if (!title) return text("title is required", 422);
  const toc = field(form, "toc") !== "false" && field(form, "toc") !== "0";
  const rendered = ["document", "note"].includes(type) && content ? renderMarkdown(content, title, toc) : "";
  const id = upsertItem({ type, title, description: field(form, "description") || field(form, "desc"), content, rendered_html: rendered, url: field(form, "url") || null, source_path: sourcePath, toc: toc ? 1 : 0 });
  const tagNames = field(form, "tags").split(",").map(value => value.trim()).filter(Boolean);
  setTags(id, tagNames);
  return { id, href: itemHref(db.query("SELECT * FROM items WHERE id = ?").get(id)) };
}

function setTags(itemId, names) {
  const insertTag = db.query("INSERT INTO tags(name) VALUES (?) ON CONFLICT(name) DO NOTHING");
  const getTag = db.query("SELECT id FROM tags WHERE name = ? COLLATE NOCASE");
  const insertTagging = db.query("INSERT OR IGNORE INTO taggings(tag_id, item_id) VALUES (?, ?)");
  db.transaction(() => {
    for (const name of names) { insertTag.run(name); insertTagging.run(getTag.get(name).id, itemId); }
  })();
}
function normalizeIds(form) {
  return [...new Set(form.getAll("ids").map(Number).filter(Number.isInteger))];
}

function deleteRecords(ids) {
  const remove = db.query("DELETE FROM items WHERE id = ?");
  db.transaction(() => ids.forEach(id => remove.run(id)))();
  db.query("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM taggings)").run();
}

async function deleteTrackedFiles(ids) {
  const lookup = db.query("SELECT source_path FROM items WHERE id = ?");
  const paths = [...new Set(ids.map(id => lookup.get(id)?.source_path).filter(Boolean))];
  for (const path of paths) {
    try {
      await unlink(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function removeTags(itemId, names) {
  const remove = db.query("DELETE FROM taggings WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ? COLLATE NOCASE)");
  db.transaction(() => names.forEach(name => remove.run(itemId, name)))();
  db.query("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM taggings)").run();
}

async function updateItem(item, form) {
  const type = field(form, "type");
  const title = field(form, "title");
  const content = String(form.get("content") ?? "");
  if (!["document", "note", "link", "pr"].includes(type)) throw new Error("invalid item type");
  if (!title) throw new Error("title is required");
  const toc = form.has("toc");
  const rendered = ["document", "note"].includes(type) && content ? renderMarkdown(content, title, toc) : "";
  db.query(`UPDATE items SET type = ?, title = ?, description = ?, content = ?, rendered_html = ?, url = ?, toc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(type, title, field(form, "description"), content, rendered, field(form, "url") || null, toc ? 1 : 0, item.id);
  if (form.has("sync_source") && item.source_path?.toLowerCase().endsWith(".md")) await Bun.write(item.source_path, content);
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return Response.json({ ok: true, items: db.query("SELECT count(*) count FROM items").get().count });
      if (url.pathname === "/assets/app.css") return new Response(Bun.file(join(ROOT, "public", "app.css")), { headers: { "content-type": "text/css; charset=utf-8" } });
      if (request.method === "GET" && url.pathname === "/api/items") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 0), 0), 1000);
        const items = listItems(url).slice(0, limit || undefined).map(item => ({
          id: item.id,
          type: item.type,
          title: item.title,
          description: item.description,
          url: item.url,
          source_path: item.source_path,
          pinned: Boolean(item.pinned),
          starred: Boolean(item.starred),
          created_at: item.created_at,
          updated_at: item.updated_at,
          href: itemHref(item),
          tags: tagsFor(item.id).map(tag => tag.name),
        }));
        return Response.json({ items });
      }
      const apiItemMatch = url.pathname.match(/^\/api\/items\/(\d+)$/);
      if (request.method === "GET" && apiItemMatch) {
        const item = db.query("SELECT * FROM items WHERE id = ?").get(Number(apiItemMatch[1]));
        if (!item) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json({ ...item, href: itemHref(item), tags: tagsFor(item.id).map(tag => tag.name) });
      }
      if (request.method === "DELETE" && apiItemMatch) {
        const id = Number(apiItemMatch[1]);
        const item = db.query("SELECT id FROM items WHERE id = ?").get(id);
        if (!item) return Response.json({ error: "not found" }, { status: 404 });
        if (url.searchParams.get("delete_files") === "1") await deleteTrackedFiles([id]);
        deleteRecords([id]);
        return new Response(null, { status: 204 });
      }
      if (url.pathname.startsWith("/legacy/")) {
        const candidate = resolve(LEGACY_ROOT, decodeURIComponent(url.pathname.slice(8)));
        if (!candidate.startsWith(LEGACY_ROOT + sep) || extname(candidate).toLowerCase() !== ".html") return text("not found", 404);
        const file = Bun.file(candidate);
        if (!await file.exists()) return text("not found", 404);
        const body = (await file.text()).replaceAll('href="../index.html"', 'href="/"');
        return html(body);
      }
      if (request.method === "GET" && url.pathname === "/") return html(libraryPage(url));
      if (request.method === "GET" && url.pathname === "/starred") return html(libraryPage(url, { starred: true, heading: "Starred", subhead: "The items worth returning to.", active: "starred" }));
      if (request.method === "GET" && url.pathname === "/tags") {
        const tags = db.query(`SELECT tags.*, count(taggings.item_id) count FROM tags LEFT JOIN taggings ON taggings.tag_id = tags.id GROUP BY tags.id ORDER BY tags.name`).all();
        const body = `<section class="page-head"><h1>Tags</h1><p>Portfolios, folders, and cross-cutting collections.</p></section><div class="accordions">${tags.map(tag => `<details><summary><span>${escapeHtml(tag.name)}</span><strong>${tag.count}</strong></summary><div>${itemRows(listItems(new URL(request.url), { tag: tag.id }))}</div></details>`).join("") || `<div class="empty"><strong>No tags yet.</strong><span>Add comma-separated tags to an item.</span></div>`}</div>`;
        return html(shell("Tags", body, "tags"));
      }
      const tagMatch = url.pathname.match(/^\/tags\/(\d+)$/);
      if (request.method === "GET" && tagMatch) {
        const tag = db.query("SELECT * FROM tags WHERE id = ?").get(Number(tagMatch[1]));
        if (!tag) return text("not found", 404);
        return html(libraryPage(url, { tag: tag.id, heading: tag.name, subhead: "Everything collected under this tag.", active: "tags" }));
      }
      if (request.method === "GET" && url.pathname === "/new") {
        return html(shell("Add an item", `<section class="page-head"><h1>Add an item</h1><p>Documents and notes use Markdown. Links and PRs point outward.</p></section><form class="editor" method="post" action="/items"><label>Type<select name="type"><option value="note">Note</option><option value="document">Document</option><option value="link">Link</option><option value="pr">PR</option></select></label><label>Title<input name="title" required></label><label>Description<input name="description"></label><label>URL<input name="url" type="url" placeholder="https://"></label><label>Tags<input name="tags" placeholder="architecture, portfolio-name"></label><label>Markdown<textarea name="content" rows="16"></textarea></label><button class="primary">Save item</button></form>`, "new"));
      }
      const manageMatch = url.pathname.match(/^\/items\/(\d+)\/manage$/);
      if (request.method === "GET" && manageMatch) {
        const item = db.query("SELECT * FROM items WHERE id = ?").get(Number(manageMatch[1]));
        if (!item) return text("not found", 404);
        const tags = tagsFor(item.id);
        const source = item.source_path ? `<div class="source-file"><strong>Tracked source</strong><code>${escapeHtml(item.source_path)}</code></div>` : `<div class="source-file"><strong>Tracked source</strong><span>No source file</span></div>`;
        const body = `<section class="detail-head"><a href="${escapeHtml(itemHref(item))}">Open item</a><h1>Edit item</h1>${source}</section>
          <form class="editor" method="post" action="/items/${item.id}/manage"><label>Type<select name="type">${["document", "note", "link", "pr"].map(type => `<option value="${type}"${item.type === type ? " selected" : ""}>${type}</option>`).join("")}</select></label><label>Title<input name="title" value="${escapeHtml(item.title)}" required></label><label>Description<input name="description" value="${escapeHtml(item.description)}"></label><label>URL<input name="url" type="url" value="${escapeHtml(item.url || "")}"></label><label>Markdown<textarea name="content" rows="18">${escapeHtml(item.content)}</textarea></label><label class="check"><input type="checkbox" name="toc"${item.toc ? " checked" : ""}> Include table of contents</label>${item.source_path?.toLowerCase().endsWith(".md") ? `<label class="check"><input type="checkbox" name="sync_source" checked> Write Markdown changes to tracked source file</label>` : ""}<button class="primary">Save changes</button></form>
          <section class="manage-tags"><h2>Tags</h2><div class="tag-list">${tags.map(tag => `<form method="post" action="/items/${item.id}/tags/remove"><input type="hidden" name="tag_id" value="${tag.id}"><button class="tag" title="Remove ${escapeHtml(tag.name)}">${escapeHtml(tag.name)} ×</button></form>`).join("")}</div><form class="tag-editor" method="post" action="/items/${item.id}/tags"><label>Add tags<input name="tags" placeholder="comma, separated"></label><button>Add</button></form></section>
          <section class="danger-zone"><h2>Delete</h2><form method="post" action="/items/${item.id}/delete"><button name="delete_files" value="0">Remove from database</button>${item.source_path ? `<button class="danger" name="delete_files" value="1" onclick="return confirm('Permanently delete the tracked source file too?')">Remove and delete source file</button>` : ""}</form></section>`;
        return html(shell(`Edit ${item.title}`, body));
      }
      if (request.method === "POST" && manageMatch) {
        const item = db.query("SELECT * FROM items WHERE id = ?").get(Number(manageMatch[1]));
        if (!item) return text("not found", 404);
        await updateItem(item, await request.formData());
        return redirect(`/items/${item.id}/manage`);
      }
      const deleteMatch = url.pathname.match(/^\/items\/(\d+)\/delete$/);
      if (request.method === "POST" && deleteMatch) {
        const id = Number(deleteMatch[1]);
        const form = await request.formData();
        if (field(form, "delete_files") === "1") await deleteTrackedFiles([id]);
        deleteRecords([id]);
        return redirect("/");
      }
      const itemMatch = url.pathname.match(/^\/items\/(\d+)$/);
      if (request.method === "GET" && itemMatch) {
        const item = db.query("SELECT * FROM items WHERE id = ?").get(Number(itemMatch[1]));
        if (!item) return text("not found", 404);
        if (!item.rendered_html && item.content) {
          item.rendered_html = renderMarkdown(item.content, item.title, Boolean(item.toc));
          db.query("UPDATE items SET rendered_html = ? WHERE id = ?").run(item.rendered_html, item.id);
        }
        if (item.rendered_html) {
          const manage = `<a href="/items/${item.id}/manage" style="position:fixed;right:1rem;bottom:1rem;z-index:20;padding:.55rem .8rem;border-radius:8px;background:#172239;color:#b8d0ff;font:600 12px system-ui;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.35)">Manage</a>`;
          return html(item.rendered_html.replace("</body>", `${manage}</body>`));
        }
        return html(shell(item.title, `<section class="detail-head"><a href="/">Back to library</a><h1>${escapeHtml(item.title)}</h1></section><pre>${escapeHtml(item.content)}</pre>`));
      }
      if (request.method === "POST" && url.pathname === "/items/bulk") {
        const form = await request.formData();
        const ids = normalizeIds(form);
        const action = field(form, "action");
        const names = field(form, "tags").split(",").map(value => value.trim()).filter(Boolean);
        if (!ids.length) return text("select at least one item", 422);
        if (action === "delete_files") await deleteTrackedFiles(ids);
        if (action === "delete" || action === "delete_files") {
          deleteRecords(ids);
        } else if (["pin", "unpin", "star", "unstar"].includes(action)) {
          const column = action.includes("pin") ? "pinned" : "starred";
          const value = action === "pin" || action === "star" ? 1 : 0;
          const update = db.query(`UPDATE items SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
          db.transaction(() => ids.forEach(id => update.run(value, id)))();
        } else if (action === "add_tags") {
          ids.forEach(id => setTags(id, names));
        } else if (action === "remove_tags") {
          ids.forEach(id => removeTags(id, names));
        } else {
          return text("invalid bulk action", 422);
        }
        return redirect(request.headers.get("referer") || "/");
      }
      if (request.method === "POST" && url.pathname === "/items") {
        const item = await createItem(request);
        if (item instanceof Response) return item;
        return redirect(item.href);
      }
      if (request.method === "POST" && url.pathname === "/api/items") {
        const item = await createItem(request);
        if (item instanceof Response) return item;
        return Response.json(item, { status: 201 });
      }
      const toggleMatch = url.pathname.match(/^\/items\/(\d+)\/toggle$/);
      if (request.method === "POST" && toggleMatch) {
        const form = await request.formData();
        const name = field(form, "field");
        if (!["pinned", "starred"].includes(name)) return text("invalid field", 422);
        db.query(`UPDATE items SET ${name} = NOT ${name}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(Number(toggleMatch[1]));
        return text("ok");
      }
      const removeTagMatch = url.pathname.match(/^\/items\/(\d+)\/tags\/remove$/);
      if (request.method === "POST" && removeTagMatch) {
        const form = await request.formData();
        db.query("DELETE FROM taggings WHERE item_id = ? AND tag_id = ?").run(Number(removeTagMatch[1]), Number(field(form, "tag_id")));
        return redirect(`/items/${removeTagMatch[1]}/manage`);
      }
      const tagsMatch = url.pathname.match(/^\/items\/(\d+)\/tags$/);
      if (request.method === "POST" && tagsMatch) {
        const form = await request.formData();
        setTags(Number(tagsMatch[1]), field(form, "tags").split(",").map(value => value.trim()).filter(Boolean));
        return redirect(`/items/${tagsMatch[1]}/manage`);
      }
      return text("not found", 404);
    } catch (error) {
      console.error(error);
      return text(`portfolio: ${error.message}`, 500);
    }
  },
});

console.log(`Portfolio listening on http://${server.hostname}:${server.port}`);
