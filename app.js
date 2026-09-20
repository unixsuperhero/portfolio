import { Database } from "bun:sqlite";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = import.meta.dir;
const DB_PATH = process.env.PORTFOLIO_DB ?? join(ROOT, "portfolio.sqlite");
const TEMPLATE = join(ROOT, "templates", "document.html");
const LEGACY_ROOT = resolve(process.env.PORTFOLIO_LEGACY_ROOT ?? join(process.env.HOME, "claude", "docs"));
const PORT = Number(process.env.PORT ?? 4387);
const HOST = process.env.HOST ?? "127.0.0.1";
const PORTS_SCAN_BIN = process.env.PORTS_SCAN_BIN ?? join(ROOT, "bin", "ports-scan");
const MARKDOWN_READER = "markdown+lists_without_preceding_blankline-blank_before_header-blank_before_blockquote+autolink_bare_uris+emoji+mark+wikilinks_title_before_pipe";
const db = new Database(DB_PATH, { create: true });
db.exec(await Bun.file(join(ROOT, "schema.sql")).text());

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const redirect = (location, status = 303) => new Response(null, { status, headers: { location } });
const text = (value, status = 200) => new Response(value, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const html = (value, status = 200) => new Response(value, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const field = (form, name) => String(form.get(name) ?? "").trim();

function runPandoc(args, input) {
  const result = Bun.spawnSync({ cmd: ["/opt/homebrew/bin/pandoc", ...args], stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || "pandoc failed");
  return result.stdout.toString();
}

function localMarkdownLink(sourcePath, target) {
  if (!target || target.startsWith("#") || target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const boundary = target.search(/[?#]/);
  const encodedPath = boundary === -1 ? target : target.slice(0, boundary);
  if (!encodedPath) return null;
  let path;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  if (![".md", ".markdown"].includes(extname(path).toLowerCase())) return null;
  return { sourcePath: resolve(dirname(sourcePath), path), suffix: boundary === -1 ? "" : target.slice(boundary) };
}

function rewriteLinks(node, sourcePath, sourceIds) {
  if (Array.isArray(node)) return node.map(value => rewriteLinks(value, sourcePath, sourceIds));
  if (!node || typeof node !== "object") return node;
  if (node.t === "Link" && Array.isArray(node.c?.[2])) {
    const local = localMarkdownLink(sourcePath, node.c[2][0]);
    const id = local && sourceIds.get(local.sourcePath);
    if (id) node.c[2][0] = `/items/${id}${local.suffix}`;
  }
  for (const value of Object.values(node)) rewriteLinks(value, sourcePath, sourceIds);
  return node;
}

function sourceItemIds() {
  return new Map(db.query("SELECT id, source_path FROM items WHERE type IN ('document', 'note') AND source_path IS NOT NULL").all().map(item => [item.source_path, item.id]));
}

const getSetting = (key, fallback = "") => db.query("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;
const setSetting = (key, value) => db.query("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
const pastryEnabled = () => getSetting("pastry_enabled") === "1";
const PASTRY_FALLBACKS = [".config/gohan/bin/pastry", ".local/bin/pastry", "bin/pastry"];
let pastryResolved;
function pastryBin() {
  if (process.env.PASTRY_BIN) return process.env.PASTRY_BIN;
  if (pastryResolved) return pastryResolved;
  const home = process.env.HOME ?? "";
  const candidates = [...PASTRY_FALLBACKS.map(path => join(home, path)), "/opt/homebrew/bin/pastry", "/usr/local/bin/pastry"];
  pastryResolved = Bun.which("pastry") ?? candidates.find(existsSync) ?? "pastry";
  return pastryResolved;
}
const slugify = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function renderMarkdown(markdown, title, toc = true, sourcePath = null, sourceIds = sourceItemIds()) {
  let input = markdown;
  let from = `--from=${MARKDOWN_READER}`;
  if (sourcePath) {
    const document = JSON.parse(runPandoc([from, "--to=json"], markdown));
    input = JSON.stringify(rewriteLinks(document, sourcePath, sourceIds));
    from = "--from=json";
  }
  const args = [
    from,
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
  return runPandoc(args, input);
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
  if (item.type === "document" && !item.content && item.source_path?.toLowerCase().endsWith(".html")) {
    const candidate = resolve(LEGACY_ROOT, basename(item.source_path));
    if (candidate.startsWith(LEGACY_ROOT + sep) && existsSync(candidate)) return `/legacy/${encodeURIComponent(basename(item.source_path))}`;
  }
  if ((item.type === "link" || item.type === "pr") && item.url) return item.url;
  return `/items/${item.id}`;
}

function tagsFor(itemId) {
  return db.query("SELECT tags.* FROM tags JOIN taggings ON taggings.tag_id = tags.id WHERE taggings.item_id = ? ORDER BY tags.name").all(itemId);
}

function icon(type) {
  return { document: "DOC", note: "NOTE", link: "LINK", pr: "PR" }[type] ?? type.toUpperCase();
}

const pastryButton = item => `<div class="pastry-header-actions"><button type="button" class="pastry-open" data-pastry-open data-pastry-item="${item.id}">Upload to Pastry</button></div>`;

function pastryWidget() {
  return `<style>
    .pastry-header-actions{margin-top:1.1rem}
    .pastry-open{border:0;border-radius:999px;background:var(--accent);color:#08111f;font:600 .78rem/1 var(--font-body,inherit);letter-spacing:.02em;padding:.55rem .95rem;cursor:pointer}
    .pastry-open:hover{background:var(--accent2)}
    .pastry-modal[hidden]{display:none}
    .pastry-modal{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:1.25rem;background:rgba(4,8,18,.72)}
    .pastry-modal-card{width:min(420px,100%);display:grid;gap:1rem;padding:1.25rem;border:1px solid var(--border2);border-radius:var(--radius,12px);background:var(--surface);color:var(--text);font-family:var(--font-body,inherit);font-size:.95rem;text-align:left}
    .pastry-modal-card h2{margin:0;font-size:1.15rem}
    .pastry-modal-card fieldset{display:grid;gap:.45rem;margin:0;padding:.7rem .85rem;border:1px solid var(--border);border-radius:10px}
    .pastry-modal-card legend{padding:0 .35rem;font:600 .62rem/1 var(--font-mono,monospace);letter-spacing:.16em;text-transform:uppercase;color:var(--text3)}
    .pastry-modal-card label{display:flex;align-items:center;gap:.5rem;cursor:pointer}
    .pastry-modal-card input{accent-color:var(--accent)}
    .pastry-status{margin:0;min-height:1.25em;font-size:.82rem;color:var(--text2)}
    .pastry-status.error{color:#ff9d9d}
    .pastry-status a{color:var(--accent)}
    .pastry-modal-actions{display:flex;justify-content:flex-end;gap:.6rem}
    .pastry-modal-actions button{border:0;border-radius:8px;padding:.62rem 1rem;font:700 .85rem var(--font-body,inherit);cursor:pointer}
    .pastry-cancel{background:var(--surface2);color:var(--text)}
    .pastry-submit{background:var(--accent);color:#08111f}
    .pastry-submit[disabled]{opacity:.55;cursor:progress}
  </style>
  <div class="pastry-modal" id="pastry-modal" hidden>
    <div class="pastry-modal-card" role="dialog" aria-modal="true" aria-labelledby="pastry-modal-title">
      <h2 id="pastry-modal-title">Upload to Pastry</h2>
      <fieldset><legend>File type</legend>
        <label><input type="radio" name="pastry-format" value="md" checked> Markdown (.md)</label>
        <label><input type="radio" name="pastry-format" value="html"> HTML (.html)</label>
      </fieldset>
      <fieldset><legend>Visibility</legend>
        <label><input type="radio" name="pastry-visibility" value="public" checked> Public</label>
        <label><input type="radio" name="pastry-visibility" value="private"> Private</label>
      </fieldset>
      <p class="pastry-status" role="status"></p>
      <div class="pastry-modal-actions">
        <button type="button" class="pastry-cancel">Cancel</button>
        <button type="button" class="pastry-submit">Upload</button>
      </div>
    </div>
  </div>
  <script>
    (() => {
      const trigger = document.querySelector('[data-pastry-open]');
      const modal = document.getElementById('pastry-modal');
      if (!trigger || !modal) return;
      const status = modal.querySelector('.pastry-status');
      const submit = modal.querySelector('.pastry-submit');
      const itemId = trigger.dataset.pastryItem;
      const close = () => { modal.hidden = true; status.textContent = ''; status.classList.remove('error'); submit.disabled = false; };
      const open = () => { modal.hidden = false; };
      trigger.addEventListener('click', open);
      modal.querySelector('.pastry-cancel').addEventListener('click', close);
      modal.addEventListener('click', event => { if (event.target === modal) close(); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) close(); });
      submit.addEventListener('click', async () => {
        const format = modal.querySelector('input[name="pastry-format"]:checked').value;
        const visibility = modal.querySelector('input[name="pastry-visibility"]:checked').value;
        submit.disabled = true;
        status.classList.remove('error');
        status.textContent = 'Uploading…';
        try {
          const response = await fetch('/api/items/' + itemId + '/pastry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ format, visibility }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || 'Upload failed');
          status.textContent = 'Uploaded as ' + (payload.slug || payload.output || 'snippet') + '.';
          if (payload.url) {
            const link = document.createElement('a');
            link.href = payload.url;
            link.target = '_blank';
            link.rel = 'noreferrer';
            link.textContent = 'Open';
            status.append(' ', link);
          }
          submit.disabled = false;
        } catch (error) {
          status.classList.add('error');
          status.textContent = error.message;
          submit.disabled = false;
        }
      });
    })();
  </script>`;
}

function injectPastry(documentHtml, item) {
  const button = pastryButton(item);
  const withButton = documentHtml.includes("</header>")
    ? documentHtml.replace("</header>", `${button}</header>`)
    : documentHtml.replace("</body>", `${button}</body>`);
  return withButton.replace("</body>", `${pastryWidget()}</body>`);
}

async function pastryContent(item, format) {
  if (format === "html") {
    if (item.rendered_html) return item.rendered_html;
    if (item.source_path?.toLowerCase().endsWith(".html")) {
      const file = Bun.file(item.source_path);
      if (await file.exists()) return file.text();
    }
    return item.content ? renderMarkdown(item.content, item.title, Boolean(item.toc)) : "";
  }
  return item.content ?? "";
}

function pastryStatus() {
  const bin = Bun.which(pastryBin());
  if (!bin) return { ok: false, detail: `"${pastryBin()}" not found on PATH` };
  const result = Bun.spawnSync({ cmd: [bin, "auth", "status"], stdout: "pipe", stderr: "pipe" });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
  const detail = output.split("\n").map(line => line.trim()).filter(Boolean).slice(0, 2).join(" · ") || "no output";
  return { ok: result.exitCode === 0 && /authenticated/i.test(output), detail: `${bin} · ${detail}` };
}

function settingsPage() {
  const enabled = pastryEnabled();
  const status = pastryStatus();
  const body = `<section class="page-head"><h1>Settings</h1><p>Local preferences stored in this Portfolio database.</p></section>
    <form class="editor" method="post" action="/settings">
      <label class="check"><input type="checkbox" name="pastry_enabled"${enabled ? " checked" : ""}> Enable Pastry uploads</label>
      <p class="settings-note">When enabled, every document page shows an <strong>Upload to Pastry</strong> button in its header. Uploads run <code>pastry create &lt;file&gt;</code> with your chosen file type and visibility.</p>
      <p class="settings-note${status.ok ? "" : " warn"}">Pastry CLI: ${escapeHtml(status.detail)}</p>
      <button class="primary">Save settings</button>
    </form>`;
  return html(shell("Settings", body, "settings"));
}

function getPortsSnapshot() {
  try {
    const result = Bun.spawnSync({ cmd: [PORTS_SCAN_BIN], stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
      const detail = result.stderr.toString().trim().split("\n")[0] || `scanner exited with ${result.exitCode}`;
      return { scanned_at: new Date().toISOString(), herdr_available: false, ports: [], warnings: [], error: detail };
    }
    const payload = JSON.parse(result.stdout.toString());
    if (!Array.isArray(payload.ports)) throw new Error("scanner returned no ports array");
    return payload;
  } catch (error) {
    return { scanned_at: new Date().toISOString(), herdr_available: false, ports: [], warnings: [], error: error.message };
  }
}

function portsPage() {
  const snapshot = getPortsSnapshot();
  const herdrBadge = snapshot.herdr_available
    ? `<span class="ports-badge ok">Herdr linked</span>`
    : `<span class="ports-badge warn">Herdr unavailable</span>`;
  const warnings = [...(snapshot.warnings ?? []), ...(snapshot.error ? [`scan error: ${snapshot.error}`] : [])];
  const rows = snapshot.ports.map(entry => {
    const herdr = entry.herdr;
    const ai = entry.ai;
    const herdrLabel = herdr
      ? `${escapeHtml(herdr.workspace_label || herdr.workspace_id || "")} ${escapeHtml(herdr.pane_id || "")}${herdr.match === "cwd" ? " ~" : ""}`
      : "<span class='ports-dim'>—</span>";
    const herdrTitle = herdr ? escapeHtml(`tab ${herdr.tab_id ?? ""} · ${herdr.agent_status ?? ""} · match: ${herdr.match ?? "?"}`) : "";
    const aiLabel = ai?.session
      ? `${escapeHtml(ai.kind ?? "")} <code>${escapeHtml(String(ai.session).slice(0, 8))}…</code>`
      : ai?.kind
        ? escapeHtml(ai.kind)
        : "<span class='ports-dim'>—</span>";
    const aiTitle = escapeHtml(ai?.session ?? ai?.hint ?? "");
    return `<tr>
      <td class="ports-num">${entry.port}</td>
      <td>${escapeHtml(entry.host)}</td>
      <td>${escapeHtml(entry.command)} <span class="ports-dim">#${entry.pid}</span></td>
      <td class="ports-path" title="${escapeHtml(entry.cwd || "")}">${escapeHtml(entry.cwd || "—")}</td>
      <td title="${herdrTitle}">${herdrLabel}</td>
      <td title="${aiTitle}">${aiLabel}</td>
    </tr>`;
  }).join("");
  const body = `<section class="page-head"><h1>Ports</h1><p>${snapshot.ports.length} TCP listeners · scanned ${escapeHtml(snapshot.scanned_at ?? "")} · <a href="/api/ports">JSON</a></p></section>
    <p>${herdrBadge} <span class="ports-note">Process match = listener descends from the pane shell. A trailing ~ means same working directory only (e.g. this server runs under launchd, not Herdr).</span></p>
    ${warnings.length ? `<p class="settings-note warn">${warnings.map(escapeHtml).join("<br>")}</p>` : ""}
    ${snapshot.ports.length ? `<div class="ports-wrap"><table class="ports-table"><thead><tr><th>Port</th><th>Bind</th><th>Process</th><th>Directory</th><th>Herdr pane</th><th>AI session</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><strong>No listeners found.</strong><span>The scanner reported zero TCP LISTEN sockets.</span></div>`}
    <style>.ports-table{width:100%;border-collapse:collapse;font-size:.82rem}.ports-table th{text-align:left;color:var(--text3);font-family:var(--mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;padding:.5rem;border-bottom:1px solid var(--border)}.ports-table td{padding:.5rem;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}.ports-num{font-family:var(--mono);font-weight:700}.ports-path{max-width:22rem}.ports-dim{color:var(--text3)}.ports-badge{border:1px solid var(--border2);border-radius:999px;padding:.2rem .6rem;font-size:.72rem}.ports-badge.ok{color:var(--accent2)}.ports-badge.warn{color:var(--gold)}.ports-note{color:var(--text3);font-size:.78rem}.ports-wrap{overflow-x:auto}.ports-table code{color:var(--accent2)}</style>`;
  return html(shell("Ports", body, "ports"));
}

async function uploadToPastry(item, format, visibility) {
  const content = await pastryContent(item, format);
  if (!content) {
    const error = new Error(`this item has no ${format === "html" ? "HTML" : "Markdown"} content to upload`);
    error.status = 422;
    throw error;
  }
  const dir = await mkdtemp(join(tmpdir(), "portfolio-pastry-"));
  const file = join(dir, `${slugify(item.title) || "document"}.${format}`);
  await writeFile(file, content);
  try {
    const args = [pastryBin(), "create", file, "--title", item.title, visibility === "private" ? "--private" : "--public", "--json"];
    const result = Bun.spawnSync({ cmd: args, stdout: "pipe", stderr: "pipe" });
    const stdout = result.stdout.toString().trim();
    const stderr = result.stderr.toString().trim();
    if (result.exitCode !== 0) throw new Error(stderr || stdout || `pastry create exited with ${result.exitCode}`);
    let payload = null;
    try { payload = JSON.parse(stdout); } catch {}
    const snippet = payload?.snippet ?? payload;
    return {
      slug: snippet?.slug ?? snippet?.id ?? null,
      url: snippet?.url ?? snippet?.html_url ?? null,
      output: stdout,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
        <div class="row-tag-editor" hidden><input name="tags" placeholder="Add a tag" aria-label="Tags for ${escapeHtml(item.title)}"><button type="button" class="row-tag-add" data-id="${item.id}">Add</button></div>
      </div>
      <div class="item-actions">
        <button type="button" class="icon-button edit-link row-tag-toggle" title="Add tags" aria-label="Add tags to ${escapeHtml(item.title)}">Tag</button>
        <button type="button" class="icon-button toggle-button ${item.pinned ? "active" : ""}" data-id="${item.id}" data-field="pinned" title="${item.pinned ? "Unpin" : "Pin"}" aria-label="${item.pinned ? "Unpin" : "Pin"}"><svg viewBox="0 0 24 24"><path d="M8 3h8l-1 6 3 3v2h-5v7l-2-2v-5H6v-2l3-3-1-6Z"/></svg></button>
        <button type="button" class="icon-button toggle-button ${item.starred ? "active star" : ""}" data-id="${item.id}" data-field="starred" title="${item.starred ? "Unstar" : "Star"}" aria-label="${item.starred ? "Unstar" : "Star"}"><svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg></button>
        <a class="icon-button edit-link" href="/items/${item.id}/manage" title="Edit" aria-label="Edit ${escapeHtml(item.title)}">Edit</a>
      </div>
    </article>`;
  }).join("")}</div>`;
}
function railSection(title, type) {
  const items = db.query("SELECT * FROM items WHERE type = ? ORDER BY pinned DESC, datetime(created_at) DESC, id DESC").all(type);
  return `<section class="rail-section"><header><h2>${title}</h2><span>${items.length}</span></header><div class="rail-items">${items.map(item => {
    const external = ["link", "pr"].includes(item.type) ? ` target="_blank" rel="noreferrer"` : "";
    return `<article class="rail-item${item.pinned ? " is-pinned" : ""}${item.starred ? " is-starred" : ""}"><a href="${escapeHtml(itemHref(item))}"${external}>${escapeHtml(item.title)}</a>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}<div><time>${escapeHtml(item.created_at.slice(0, 10))}</time>${item.pinned ? `<span>Pinned</span>` : ""}${item.starred ? `<span>Starred</span>` : ""}</div></article>`;
  }).join("") || `<div class="rail-empty">No ${title.toLowerCase()} yet.</div>`}</div></section>`;
}


function shell(title, body, active = "all") {
  const nav = [["all", "/", "Library"], ["starred", "/starred", "Starred"], ["tags", "/tags", "Tags"], ["ports", "/ports", "Ports"], ["new", "/new", "Add"], ["settings", "/settings", "Settings"]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Portfolio</title><link rel="stylesheet" href="/assets/app.css"></head><body>
    <header class="topbar"><a class="brand" href="/">Portfolio</a><nav>${nav.map(([key, href, label]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("")}</nav></header>
    <main>${body}</main><script>
      document.querySelectorAll('.row-tag-toggle').forEach(button=>button.addEventListener('click',()=>{const editor=button.closest('.item').querySelector('.row-tag-editor');editor.hidden=!editor.hidden;button.classList.toggle('active',!editor.hidden);button.setAttribute('aria-expanded',String(!editor.hidden));if(!editor.hidden)editor.querySelector('input').focus()}));
      document.querySelectorAll('.row-tag-add').forEach(button=>{const input=button.previousElementSibling;const add=async()=>{if(!input.value.trim())return;button.disabled=true;button.textContent='Adding…';const data=new FormData();data.set('tags',input.value);const response=await fetch('/items/'+button.dataset.id+'/tags',{method:'POST',body:data});if(response.ok)location.reload();else{button.disabled=false;button.textContent='Add';alert(await response.text())}};button.addEventListener('click',add);input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();add()}})});
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
  const type = forced.type ?? url.searchParams.get("type") ?? "";
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
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") || "1", 10) || 1, 1), pageCount);
  const start = (page - 1) * pageSize;
  const visibleItems = items.slice(start, start + pageSize);
  const pageHref = number => {
    const target = new URL(url);
    if (number === 1) target.searchParams.delete("page"); else target.searchParams.set("page", number);
    return target.pathname + target.search;
  };
  const pager = pageCount > 1 ? `<nav class="pager" aria-label="Document pages">${page > 1 ? `<a href="${escapeHtml(pageHref(page - 1))}">Newer</a>` : `<span></span>`}<span>Page ${page} of ${pageCount}</span>${page < pageCount ? `<a href="${escapeHtml(pageHref(page + 1))}">Older</a>` : `<span></span>`}</nav>` : "";
  const q = url.searchParams.get("q") ?? "";
  const checked = key => url.searchParams.has(key) ? " checked" : "";
  const heading = options.heading ?? "Your working library";
  const subhead = options.subhead ?? `${db.query("SELECT count(*) count FROM items").get().count} items, searchable and close at hand.`;
  const typeFilter = options.rails ? "" : `<select name="type" aria-label="Item type"><option value="">All types</option>${["document", "note", "link", "pr"].map(type => `<option${url.searchParams.get("type") === type ? " selected" : ""}>${type}</option>`).join("")}</select>`;
  const center = `<div class="library-center"><form class="filters" method="get"><label class="search"><span>Search</span><input type="search" name="q" value="${escapeHtml(q)}" placeholder="Title, description, or content"><button>Search</button></label>
      <div class="filter-row"><label><input type="checkbox" name="contents"${checked("contents")}> Search contents</label><label><input type="checkbox" name="pinned"${checked("pinned")}> Pinned only</label><label><input type="checkbox" name="starred"${checked("starred")}> Starred only</label>
      ${typeFilter}<button class="quiet">Apply filters</button></div></form>
    <form class="bulk-form" method="post" action="/items/bulk">
      <div class="bulk-bar"><label><input type="checkbox" data-select-all> Select all</label><select name="action" aria-label="Bulk action"><option value="star">Star</option><option value="unstar">Unstar</option><option value="pin">Pin</option><option value="unpin">Unpin</option><option value="add_tags">Add tags</option><option value="remove_tags">Remove tags</option><option value="delete">Remove from database</option><option value="delete_files">Remove and delete source files</option></select><input name="tags" placeholder="tags for tag actions"><button>Apply</button></div>
      <div class="result-count">Showing ${items.length ? start + 1 : 0}–${Math.min(start + pageSize, items.length)} of ${items.length}</div>${itemRows(visibleItems)}
    </form>${pager}</div>`;
  const content = options.rails ? `<div class="library-layout"><aside class="library-rail library-rail-left">${railSection("Notes", "note")}</aside>${center}<aside class="library-rail library-rail-right">${railSection("PRs", "pr")}${railSection("Links", "link")}</aside></div>` : center;
  return shell(heading, `<div class="${options.rails ? "library-shell" : ""}"><section class="page-head"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(subhead)}</p></section>${content}</div>`, options.active ?? "all");
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
  let id;
  if (["document", "note"].includes(type) && content) {
    db.transaction(() => {
      id = upsertItem({ type, title, description: field(form, "description") || field(form, "desc"), content, rendered_html: "", url: field(form, "url") || null, source_path: sourcePath, toc: toc ? 1 : 0 });
      const rendered = renderMarkdown(content, title, toc, sourcePath);
      db.query("UPDATE items SET rendered_html = ? WHERE id = ?").run(rendered, id);
    })();
  } else {
    id = upsertItem({ type, title, description: field(form, "description") || field(form, "desc"), content, rendered_html: "", url: field(form, "url") || null, source_path: sourcePath, toc: toc ? 1 : 0 });
  }
  const tagNames = field(form, "tags").split(",").map(value => value.trim()).filter(Boolean);
  setTags(id, tagNames);
  return { id, href: itemHref(db.query("SELECT * FROM items WHERE id = ?").get(id)) };
}

function documentTitle(content, sourcePath) {
  if (extname(sourcePath).toLowerCase() === ".html") {
    return content.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || basename(sourcePath, extname(sourcePath));
  }
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(sourcePath, extname(sourcePath));
}

const isHtmlPath = sourcePath => extname(sourcePath).toLowerCase() === ".html";

async function createDocumentBatch(request) {
  const form = await request.formData();
  const uploads = form.getAll("file");
  const rawSourcePaths = form.getAll("source_path");
  if (rawSourcePaths.some(path => typeof path !== "string" || !path || !isAbsolute(path))) return text("source paths must be unique absolute paths", 422);
  const sourcePaths = rawSourcePaths.map(path => resolve(path));
  let roots;
  try {
    const rawRoots = JSON.parse(field(form, "roots") || "[]");
    if (!Array.isArray(rawRoots) || rawRoots.some(path => typeof path !== "string" || !path || !isAbsolute(path))) return text("roots must be absolute paths", 422);
    roots = rawRoots.map(path => resolve(path));
  } catch {
    return text("roots must be JSON", 422);
  }
  if (!uploads.length || uploads.length !== sourcePaths.length || !roots.length) return text("files, source paths, and roots are required", 422);
  if (new Set(sourcePaths).size !== sourcePaths.length) return text("source paths must be unique absolute paths", 422);
  if (roots.some(path => !sourcePaths.includes(path))) return text("each root must be included in the batch", 422);
  const nodes = [];
  for (let index = 0; index < uploads.length; index++) {
    const upload = uploads[index];
    if (!(upload instanceof File)) return text("each batch document needs a Markdown or HTML file", 422);
    const sourcePath = sourcePaths[index];
    if (![".md", ".markdown", ".html"].includes(extname(sourcePath).toLowerCase())) return text("batch source paths must end in .md, .markdown, or .html", 422);
    nodes.push({ sourcePath, content: await upload.text() });
  }
  const toc = field(form, "toc") !== "false" && field(form, "toc") !== "0";
  const root = roots[0];
  const title = field(form, "title");
  const description = field(form, "description") || field(form, "desc");
  const ids = new Map();
  db.transaction(() => {
    for (const node of nodes) {
      const isFirstRoot = node.sourcePath === root;
      const nodeTitle = isFirstRoot && title ? title : documentTitle(node.content, node.sourcePath);
      const html = isHtmlPath(node.sourcePath);
      ids.set(node.sourcePath, upsertItem({ type: "document", title: nodeTitle, description: isFirstRoot ? description : "", content: html ? "" : node.content, rendered_html: html ? node.content : "", url: null, source_path: node.sourcePath, toc: toc ? 1 : 0 }));
    }
    const sourceIds = sourceItemIds();
    for (const node of nodes) {
      if (isHtmlPath(node.sourcePath)) continue;
      const item = db.query("SELECT title FROM items WHERE id = ?").get(ids.get(node.sourcePath));
      const rendered = renderMarkdown(node.content, item.title, toc, node.sourcePath, sourceIds);
      db.query("UPDATE items SET rendered_html = ? WHERE id = ?").run(rendered, ids.get(node.sourcePath));
    }
  })();
  return { items: roots.map(sourcePath => ({ id: ids.get(sourcePath), href: `/items/${ids.get(sourcePath)}`, source_path: sourcePath })) };
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
  const htmlBacked = item.source_path?.toLowerCase().endsWith(".html") && !content;
  const rendered = ["document", "note"].includes(type) && content ? renderMarkdown(content, title, toc, item.source_path) : (htmlBacked ? item.rendered_html : "");
  const nextContent = htmlBacked ? item.content : content;
  db.query(`UPDATE items SET type = ?, title = ?, description = ?, content = ?, rendered_html = ?, url = ?, toc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(type, title, field(form, "description"), nextContent, rendered, field(form, "url") || null, toc ? 1 : 0, item.id);
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
        const legacyItem = pastryEnabled() ? db.query("SELECT * FROM items WHERE source_path = ?").get(candidate) : null;
        return html(legacyItem ? injectPastry(body, legacyItem) : body);
      }
      if (request.method === "GET" && url.pathname === "/api/settings") return Response.json({ pastry_enabled: pastryEnabled() });
      const pastryMatch = url.pathname.match(/^\/api\/items\/(\d+)\/pastry$/);
      if (request.method === "POST" && pastryMatch) {
        if (!pastryEnabled()) return Response.json({ error: "pastry uploads are disabled in settings" }, { status: 403 });
        const item = db.query("SELECT * FROM items WHERE id = ?").get(Number(pastryMatch[1]));
        if (!item) return Response.json({ error: "not found" }, { status: 404 });
        const body = await request.json().catch(() => ({}));
        const format = body.format === "html" ? "html" : "md";
        const visibility = body.visibility === "private" ? "private" : "public";
        try {
          const uploaded = await uploadToPastry(item, format, visibility);
          return Response.json({ ...uploaded, format, visibility });
        } catch (error) {
          if (error.status) return Response.json({ error: error.message }, { status: error.status });
          const bin = Bun.which(pastryBin());
          return Response.json({ error: bin ? error.message : `pastry CLI "${pastryBin()}" not found on PATH` }, { status: bin ? 502 : 503 });
        }
      }
      if (request.method === "GET" && url.pathname === "/") return html(libraryPage(url, { type: "document", rails: true, subhead: "Documents in the center; notes, PRs, and links close at hand." }));
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
      if (request.method === "GET" && url.pathname === "/ports") return portsPage();
      if (request.method === "GET" && url.pathname === "/api/ports") return Response.json(getPortsSnapshot());
      if (request.method === "GET" && url.pathname === "/settings") return settingsPage();
      if (request.method === "POST" && url.pathname === "/settings") {
        const form = await request.formData();
        setSetting("pastry_enabled", form.has("pastry_enabled") ? "1" : "0");
        return redirect("/settings");
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
          item.rendered_html = renderMarkdown(item.content, item.title, Boolean(item.toc), item.source_path);
          db.query("UPDATE items SET rendered_html = ? WHERE id = ?").run(item.rendered_html, item.id);
        }
        if (item.rendered_html) {
          const manage = `<a href="/items/${item.id}/manage" style="position:fixed;right:1rem;bottom:1rem;z-index:20;padding:.55rem .8rem;border-radius:8px;background:#172239;color:#b8d0ff;font:600 12px system-ui;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.35)">Manage</a>`;
          const documentHtml = pastryEnabled() ? injectPastry(item.rendered_html, item) : item.rendered_html;
          return html(documentHtml.replace("</body>", `${manage}</body>`));
        }
        return html(shell(item.title, `<section class="detail-head"><a href="/">Back to library</a><h1>${escapeHtml(item.title)}</h1>${pastryEnabled() ? pastryButton(item) : ""}</section><pre>${escapeHtml(item.content)}</pre>${pastryEnabled() ? pastryWidget() : ""}`));
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
      if (request.method === "POST" && url.pathname === "/api/documents") {
        const batch = await createDocumentBatch(request);
        if (batch instanceof Response) return batch;
        return Response.json(batch, { status: 201 });
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
