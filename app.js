import { openDatabase, upsertItem as storeItem, getTask, listTaskViews, createTask, updateTask, completeTask, uncompleteTask, taskView } from "@portfolio/db";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = import.meta.dir;
const DB_PATH = process.env.PORTFOLIO_DB ?? join(ROOT, "portfolio.sqlite");
const TEMPLATE = join(ROOT, "templates", "document.html");
const EXTERNAL_IMAGES_FILTER = join(ROOT, "templates", "external-images.lua");
const LEGACY_ROOT = resolve(process.env.PORTFOLIO_LEGACY_ROOT ?? join(process.env.HOME, "claude", "docs"));
const PORT = Number(process.env.PORT ?? 4387);
const HOST = process.env.HOST ?? "127.0.0.1";
const PORTS_SCAN_BIN = process.env.PORTS_SCAN_BIN ?? join(ROOT, "bin", "ports-scan");
const MARKDOWN_READER = "markdown+lists_without_preceding_blankline-blank_before_header-blank_before_blockquote+autolink_bare_uris+emoji+mark+wikilinks_title_before_pipe";
const WATCH_DEBOUNCE_MS = Number(process.env.PORTFOLIO_WATCH_DEBOUNCE_MS ?? 200);
const OPEN_BIN = process.env.PORTFOLIO_OPEN_BIN ?? "open";
const PBCOPY_BIN = process.env.PORTFOLIO_PBCOPY_BIN ?? "pbcopy";
const ITEM_TYPES = ["document", "note", "link", "pr", "file", "dir", "task"];
const PATH_TYPES = ["file", "dir"];
const db = openDatabase(DB_PATH, { log: message => console.error(`portfolio: ${message}`) });

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
    "--embed-resources",
    `--lua-filter=${EXTERNAL_IMAGES_FILTER}`,
    "--section-divs",
    "--html-q-tags",
    "--wrap=none",
    "--metadata", `title=${title}`,
    "--metadata", `date=${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
  ];
  if (toc) args.push("--toc", "--toc-depth=3");
  if (sourcePath) args.push(`--resource-path=${dirname(sourcePath)}`);
  return runPandoc(args, input);
}

function upsertItem(item) {
  if (item.type === "task") return storeItem(db, item);
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

function settingsPage(error = "", statusCode = 200) {
  const enabled = pastryEnabled();
  const status = pastryStatus();
  const directories = watchedDirectories();
  const projectParents = db.query("SELECT project_parents.*, (SELECT count(*) FROM items WHERE items.path LIKE project_parents.path || '/%') count FROM project_parents ORDER BY path").all();
  const rows = directories.map(directory => {
    const state = watchStates.get(directory.id);
    const detail = state?.error
      ? `<span class="watch-status warn">${escapeHtml(state.error)}</span>`
      : `<span class="watch-status">${state?.watcher ? "Watching" : "Configured"} · ${state?.count ?? 0} documents${state?.lastSyncedAt ? ` · synced ${escapeHtml(new Date(state.lastSyncedAt).toLocaleString())}` : ""}</span>`;
    return `<div class="watch-row">
      <div class="watch-path"><code>${escapeHtml(directory.path)}</code>${detail}</div>
      <form class="watch-options" method="post" action="/settings/watched-directories/${directory.id}">
        <label class="check"><input type="checkbox" name="recursive"${directory.recursive ? " checked" : ""}> Include subdirectories</label>
        <button>Save</button>
      </form>
      <form method="post" action="/settings/watched-directories/${directory.id}/delete">
        <button class="danger" onclick="return confirm('Stop watching this directory and remove documents no longer covered by another watched directory?')">Remove</button>
      </form>
    </div>`;
  }).join("");
  const body = `<section class="page-head"><h1>Settings</h1><p>Local preferences stored in this Portfolio database.</p></section>
    <section class="settings-section">
      <h2>Watched directories</h2>
      <p class="settings-note">Portfolio pulls Markdown and HTML files from disk. One watcher handles each configured directory, including its full tree when <strong>Include subdirectories</strong> is enabled.</p>
      ${error ? `<p class="settings-error" role="alert">${escapeHtml(error)}</p>` : ""}
      <form class="watch-add" method="post" action="/settings/watched-directories">
        <div class="watch-path-field">
          <label for="watched-directory-path">Directory path</label>
          <div class="watch-path-control">
            <input id="watched-directory-path" name="path" required placeholder="/Users/you/Documents/docs">
            <button type="button" class="folder-picker" data-folder-picker>Choose folder…</button>
          </div>
          <p class="directory-browser-error" data-directory-error role="alert"></p>
        </div>
        <label class="check"><input type="checkbox" name="recursive" checked> Include subdirectories</label>
        <button class="primary">Add directory</button>
      </form>
      <script>
        {
          const button=document.querySelector('[data-folder-picker]');
          const input=button.form.elements.path;
          const error=document.querySelector('[data-directory-error]');
          button.addEventListener('click',async()=>{
            button.disabled=true;
            error.textContent='';
            try{
              const response=await fetch('/api/settings/pick-directory',{method:'POST',headers:{'X-Portfolio-Picker':'1'}});
              const data=await response.json();
              if(!response.ok)throw new Error(data.error||'Could not open the folder picker.');
              if(data.path){
                input.value=data.path;
                input.focus();
              }
            }catch(reason){
              error.textContent=reason.message;
            }finally{
              button.disabled=false;
            }
          });
        }
      </script>
      <div class="watch-list">${rows || `<div class="empty"><strong>No watched directories.</strong><span>Add one to pull documents into the library automatically.</span></div>`}</div>
      ${directories.length ? `<form method="post" action="/settings/watched-directories/sync"><button>Sync now</button></form>` : ""}
      <p class="settings-note">Removing a watch or excluding its subdirectories removes uncovered documents from Portfolio. Source files are never deleted here.</p>
    </section>
    <section class="settings-section">
      <h2>Project parent directories</h2>
      <p class="settings-note">Every direct child of a parent directory is a project. So is any deeper directory, up to ${PROJECT_SCAN_DEPTH} levels, with <code>.git</code> at its top level. A scan adds new projects as <code>dir</code> items in the <a href="/categories">project</a> category; it never removes one.</p>
      <form class="watch-add" method="post" action="/settings/project-parents"><label>Directory path<input name="path" required placeholder="~/proj"></label><button class="primary">Add and scan</button></form>
      <div class="watch-list">${projectParents.map(parent => `<div class="watch-row"><div class="watch-path"><code>${escapeHtml(parent.path)}</code><span class="watch-status">${parent.count} projects</span></div><span></span><form method="post" action="/settings/project-parents/${parent.id}/delete"><button class="danger" onclick="return confirm('Stop scanning this directory? Its projects stay in the library.')">Remove</button></form></div>`).join("")}</div>
      ${projectParents.length ? `<form method="post" action="/settings/project-parents/scan"><button>Scan now</button></form>` : ""}
    </section>
    <section class="settings-section">
      <h2>Pastry uploads</h2>
      <form class="editor" method="post" action="/settings">
        <label class="check"><input type="checkbox" name="pastry_enabled"${enabled ? " checked" : ""}> Enable Pastry uploads</label>
        <p class="settings-note">When enabled, every document page shows an <strong>Upload to Pastry</strong> button in its header. Uploads run <code>pastry create &lt;file&gt;</code> with your chosen file type and visibility.</p>
        <p class="settings-note${status.ok ? "" : " warn"}">Pastry CLI: ${escapeHtml(status.detail)}</p>
        <button class="primary">Save settings</button>
      </form>
    </section>`;
  return html(shell("Settings", body, "settings"), statusCode);
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

function portSiteUrl(entry) {
  const linkHost = !entry.host || ["*", "::", "0.0.0.0", "::1", "127.0.0.1", "localhost"].includes(entry.host) ? "localhost" : entry.host;
  const linkTarget = linkHost.includes(":") && !linkHost.startsWith("[") ? `[${linkHost}]` : linkHost;
  return `http://${linkTarget}:${entry.port}`;
}

function portTableCells(entry, relation) {
  const herdr = entry.herdr;
  const ai = entry.ai;
  const portCell = entry.port != null
    ? `<a href="${escapeHtml(portSiteUrl(entry))}" target="_blank" rel="noreferrer">${entry.port}</a>`
    : "<span class='ports-dim'>—</span>";
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
  const fullCommand = entry.command_line || entry.command || "";
  const relationBadge = relation ? ` <span class="ports-dim">· ${escapeHtml(relation)}</span>` : "";
  const uptime = entry.elapsed
    ? `<span title="${escapeHtml(entry.started_at ? `started ${entry.started_at}` : "")}">${escapeHtml(entry.elapsed)}</span>`
    : "<span class='ports-dim'>—</span>";
  return `<td class="ports-num">${portCell}</td>
      <td>${entry.host ? escapeHtml(entry.host) : "<span class='ports-dim'>—</span>"}</td>
      <td title="${escapeHtml(fullCommand)}">${escapeHtml(entry.command || "?")} <span class="ports-dim">#${entry.pid}</span>${relationBadge}</td>
      <td class="ports-uptime">${uptime}</td>
      <td class="ports-path" title="${escapeHtml(entry.cwd || "")}">${escapeHtml(entry.cwd || "—")}</td>
      <td title="${herdrTitle}">${herdrLabel}</td>
      <td title="${aiTitle}">${aiLabel}</td>`;
}

function portsPage() {
  const snapshot = getPortsSnapshot();
  const herdrBadge = snapshot.herdr_available
    ? `<span class="ports-badge ok">Herdr linked</span>`
    : `<span class="ports-badge warn">Herdr unavailable</span>`;
  const warnings = [...(snapshot.warnings ?? []), ...(snapshot.error ? [`scan error: ${snapshot.error}`] : [])];
  const rows = snapshot.ports.map(entry => {
    return `<tr>
      ${portTableCells(entry, null)}
      <td class="ports-actions"><a href="/ports/tree?pid=${entry.pid}&port=${entry.port}">Tree</a><button type="button" class="ports-kill" data-pid="${entry.pid}" data-port="${entry.port}" data-command="${escapeHtml(entry.command)}">Kill</button></td>
    </tr>`;
  }).join("");
  const body = `<section class="page-head"><h1>Ports</h1><p>${snapshot.ports.length} TCP listeners · scanned ${escapeHtml(snapshot.scanned_at ?? "")} · <a href="/api/ports">JSON</a></p></section>
    <p>${herdrBadge} <span class="ports-note">Process match = listener descends from the pane shell. A trailing ~ means same working directory only (e.g. this server runs under launchd, not Herdr).</span></p>
    ${warnings.length ? `<p class="settings-note warn">${warnings.map(escapeHtml).join("<br>")}</p>` : ""}
    ${snapshot.ports.length ? `<div class="ports-wrap"><table class="ports-table"><thead><tr><th>Port</th><th>Bind</th><th>Process</th><th>Uptime</th><th>Directory</th><th>Herdr pane</th><th>AI session</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    <script>document.querySelectorAll('.ports-kill').forEach(button=>button.addEventListener('click',async()=>{const label=button.dataset.command+' (#'+button.dataset.pid+') on port '+button.dataset.port;if(!confirm('Kill '+label+'? This sends SIGTERM to the process.'))return;button.disabled=true;try{const response=await fetch('/api/ports/kill',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pid:Number(button.dataset.pid)})});if(response.ok){location.reload();return}button.disabled=false;alert(await response.text())}catch(error){button.disabled=false;alert(String(error && error.message || error))}}));</script>` : `<div class="empty"><strong>No listeners found.</strong><span>The scanner reported zero TCP LISTEN sockets.</span></div>`}
    <style>.ports-table{width:100%;border-collapse:collapse;font-size:.82rem}.ports-table th{text-align:left;color:var(--text3);font-family:var(--mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;padding:.5rem;border-bottom:1px solid var(--border)}.ports-table td{padding:.5rem;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}.ports-num{font-family:var(--mono);font-weight:700}.ports-uptime{white-space:nowrap}.ports-path{max-width:22rem}.ports-dim{color:var(--text3)}.ports-badge{border:1px solid var(--border2);border-radius:999px;padding:.2rem .6rem;font-size:.72rem}.ports-badge.ok{color:var(--accent2)}.ports-badge.warn{color:var(--gold)}.ports-note{color:var(--text3);font-size:.78rem}.ports-wrap{overflow-x:auto}.ports-table code{color:var(--accent2)}.ports-actions{white-space:nowrap}.ports-actions a{margin-right:.6rem}.ports-kill{color:#ff7b72;background:none;border:1px solid var(--border2);border-radius:6px;padding:.15rem .55rem;cursor:pointer;font-size:.78rem}.ports-kill:disabled{opacity:.5;cursor:default}</style>`;
  return html(shell("Ports", body, "ports"));
}

function findPortEntry(snapshot, pid, port) {
  const matches = (snapshot.ports ?? []).filter(entry => entry.pid === pid);
  if (!matches.length) return null;
  if (port != null && Number.isInteger(port)) {
    return matches.find(entry => entry.port === port) ?? matches[0];
  }
  return matches[0];
}

function portsTreePage(url) {
  const pid = Number(url.searchParams.get("pid"));
  const portParam = url.searchParams.get("port");
  const port = portParam == null || portParam === "" ? null : Number(portParam);
  if (!Number.isInteger(pid) || pid <= 0) return text("invalid pid", 422);
  if (port !== null && (!Number.isInteger(port) || port <= 0)) return text("invalid port", 422);
  const snapshot = getPortsSnapshot();
  const entry = findPortEntry(snapshot, pid, port);
  if (!entry) return text("no TCP listener found for that pid", 404);
  const herdr = entry.herdr;
  const ai = entry.ai;
  const portUrl = portSiteUrl(entry);
  const tree = Array.isArray(entry.tree) && entry.tree.length
    ? entry.tree
    : [{ pid: entry.pid, ppid: entry.ppid, command: entry.command_line || entry.command, cwd: entry.cwd || "", ports: [{ host: entry.host, port: entry.port }] }];
  const children = Array.isArray(entry.children) ? entry.children : [];
  const parentPid = tree[0]?.ppid;
  const reparentedToInit = parentPid === 1 || parentPid === 0;
  const ownership = herdr?.match === "process"
    ? `Descends from the Herdr shell (PID ${herdr.shell_pid ?? "?"}) — still owned by pane ${herdr.pane_id ?? ""}.`
    : herdr
      ? `Herdr pane ${herdr.pane_id ?? ""} matched by working directory only (~) — the process does not descend from the pane shell, so it may have been started outside Herdr or orphaned.`
      : reparentedToInit
        ? `Direct child of PID 1 (launchd): daemonized or orphaned — its parent exited and it was reparented to init.`
        : `No Herdr pane attributed to this process.`;
  const sessionLine = ai?.session
    ? `AI session: ${escapeHtml(ai.kind ?? "unknown")} <code>${escapeHtml(ai.session)}</code> <span class="ports-dim">(${escapeHtml(ai.source ?? "herdr")}${herdr?.agent_status ? ` · agent ${escapeHtml(herdr.agent_status)}` : ""})</span>`
    : ai?.kind
      ? `AI hint: ${escapeHtml(ai.kind)} <span class="ports-dim">${escapeHtml(ai.hint ?? ai.source ?? "")}</span> — no live session id, likely a leftover child.`
      : `No AI session attributed — no agent owns this process.`;
  const describe = (node, relation) => {
    const match = findPortEntry(snapshot, node.pid, null);
    if (match && match !== entry) return { row: match, relation: `${relation} · also listening` };
    if (match) return { row: match, relation };
    const argv0 = String(node.command || "").split(/\s+/)[0] || "";
    const fallbackPort = (node.ports ?? [])[0];
    return {
      row: {
        port: fallbackPort?.port ?? null,
        host: fallbackPort?.host ?? "",
        command: argv0.split("/").pop() || "?",
        command_line: node.command || "",
        pid: node.pid,
        cwd: node.cwd || "",
        elapsed: node.elapsed ?? null,
        elapsed_secs: node.elapsed_secs ?? null,
        started_at: node.started_at ?? null,
        herdr: node.pid === herdr?.shell_pid ? herdr : null,
        ai: null,
      },
      relation,
    };
  };
  const head = `<thead><tr><th>Port</th><th>Bind</th><th>Process</th><th>Uptime</th><th>Directory</th><th>Herdr pane</th><th>AI session</th></tr></thead>`;
  const treeRows = tree.map((node, level) => {
    if (level === 0) return `<tr>${portTableCells(entry, "listener")}</tr>`;
    const { row, relation } = describe(node, "parent");
    return `<tr>${portTableCells(row, relation)}</tr>`;
  }).join("");
  const childRows = children.length
    ? children.map(child => {
      const { row, relation } = describe(child, "child");
      return `<tr>${portTableCells(row, relation)}</tr>`;
    }).join("")
    : "";
  const body = `<section class="page-head"><p><a href="/ports">← Ports</a></p><h1>Process tree · PID ${entry.pid}</h1><p><a href="${escapeHtml(portUrl)}" target="_blank" rel="noreferrer">Open ${escapeHtml(portUrl)}</a> · ${escapeHtml(entry.command)} · ${escapeHtml(entry.command_line || "")}</p></section>
    <p>${escapeHtml(ownership)}</p>
    <p>${sessionLine}</p>
    <section><h2>Listener + parents</h2><div class="ports-wrap"><table class="ports-table">${head}<tbody>${treeRows}</tbody></table></div></section>
    <section><h2>Children <span class="ports-dim">(direct)</span></h2>${children.length ? `<div class="ports-wrap"><table class="ports-table">${head}<tbody>${childRows}</tbody></table></div>` : `<div class="empty"><strong>No child processes.</strong></div>`}</section>
    <p><button type="button" class="ports-kill" data-pid="${entry.pid}" data-port="${entry.port}" data-command="${escapeHtml(entry.command)}">Kill PID ${entry.pid} (SIGTERM)</button></p>
    <script>document.querySelectorAll('.ports-kill').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Kill '+button.dataset.command+' (#'+button.dataset.pid+') on port '+button.dataset.port+'? This sends SIGTERM to the process.'))return;button.disabled=true;try{const response=await fetch('/api/ports/kill',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pid:Number(button.dataset.pid)})});if(response.ok){location.href='/ports';return}button.disabled=false;alert(await response.text())}catch(error){button.disabled=false;alert(String(error && error.message || error))}}));</script>
    <style>.ports-table{width:100%;border-collapse:collapse;font-size:.82rem}.ports-table th{text-align:left;color:var(--text3);font-family:var(--mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;padding:.5rem;border-bottom:1px solid var(--border)}.ports-table td{padding:.5rem;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}.ports-num{font-family:var(--mono);font-weight:700}.ports-uptime{white-space:nowrap}.ports-path{max-width:22rem}.ports-dim{color:var(--text3)}.ports-wrap{overflow-x:auto}.ports-table code{color:var(--accent2)}.ports-kill{color:#ff7b72;background:none;border:1px solid var(--border2);border-radius:6px;padding:.3rem .7rem;cursor:pointer;font-size:.8rem}.ports-kill:disabled{opacity:.5;cursor:default}</style>`;
  return html(shell(`Process ${entry.pid} · Ports`, body, "ports"));
}

async function killPortProcess(request) {
  let payload = {};
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = { pid: form.get("pid"), signal: form.get("signal") };
    }
  } catch {
    return text("invalid request body", 400);
  }
  const pid = Number(payload.pid);
  if (!Number.isInteger(pid) || pid <= 1) return text("invalid pid", 422);
  if (pid === process.pid) return text("refusing to kill the portfolio server itself", 403);
  const signal = String(payload.signal ?? "TERM").toUpperCase() === "KILL" ? "SIGKILL" : "SIGTERM";
  const snapshot = getPortsSnapshot();
  if (snapshot.error && !(snapshot.ports ?? []).length) return text(`cannot verify listeners: ${snapshot.error}`, 502);
  if (!findPortEntry(snapshot, pid, null)) return text("pid is not a current TCP listener", 404);
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code === "ESRCH") return text("no such process", 404);
    if (error?.code === "EPERM") return text("no permission to signal that process", 403);
    return text(`failed to signal process: ${error?.message ?? error}`, 500);
  }
  return Response.json({ ok: true, pid, signal });
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
  const label = ({ note: "note", pr: "PR", link: "link" })[type] || "item";
  return `<section class="rail-section"><header><h2>${title}</h2><div class="rail-heading-actions"><span>${items.length}</span><button type="button" class="rail-add" data-add-type="${type}" aria-label="Add ${label}" title="Add ${label}">+</button></div></header><div class="rail-items">${items.map(item => {
    const external = ["link", "pr"].includes(item.type) ? ` target="_blank" rel="noreferrer"` : "";
    return `<article class="rail-item${item.pinned ? " is-pinned" : ""}${item.starred ? " is-starred" : ""}"><a href="${escapeHtml(itemHref(item))}"${external}>${escapeHtml(item.title)}</a>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}<div><time>${escapeHtml(item.created_at.slice(0, 10))}</time>${item.pinned ? `<span>Pinned</span>` : ""}${item.starred ? `<span>Starred</span>` : ""}</div></article>`;
  }).join("") || `<div class="rail-empty">No ${title.toLowerCase()} yet.</div>`}</div></section>`;
}


function shell(title, body, active = "all") {
  const nav = [["all", "/", "Library"], ["tasks", "/tasks", "Tasks"], ["starred", "/starred", "Starred"], ["tags", "/tags", "Tags"], ["portfolios", "/portfolios", "Portfolios"], ["categories", "/categories", "Categories"], ["ports", "/ports", "Ports"], ["new", "/new", "Add"], ["settings", "/settings", "Settings"]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Portfolios</title><link rel="stylesheet" href="/assets/app.css"></head><body>
    <header class="topbar"><a class="brand" href="/">丸の中で</a><nav>${nav.map(([key, href, label]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("")}</nav></header>
    <div class="add-bar"><button type="button" class="add-open" data-add-type="" aria-label="Add an item">+ Add</button><span>Paste a URL, a path, or Markdown. The type is detected as you type.</span></div>
    <main>${body}</main>
    <div class="item-modal" data-item-modal hidden>
      <div class="item-modal-card" role="dialog" aria-modal="true" aria-labelledby="item-modal-title">
        <div class="item-modal-head"><div><p class="eyebrow">Quick add</p><h2 id="item-modal-title">Add item</h2></div><button type="button" class="item-modal-close" data-item-modal-close aria-label="Close">×</button></div>
        <form class="item-modal-form" data-quick-form>
          <textarea name="content" rows="7" placeholder="https://…  or  ~/proj/thing  or  # A note" aria-label="Content" data-quick-content></textarea>
          <div class="quick-detect"><span class="kind" data-quick-kind>NOTE</span><span data-quick-title>Untitled</span><span class="quick-warn" data-quick-warn></span></div>
          <div class="quick-row">
            <label>Type<select name="type" data-quick-type><option value="">Detected</option>${ITEM_TYPES.map(type => `<option value="${type}">${type}</option>`).join("")}</select></label>
            <label>Tags<input name="tags" placeholder="architecture, ruby"></label>
            <button type="button" class="quiet" data-quick-pick aria-expanded="false">Pick file or folder…</button>
          </div>
          <div class="quick-browser" data-quick-browser hidden><div class="directory-browser-head"><code data-quick-path></code><button type="button" data-quick-up>Up</button></div><div class="directory-browser-list" data-quick-list></div></div>
          <p class="quick-error" data-quick-error role="alert"></p>
          <div class="item-modal-actions"><button type="button" class="quiet" data-item-modal-close>Cancel</button><button class="primary" data-quick-submit>Add item</button></div>
        </form>
      </div>
    </div><script>
      const itemModal=document.querySelector('[data-item-modal]');
      const quick={form:itemModal.querySelector('[data-quick-form]'),content:itemModal.querySelector('[data-quick-content]'),type:itemModal.querySelector('[data-quick-type]'),kind:itemModal.querySelector('[data-quick-kind]'),title:itemModal.querySelector('[data-quick-title]'),warn:itemModal.querySelector('[data-quick-warn]'),error:itemModal.querySelector('[data-quick-error]'),browser:itemModal.querySelector('[data-quick-browser]'),path:itemModal.querySelector('[data-quick-path]'),list:itemModal.querySelector('[data-quick-list]'),pick:itemModal.querySelector('[data-quick-pick]'),up:itemModal.querySelector('[data-quick-up]'),submit:itemModal.querySelector('[data-quick-submit]')};
      const kindLabel=type=>({document:'DOC',note:'NOTE',link:'LINK',pr:'PR',file:'FILE',dir:'DIR'})[type]||type.toUpperCase();
      let detectTimer,detectRequest=0,browsePath='';
      const showKind=()=>{quick.kind.textContent=kindLabel(quick.type.value||quick.kind.dataset.detected||'note')};
      const detect=async()=>{const id=++detectRequest;const data=await(await fetch('/api/detect?'+new URLSearchParams({content:quick.content.value}))).json();if(id!==detectRequest)return;quick.kind.dataset.detected=data.type;quick.title.textContent=data.title||'';quick.warn.textContent=data.error?data.error:(data.exists===false?'not on disk yet':'');showKind()};
      quick.content.addEventListener('input',()=>{clearTimeout(detectTimer);detectTimer=setTimeout(detect,150)});
      quick.type.addEventListener('change',showKind);
      const openItemModal=type=>{quick.form.reset();quick.type.value=type||'';quick.error.textContent='';quick.browser.hidden=true;quick.pick.setAttribute('aria-expanded','false');itemModal.hidden=false;detect();quick.content.focus()};
      document.querySelectorAll('[data-add-type]').forEach(button=>button.addEventListener('click',()=>openItemModal(button.dataset.addType)));
      document.querySelectorAll('[data-item-modal-close]').forEach(button=>button.addEventListener('click',()=>{itemModal.hidden=true}));
      itemModal.addEventListener('click',event=>{if(event.target===itemModal)itemModal.hidden=true});
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!itemModal.hidden)itemModal.hidden=true;if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&event.target===quick.content)quick.form.requestSubmit()});
      const browse=async path=>{const response=await fetch('/api/settings/directories?'+new URLSearchParams({path,files:'1'}));const data=await response.json().catch(()=>({}));if(!response.ok){quick.error.textContent=data.error||'Could not read that directory.';return}browsePath=data.path;quick.path.textContent=data.path;quick.up.disabled=!data.parent;quick.list.replaceChildren(...[...data.directories.map(entry=>({...entry,dir:true})),...data.files].map(entry=>{const row=document.createElement('button');row.type='button';row.className='directory-browser-row';row.textContent=(entry.dir?'📁 ':'📄 ')+entry.name;row.addEventListener('click',()=>{if(entry.dir){browse(entry.path)}else{choose(entry.path)}});return row}));const pickHere=document.createElement('button');pickHere.type='button';pickHere.className='directory-browser-row quick-choose';pickHere.textContent='Use this folder';pickHere.addEventListener('click',()=>choose(browsePath));quick.list.prepend(pickHere)};
      const choose=path=>{quick.content.value=path;quick.browser.hidden=true;quick.pick.setAttribute('aria-expanded','false');detect();quick.content.focus()};
      quick.pick.addEventListener('click',()=>{const open=quick.browser.hidden;quick.browser.hidden=!open;quick.pick.setAttribute('aria-expanded',String(open));if(open)browse(browsePath||'${escapeHtml(process.env.HOME ?? "/")}')});
      quick.up.addEventListener('click',()=>{if(browsePath)browse(browsePath.slice(0,browsePath.lastIndexOf('/'))||'/')});
      quick.form.addEventListener('submit',async event=>{event.preventDefault();quick.submit.disabled=true;quick.error.textContent='';const response=await fetch('/items/quick',{method:'POST',body:new FormData(quick.form)});if(response.ok)location.reload();else{quick.error.textContent=await response.text();quick.submit.disabled=false}});
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
  if (forced.category) { where.push("items.category_id = ?"); params.push(forced.category); }
  if (pinned) where.push("items.pinned = 1");
  if (starred) where.push("items.starred = 1");
  if (type && ITEM_TYPES.includes(type)) { where.push("items.type = ?"); params.push(type); }
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
  const typeFilter = options.rails ? "" : `<select name="type" aria-label="Item type"><option value="">All types</option>${ITEM_TYPES.map(type => `<option${url.searchParams.get("type") === type ? " selected" : ""}>${type}</option>`).join("")}</select>`;
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

const CARD_SORTS = { created_at: "datetime(items.created_at)", updated_at: "datetime(items.updated_at)", title: "items.title COLLATE NOCASE", type: "items.type" };
const CARD_SORT_LABELS = { created_at: "Created", updated_at: "Updated", title: "Title", type: "Type" };
const placeholders = values => values.map(() => "?").join(", ");

function portfolioCards(portfolioId) {
  return db.query("SELECT * FROM cards WHERE portfolio_id = ? ORDER BY position, id").all(portfolioId)
    .map(card => ({ ...card, tags: JSON.parse(card.tags), types: JSON.parse(card.types) }));
}

// Tags are OR-ed together; types narrow that set. An empty list means "any".
function cardItems(card) {
  const where = ["1=1"], params = [];
  if (card.tags.length) {
    where.push(`items.id IN (SELECT taggings.item_id FROM taggings JOIN tags ON tags.id = taggings.tag_id WHERE tags.name IN (${placeholders(card.tags)}))`);
    params.push(...card.tags);
  }
  if (card.types.length) { where.push(`items.type IN (${placeholders(card.types)})`); params.push(...card.types); }
  const from = `FROM items WHERE ${where.join(" AND ")}`;
  const total = db.query(`SELECT count(*) count ${from}`).get(...params).count;
  const items = db.query(`SELECT items.id, items.type, items.title, items.description, items.url, items.source_path, items.pinned, items.starred, items.created_at, items.updated_at, items.content != '' content
    ${from} ORDER BY ${CARD_SORTS[card.sort_key]} ${card.sort_dir === "asc" ? "ASC" : "DESC"}, items.id DESC LIMIT ?`).all(...params, card.max_items);
  return { total, items };
}

function cardFields(form) {
  const sortKey = field(form, "sort_key");
  const types = ITEM_TYPES.filter(type => form.getAll("types").includes(type));
  return {
    title: field(form, "title"),
    tags: JSON.stringify([...new Set(field(form, "tags").split(",").map(value => value.trim()).filter(Boolean))]),
    types: JSON.stringify(types.length === ITEM_TYPES.length ? [] : types),
    sortKey: Object.hasOwn(CARD_SORTS, sortKey) ? sortKey : "created_at",
    sortDir: field(form, "sort_dir") === "asc" ? "asc" : "desc",
    maxItems: Math.min(Math.max(Number.parseInt(field(form, "max_items"), 10) || 100, 1), 1000),
  };
}

function moveCard(card, direction) {
  const neighbor = direction === "left"
    ? db.query("SELECT id, position FROM cards WHERE portfolio_id = ? AND position < ? ORDER BY position DESC LIMIT 1").get(card.portfolio_id, card.position)
    : db.query("SELECT id, position FROM cards WHERE portfolio_id = ? AND position > ? ORDER BY position LIMIT 1").get(card.portfolio_id, card.position);
  if (!neighbor) return;
  const setPosition = db.query("UPDATE cards SET position = ? WHERE id = ?");
  db.transaction(() => { setPosition.run(neighbor.position, card.id); setPosition.run(card.position, neighbor.id); })();
}

function cardForm(action, card, submitLabel) {
  return `<form class="card-form" method="post" action="${action}">
    <label>Title<input name="title" required value="${escapeHtml(card.title)}"></label>
    <label>Tags — matches any<input name="tags" value="${escapeHtml(card.tags.join(", "))}" placeholder="yt, slides"></label>
    <div class="card-types"><span>Types — none checked means every type</span>${ITEM_TYPES.map(type => `<label><input type="checkbox" name="types" value="${type}"${card.types.includes(type) ? " checked" : ""}> ${type}</label>`).join("")}</div>
    <div class="card-form-row">
      <label>Sort by<select name="sort_key">${Object.entries(CARD_SORT_LABELS).map(([key, label]) => `<option value="${key}"${card.sort_key === key ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <label>Direction<select name="sort_dir"><option value="desc"${card.sort_dir === "desc" ? " selected" : ""}>Descending</option><option value="asc"${card.sort_dir === "asc" ? " selected" : ""}>Ascending</option></select></label>
      <label>Max items<input name="max_items" inputmode="numeric" value="${card.max_items}"></label>
    </div>
    <button class="primary">${submitLabel}</button>
  </form>`;
}

function cardSection(card) {
  const { total, items } = cardItems(card);
  const rows = items.map(item => {
    const external = ["link", "pr"].includes(item.type) ? ` target="_blank" rel="noreferrer"` : "";
    return `<article class="rail-item${item.pinned ? " is-pinned" : ""}${item.starred ? " is-starred" : ""}"><a href="${escapeHtml(itemHref(item))}"${external}>${escapeHtml(item.title)}</a>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}<div><span class="kind">${icon(item.type)}</span><time>${escapeHtml(item[card.sort_key === "updated_at" ? "updated_at" : "created_at"].slice(0, 10))}</time>${item.pinned ? `<span>Pinned</span>` : ""}${item.starred ? `<span>Starred</span>` : ""}</div></article>`;
  }).join("") || `<div class="rail-empty">Nothing matches this card yet.</div>`;
  const query = [...card.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`), ...card.types.map(type => `<span class="kind">${icon(type)}</span>`)].join("") || `<span>everything</span>`;
  return `<section class="rail-section portfolio-card" data-card="${card.id}">
    <header><h2>${escapeHtml(card.title)}</h2><div class="rail-heading-actions"><span>${total > items.length ? `${items.length} of ${total}` : total}</span></div></header>
    <div class="card-query">${query}<span class="card-sort">${CARD_SORT_LABELS[card.sort_key]} ${card.sort_dir === "asc" ? "↑" : "↓"}</span></div>
    <div class="rail-items">${rows}</div>
    <details class="card-edit"><summary>Edit card</summary>${cardForm(`/cards/${card.id}`, card, "Save card")}
      <div class="card-actions">
        <form method="post" action="/cards/${card.id}/move"><button name="direction" value="left" title="Move earlier">←</button><button name="direction" value="right" title="Move later">→</button></form>
        <form method="post" action="/cards/${card.id}/delete"><button class="danger">Delete card</button></form>
      </div>
    </details>
  </section>`;
}

function portfoliosPage() {
  const portfolios = db.query("SELECT portfolios.*, count(cards.id) card_count FROM portfolios LEFT JOIN cards ON cards.portfolio_id = portfolios.id GROUP BY portfolios.id ORDER BY portfolios.name").all();
  const list = portfolios.map(portfolio => `<a class="portfolio-row" href="/portfolios/${portfolio.id}"><strong>${escapeHtml(portfolio.name)}</strong><span>${escapeHtml(portfolio.description)}</span><em>${portfolio.card_count} ${portfolio.card_count === 1 ? "card" : "cards"}</em></a>`).join("")
    || `<div class="empty"><strong>No portfolios yet.</strong><span>Name one below, then add cards to it.</span></div>`;
  return shell("Portfolios", `<section class="page-head"><h1>Portfolios</h1><p>Pages of cards, each card a saved query over your items.</p></section>
    <div class="portfolio-list">${list}</div>
    <form class="editor" method="post" action="/portfolios"><label>Name<input name="name" required></label><label>Description<input name="description"></label><button class="primary">Add portfolio</button></form>`, "portfolios");
}

function portfolioPage(portfolio) {
  const cards = portfolioCards(portfolio.id);
  const blank = { title: "", tags: [], types: [], sort_key: "created_at", sort_dir: "desc", max_items: 100 };
  return shell(portfolio.name, `<div class="library-shell"><section class="page-head"><h1>${escapeHtml(portfolio.name)}</h1><p>${escapeHtml(portfolio.description)}</p></section>
    <div class="portfolio-grid">${cards.map(cardSection).join("")}
      <section class="rail-section portfolio-card"><details class="card-edit"${cards.length ? "" : " open"}><summary>+ Add card</summary>${cardForm(`/portfolios/${portfolio.id}/cards`, blank, "Add card")}</details></section>
    </div>
    <details class="portfolio-manage"><summary>Manage portfolio</summary>
      <form class="editor" method="post" action="/portfolios/${portfolio.id}"><label>Name<input name="name" required value="${escapeHtml(portfolio.name)}"></label><label>Description<input name="description" value="${escapeHtml(portfolio.description)}"></label><button class="primary">Save portfolio</button></form>
      <div class="danger-zone"><form method="post" action="/portfolios/${portfolio.id}/delete" onsubmit="return confirm('Delete this portfolio and its cards? Items are kept.')"><button class="danger">Delete portfolio</button></form></div>
    </details></div>`, "portfolios");
}

const PATH_ACTIONS = { copy: "Copy path", reveal: "Reveal in Finder", open: "Open" };
const PROJECT_SCAN_DEPTH = 4;
const expandPath = value => value === "~" ? (process.env.HOME ?? "") : value.startsWith("~/") ? join(process.env.HOME ?? "", value.slice(2)) : value;
const abbreviatePath = path => process.env.HOME && path.startsWith(process.env.HOME + sep) ? `~${path.slice(process.env.HOME.length)}` : path;

// A file or dir item does not have to exist on disk, so this never stats it.
function normalizeItemPath(value) {
  const path = expandPath(value);
  if (!isAbsolute(path)) throw new Error("path must be absolute or start with ~/");
  return resolve(path);
}

function listCategories() {
  return db.query("SELECT categories.*, count(items.id) member_count FROM categories LEFT JOIN items ON items.category_id = categories.id GROUP BY categories.id ORDER BY categories.name").all()
    .map(category => ({ ...category, slots: JSON.parse(category.slots) }));
}

// One slot per line: name | file or dir | path
function parseSlots(value) {
  const slots = value.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const [name, kind, path] = line.split("|").map(part => part.trim());
    if (!name || !PATH_TYPES.includes(kind) || !path) throw new Error(`slot "${line}" must read: name | file or dir | path`);
    return { name, kind, path };
  });
  if (new Set(slots.map(slot => slot.name.toLowerCase())).size !== slots.length) throw new Error("slot names must be unique");
  return slots;
}
const formatSlots = slots => slots.map(slot => `${slot.name} | ${slot.kind} | ${slot.path}`).join("\n");

// Slots are never stored per member. A relative slot path hangs off the member's
// own path; an absolute or ~/ path stands alone; a member can override either.
function memberSlots(item) {
  if (!item.category_id) return [];
  const overrides = JSON.parse(item.slot_paths);
  return JSON.parse(db.query("SELECT slots FROM categories WHERE id = ?").get(item.category_id).slots).map(slot => {
    const expanded = expandPath(overrides[slot.name] || slot.path);
    const path = isAbsolute(expanded) ? resolve(expanded) : item.path ? resolve(item.path, expanded) : null;
    return { ...slot, path, overridden: Boolean(overrides[slot.name]), exists: Boolean(path) && existsSync(path) };
  });
}

// Every file and dir shares these, whether it is an item or a slot. Copying
// works on a path that does not exist; reveal and open make it first.
async function runPathAction(action, target) {
  if (action === "copy") {
    const pbcopy = Bun.spawn([PBCOPY_BIN], { stdin: "pipe" });
    pbcopy.stdin.write(target.path);
    pbcopy.stdin.end();
    await pbcopy.exited;
    return;
  }
  if (!existsSync(target.path)) {
    await mkdir(target.kind === "dir" ? target.path : dirname(target.path), { recursive: true });
    if (target.kind === "file") await writeFile(target.path, "");
  }
  await Bun.spawn([OPEN_BIN, ...(action === "reveal" ? ["-R"] : []), target.path]).exited;
}

function pathRow(item, label, target, slotName = "") {
  const actions = target.path ? `<form class="path-actions" method="post" action="/items/${item.id}/path-action"><input type="hidden" name="slot" value="${escapeHtml(slotName)}">${Object.entries(PATH_ACTIONS).map(([action, text]) => `<button name="action" value="${action}">${text}</button>`).join("")}</form>` : "";
  const override = slotName ? `<details class="slot-override"><summary>Change path</summary><form method="post" action="/items/${item.id}/slot-path"><input type="hidden" name="slot" value="${escapeHtml(slotName)}"><input name="path" value="${target.overridden ? escapeHtml(abbreviatePath(target.path)) : ""}" placeholder="Blank uses the category's path" aria-label="Path for ${escapeHtml(slotName)}"><button>Save</button></form></details>` : "";
  return `<div class="path-row"><div class="path-label"><strong>${escapeHtml(label)}</strong><span class="kind">${icon(target.kind)}</span>${target.exists ? "" : `<span class="path-missing">${target.path ? "not created yet" : "needs an absolute path"}</span>`}</div>
    <code>${escapeHtml(target.path ? abbreviatePath(target.path) : "")}</code>${actions}${override}</div>`;
}

function slotsSection(item) {
  const slots = memberSlots(item);
  if (!slots.length) return "";
  return `<section class="manage-tags"><h2>${escapeHtml(db.query("SELECT name FROM categories WHERE id = ?").get(item.category_id).name)} slots</h2><div class="path-list">${slots.map(slot => pathRow(item, slot.name, slot, slot.name)).join("")}</div></section>`;
}

function pathItemPage(item) {
  const category = item.category_id ? db.query("SELECT * FROM categories WHERE id = ?").get(item.category_id) : null;
  const tags = tagsFor(item.id);
  return shell(item.title, `<section class="detail-head"><a href="${category ? `/categories/${category.id}` : "/"}">${category ? `All ${escapeHtml(category.name)} items` : "Back to library"}</a><h1>${escapeHtml(item.title)}</h1>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
      ${tags.length ? `<div class="tag-list">${tags.map(tag => `<a class="tag" href="/tags/${tag.id}">${escapeHtml(tag.name)}</a>`).join("")}</div>` : ""}</section>
    <div class="path-list">${pathRow(item, item.type === "dir" ? "Directory" : "File", { kind: item.type, path: item.path, exists: existsSync(item.path) })}</div>
    ${slotsSection(item)}
    <p class="settings-note"><a href="/items/${item.id}/manage">Edit this item</a></p>`, category ? "categories" : "all");
}

function categoriesPage() {
  const categories = listCategories();
  const form = (action, category, label) => `<form class="editor" method="post" action="${action}"><label>Name<input name="name" required value="${escapeHtml(category.name)}"></label>
    <label>Kind of item<select name="kind">${ITEM_TYPES.map(type => `<option${category.kind === type ? " selected" : ""}>${type}</option>`).join("")}</select></label>
    <label>Slots — one per line: name | file or dir | path<textarea name="slots" rows="4" placeholder="tasks | file | TASKS.md&#10;logs | dir | ~/Library/Logs/thing">${escapeHtml(formatSlots(category.slots))}</textarea></label><button class="primary">${label}</button></form>`;
  const list = categories.map(category => `<details><summary><span>${escapeHtml(category.name)} <span class="kind">${icon(category.kind)}</span></span><strong>${category.member_count}</strong></summary><div>
      <p class="settings-note"><a href="/categories/${category.id}">Show all ${category.member_count} ${escapeHtml(category.name)} items</a></p>${form(`/categories/${category.id}`, category, "Save category")}
      <div class="danger-zone"><form method="post" action="/categories/${category.id}/delete" onsubmit="return confirm('Delete this category? Its items are kept, without a category.')"><button class="danger">Delete category</button></form></div>
    </div></details>`).join("") || `<div class="empty"><strong>No categories yet.</strong><span>Define one below.</span></div>`;
  return shell("Categories", `<section class="page-head"><h1>Categories</h1><p>What every item of a kind has. A slot is a file or dir each member gets, created or not.</p></section>
    <div class="accordions">${list}</div><section class="manage-tags"><h2>Add a category</h2>${form("/categories", { name: "", kind: "dir", slots: [] }, "Add category")}</section>`, "categories");
}

function categoryFields(form) {
  const name = field(form, "name"), kind = field(form, "kind");
  if (!name) throw new Error("name is required");
  if (!ITEM_TYPES.includes(kind)) throw new Error("invalid kind");
  return [name, kind, JSON.stringify(parseSlots(String(form.get("slots") ?? "")))];
}

// A project is any direct child of a parent dir, or a deeper dir with .git at
// its top level. The walk stops at a repository, so it never crawls a monorepo.
async function discoverProjects(parent) {
  const found = [];
  async function walk(directory, depth) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      const repository = existsSync(join(path, ".git"));
      if (depth === 1 || repository) found.push(path);
      if (!repository && depth < PROJECT_SCAN_DEPTH) await walk(path, depth + 1);
    }
  }
  await walk(parent, 1);
  return found;
}

async function scanProjects() {
  const parents = db.query("SELECT path FROM project_parents ORDER BY path").all();
  if (!parents.length) return;
  db.query("INSERT INTO categories(name, kind, slots) VALUES ('project', 'dir', ?) ON CONFLICT(name) DO NOTHING").run(JSON.stringify([{ name: "tasks", kind: "file", path: "TASKS.md" }]));
  const category = db.query("SELECT id FROM categories WHERE name = 'project'").get();
  const tracked = db.query("SELECT 1 FROM items WHERE path = ?");
  const insert = db.query("INSERT INTO items(type, title, description, path, category_id) VALUES ('dir', ?, ?, ?, ?) RETURNING id");
  for (const parent of parents) {
    for (const path of await discoverProjects(parent.path)) {
      if (tracked.get(path)) continue;
      setTags(insert.get(basename(path), abbreviatePath(path), path, category.id).id, ["project"]);
    }
  }
}

// Reads what only file, dir, and categorized items carry: { path, categoryId } or { error }.
function pathAndCategory(type, form, itemId = 0) {
  let path = null;
  try { if (PATH_TYPES.includes(type)) path = normalizeItemPath(field(form, "path")); } catch (error) { return { error: error.message }; }
  if (path && db.query("SELECT 1 FROM items WHERE path = ? AND id != ?").get(path, itemId)) return { error: "another item already tracks that path" };
  const categoryName = field(form, "category");
  const category = categoryName ? db.query("SELECT id, kind FROM categories WHERE name = ?").get(categoryName) : null;
  if (categoryName && !category) return { error: `no category named "${categoryName}"` };
  if (category && category.kind !== type) return { error: `category "${categoryName}" holds ${category.kind} items` };
  return { path, categoryId: category?.id ?? null };
}
const setPathAndCategory = db.query("UPDATE items SET path = ?, category_id = ? WHERE id = ?");

const categorySelect = selectedId => `<label>Category<select name="category"><option value="">None</option>${listCategories().map(category => `<option value="${escapeHtml(category.name)}"${category.id === selectedId ? " selected" : ""}>${escapeHtml(category.name)} (${category.kind})</option>`).join("")}</select></label>`;

// What a pasted or picked thing is. Shape says which field the text fills;
// type is the guess, which the form can override.
//   url  → link, or pr when the URL points at a pull/merge request
//   path → dir when it is one on disk, document for .md/.html, else file
//   text → note
async function detectType(raw) {
  const content = raw.trim();
  const line = content.split("\n").length === 1 ? content : "";
  if (/^https?:\/\/\S+$/.test(line)) {
    const pr = line.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/) || line.match(/\/(?:pull|merge_requests)\/(\d+)/);
    const url = new URL(line);
    return { shape: "url", type: pr ? "pr" : "link", url: line, title: pr ? (pr[2] ? `${pr[1]}#${pr[2]}` : `${url.hostname}${url.pathname}`) : (url.hostname + url.pathname).replace(/\/$/, "") };
  }
  if (/^(~\/|\/)/.test(line)) {
    const path = normalizeItemPath(line);
    const info = await stat(path).catch(() => null);
    const importable = [".md", ".markdown", ".html"].includes(extname(path).toLowerCase());
    return { shape: "path", type: info?.isDirectory() ? "dir" : importable ? "document" : "file", path, exists: Boolean(info), title: info?.isDirectory() || !importable ? basename(path) : basename(path, extname(path)) };
  }
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || content.split("\n").map(value => value.trim()).find(Boolean) || "Untitled";
  return { shape: "text", type: "note", content, title: title.slice(0, 80) };
}

// Imports a Markdown or HTML file as a tracked document, the way mdoc does. An
// HTML file also gets a file item, so it has the path actions.
async function importDocument(path) {
  const content = await Bun.file(path).text();
  const isHtml = isHtmlPath(path);
  const title = documentTitle(content, path);
  let id;
  db.transaction(() => {
    id = upsertItem({ type: "document", title, description: "", content: isHtml ? "" : content, rendered_html: isHtml ? content : "", url: null, source_path: path, toc: 1 });
    if (!isHtml) db.query("UPDATE items SET rendered_html = ? WHERE id = ?").run(renderMarkdown(content, title, true, path), id);
  })();
  if (isHtml && !db.query("SELECT 1 FROM items WHERE path = ?").get(path)) db.query("INSERT INTO items(type, title, path) VALUES ('file', ?, ?)").run(basename(path), path);
  return id;
}

async function quickAdd(request) {
  const form = await request.formData();
  const detected = await detectType(String(form.get("content") ?? ""));
  const type = field(form, "type") || detected.type;
  if (!ITEM_TYPES.includes(type)) return text("invalid item type", 422);
  const tags = field(form, "tags").split(",").map(value => value.trim()).filter(Boolean);
  const insert = extra => upsertItem({ description: "", content: "", rendered_html: "", url: null, source_path: null, toc: 1, title: detected.title, ...extra });
  let id;
  if (["link", "pr"].includes(type)) {
    if (detected.shape !== "url") return text(`a ${type === "pr" ? "PR" : "link"} needs a URL`, 422);
    id = insert({ type, url: detected.url });
  } else if (PATH_TYPES.includes(type)) {
    if (detected.shape !== "path") return text(`a ${type} needs an absolute path`, 422);
    if (db.query("SELECT 1 FROM items WHERE path = ?").get(detected.path)) return text("another item already tracks that path", 422);
    id = insert({ type });
    setPathAndCategory.run(detected.path, null, id);
  } else if (type === "document" && detected.shape === "path") {
    if (!detected.exists) return text("that file does not exist yet", 422);
    id = await importDocument(detected.path);
  } else {
    if (detected.shape !== "text") return text(`a ${type} needs some text`, 422);
    id = insert({ type, content: detected.content, rendered_html: type === "task" ? "" : renderMarkdown(detected.content, detected.title, true) });
  }
  setTags(id, tags);
  return { id, href: itemHref(db.query("SELECT * FROM items WHERE id = ?").get(id)), type, title: detected.title };
}

async function createItem(request) {
  const form = await request.formData();
  const upload = form.get("file");
  const type = field(form, "type") || "document";
  let content = field(form, "content");
  let sourcePath = field(form, "source_path") || null;
  if (upload instanceof File && upload.size) content = await upload.text();
  const extra = pathAndCategory(type, form);
  if (extra.error) return text(extra.error, 422);
  let title = field(form, "title") || (extra.path ? basename(extra.path) : "");
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
  setPathAndCategory.run(extra.path, extra.categoryId, id);
  const tagNames = field(form, "tags").split(",").map(value => value.trim()).filter(Boolean);
  setTags(id, tagNames);
  return { id, href: itemHref(db.query("SELECT * FROM items WHERE id = ?").get(id)), returnTo: field(form, "return_to") || null };
}

function documentTitle(content, sourcePath) {
  if (extname(sourcePath).toLowerCase() === ".html") {
    return content.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || basename(sourcePath, extname(sourcePath));
  }
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(sourcePath, extname(sourcePath));
}

const isHtmlPath = sourcePath => extname(sourcePath).toLowerCase() === ".html";

const watchStates = new Map();
let watchTimer;
let reconcilePromise;
let reconcileAgain = false;

function watchedDirectories() {
  return db.query("SELECT * FROM watched_directories ORDER BY path").all();
}

async function normalizeWatchedPath(value) {
  const home = process.env.HOME ?? "";
  const expanded = value === "~" ? home : value.startsWith("~/") ? join(home, value.slice(2)) : value;
  if (!expanded || !isAbsolute(expanded)) throw new Error("Directory path must be absolute.");
  const path = resolve(expanded);
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error("Path is not a directory.");
  return path;
}

async function listDirectories(url) {
  const requested = url.searchParams.get("path");
  if (!requested?.trim()) return Response.json({ error: "A directory path is required." }, { status: 400 });
  if (!isAbsolute(requested)) return Response.json({ error: "Directory path must be absolute." }, { status: 400 });
  const path = resolve(requested);
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT") return Response.json({ error: "Directory not found." }, { status: 404 });
    if (error.code === "EACCES" || error.code === "EPERM") return Response.json({ error: "Directory is not readable." }, { status: 403 });
    return Response.json({ error: "The directory could not be read." }, { status: 500 });
  }
  if (!info.isDirectory()) return Response.json({ error: "Path is not a directory." }, { status: 422 });
  try {
    const entries = (await readdir(path, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.name.localeCompare(right.name));
    const directories = entries.filter(entry => entry.isDirectory()).map(entry => ({ name: entry.name, path: join(path, entry.name) }));
    const files = url.searchParams.has("files") ? entries.filter(entry => entry.isFile() && !entry.name.startsWith(".")).map(entry => ({ name: entry.name, path: join(path, entry.name) })) : undefined;
    const parent = dirname(path);
    return Response.json({ path, parent: parent === path ? null : parent, directories, files });
  } catch (error) {
    if (error.code === "ENOENT") return Response.json({ error: "Directory not found." }, { status: 404 });
    if (error.code === "EACCES" || error.code === "EPERM") return Response.json({ error: "Directory is not readable." }, { status: 403 });
    return Response.json({ error: "The directory could not be read." }, { status: 500 });
  }
}

async function scanWatchedDirectory(directory) {
  const info = await stat(directory.path);
  if (!info.isDirectory()) throw new Error("Path is not a directory.");
  const paths = [];
  const glob = new Bun.Glob(directory.recursive ? "**/*" : "*");
  for await (const path of glob.scan({ cwd: directory.path, absolute: true, onlyFiles: true })) {
    if ([".md", ".markdown", ".html"].includes(extname(path).toLowerCase())) paths.push(path);
  }
  paths.sort();
  const documents = new Map();
  for (const sourcePath of paths) {
    const content = await Bun.file(sourcePath).text();
    documents.set(sourcePath, { sourcePath, content, title: documentTitle(content, sourcePath), html: isHtmlPath(sourcePath) });
  }
  return documents;
}

function upsertWatchedDocument(document) {
  const existing = db.query("SELECT id FROM items WHERE source_path = ?").get(document.sourcePath);
  const content = document.html ? "" : document.content;
  const rendered = document.html ? document.content : "";
  if (existing) {
    db.query(`UPDATE items SET type = 'document', title = ?, content = ?, rendered_html = ?, url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(document.title, content, rendered, existing.id);
    return existing.id;
  }
  return upsertItem({ type: "document", title: document.title, description: "", content, rendered_html: rendered, url: null, source_path: document.sourcePath, toc: 1 });
}

async function performWatchedReconciliation() {
  const directories = watchedDirectories();
  const scans = new Map();
  const documents = new Map();
  const failures = new Map();
  for (const directory of directories) {
    try {
      const scan = await scanWatchedDirectory(directory);
      scans.set(directory.id, scan);
      for (const [path, document] of scan) documents.set(path, document);
    } catch (error) {
      failures.set(directory.id, error);
    }
  }

  db.transaction(() => {
    const previousItemIds = new Set();
    for (const directory of directories) {
      if (!scans.has(directory.id)) continue;
      for (const row of db.query("SELECT item_id FROM watched_items WHERE watched_directory_id = ?").all(directory.id)) previousItemIds.add(row.item_id);
      db.query("DELETE FROM watched_items WHERE watched_directory_id = ?").run(directory.id);
    }

    const documentIds = new Map();
    for (const document of [...documents.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))) {
      documentIds.set(document.sourcePath, upsertWatchedDocument(document));
    }

    const claim = db.query("INSERT OR IGNORE INTO watched_items(watched_directory_id, item_id) VALUES (?, ?)");
    for (const [directoryId, scan] of scans) {
      for (const path of scan.keys()) claim.run(directoryId, documentIds.get(path));
    }

    const hasClaim = db.query("SELECT 1 FROM watched_items WHERE item_id = ? LIMIT 1");
    const removeItem = db.query("DELETE FROM items WHERE id = ?");
    for (const itemId of previousItemIds) {
      if (!hasClaim.get(itemId)) removeItem.run(itemId);
    }
    db.query("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM taggings)").run();

    const sourceIds = sourceItemIds();
    const updateRendered = db.query("UPDATE items SET rendered_html = ? WHERE id = ?");
    for (const document of documents.values()) {
      if (document.html) continue;
      const id = documentIds.get(document.sourcePath);
      const item = db.query("SELECT title, toc FROM items WHERE id = ?").get(id);
      updateRendered.run(renderMarkdown(document.content, item.title, Boolean(item.toc), document.sourcePath, sourceIds), id);
    }
  })();

  const syncedAt = new Date().toISOString();
  for (const directory of directories) {
    const state = watchStates.get(directory.id) ?? {};
    const failure = failures.get(directory.id);
    state.error = failure?.message ?? null;
    if (!failure) {
      state.lastSyncedAt = syncedAt;
      state.count = scans.get(directory.id).size;
    }
    watchStates.set(directory.id, state);
  }
}

function reconcileWatchedDirectories() {
  if (reconcilePromise) {
    reconcileAgain = true;
    return reconcilePromise;
  }
  reconcilePromise = (async () => {
    do {
      reconcileAgain = false;
      await performWatchedReconciliation();
    } while (reconcileAgain);
  })().catch(error => console.error("watched directories:", error)).finally(() => {
    reconcilePromise = null;
  });
  return reconcilePromise;
}

function scheduleWatchedReconciliation() {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => reconcileWatchedDirectories(), WATCH_DEBOUNCE_MS);
}

async function reloadWatchedDirectories() {
  clearTimeout(watchTimer);
  for (const state of watchStates.values()) state.watcher?.close();
  watchStates.clear();
  for (const directory of watchedDirectories()) {
    const state = { watcher: null, error: null, lastSyncedAt: null, count: 0 };
    try {
      state.watcher = watch(directory.path, { recursive: Boolean(directory.recursive) }, scheduleWatchedReconciliation);
      state.watcher.on("error", error => {
        state.error = error.message;
        state.watcher?.close();
        state.watcher = null;
      });
    } catch (error) {
      state.error = error.message;
    }
    watchStates.set(directory.id, state);
  }
  await reconcileWatchedDirectories();
}

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
  if (!ITEM_TYPES.includes(type)) throw new Error("invalid item type");
  if (type !== item.type && (type === "task" || item.type === "task")) throw new Error("create a new task instead of changing an item's type to or from task");
  if (!title) throw new Error("title is required");
  const extra = pathAndCategory(type, form, item.id);
  if (extra.error) throw new Error(extra.error);
  const toc = form.has("toc");
  const htmlBacked = item.source_path?.toLowerCase().endsWith(".html") && !content;
  const rendered = ["document", "note"].includes(type) && content ? renderMarkdown(content, title, toc, item.source_path) : (htmlBacked ? item.rendered_html : "");
  const nextContent = htmlBacked ? item.content : content;
  db.query(`UPDATE items SET type = ?, title = ?, description = ?, content = ?, rendered_html = ?, url = ?, toc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(type, title, field(form, "description"), nextContent, rendered, field(form, "url") || null, toc ? 1 : 0, item.id);
  setPathAndCategory.run(extra.path, extra.categoryId, item.id);
  if (form.has("sync_source") && item.source_path?.toLowerCase().endsWith(".md")) await Bun.write(item.source_path, content);
}

function tasksPage(taskId = null) {
  const tasks = listTaskViews(db, { all: true });
  const entries = new Map(db.query("SELECT id, task_id FROM items WHERE type = 'task'").all().map(item => [item.task_id, item.id]));
  const children = new Map();
  for (const task of tasks) {
    if (!children.has(task.parent_id)) children.set(task.parent_id, []);
    children.get(task.parent_id).push(task);
  }
  const selected = tasks.find(task => task.id === taskId);
  const parentOptions = current => `<option value="">None, top-level task</option>${tasks.filter(task => task.id !== current?.id).map(task => `<option value="${task.id}"${task.id === (current ? current.parent_id : taskId) ? " selected" : ""}>${escapeHtml(task.title)}</option>`).join("")}`;
  const render = rows => `<ul class="task-tree">${rows.map(task => `<li>
    <div class="task-row"><form method="post" action="/tasks/${task.id}/toggle"><button aria-label="${task.completed_today ? "Reopen" : "Complete"} ${escapeHtml(task.title)}">${task.completed_today ? "Reopen" : "Complete"}</button></form>
    <a href="/items/${entries.get(task.id)}"${task.completed_today ? ' class="task-completed"' : ""}>${escapeHtml(task.title)}</a>
    <a href="/tasks?parent=${task.id}#task-form">Add subtask</a>
    <a href="/items/${entries.get(task.id)}/manage">Tags and item settings</a></div>
    ${task.notes ? `<p>${escapeHtml(task.notes)}</p>` : ""}
    <details><summary>Edit task</summary><form class="editor" method="post" action="/tasks/${task.id}/edit">
      <label>Title<input name="title" value="${escapeHtml(task.title)}" required></label>
      <label>Notes<textarea name="notes">${escapeHtml(task.notes)}</textarea></label>
      <label>Parent task<select name="parent_id">${parentOptions(task)}</select></label><button>Save task</button>
    </form></details>
    ${children.has(task.id) ? render(children.get(task.id)) : ""}</li>`).join("")}</ul>`;
  return shell("Tasks", `<section class="page-head"><h1>${escapeHtml(selected?.title ?? "Tasks")}</h1><a href="/tasks">All tasks</a></section>
    <form class="editor" id="task-form" method="post" action="/tasks">
      <h2>${selected ? "Add subtask" : "Add task"}</h2><label>Title<input name="title" required></label>
      <label>Notes<textarea name="notes"></textarea></label>
      <label>Parent task<select name="parent_id">${parentOptions(null)}</select></label><button>Add task</button>
    </form>
    ${tasks.length ? render(selected ? [selected] : children.get(null) ?? []) : "<p>No tasks yet.</p>"}`, "tasks");
}

await reloadWatchedDirectories();
scanProjects().catch(error => console.error(error));

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(request, server) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return Response.json({ ok: true, items: db.query("SELECT count(*) count FROM items").get().count });
      if (url.pathname === "/assets/app.css") return new Response(Bun.file(join(ROOT, "public", "app.css")), { headers: { "content-type": "text/css; charset=utf-8" } });
      if (request.method === "GET" && url.pathname === "/tasks") return html(tasksPage(Number(url.searchParams.get("parent")) || null));
      if (request.method === "POST" && url.pathname === "/tasks") {
        const form = await request.formData();
        try {
          createTask(db, { title: field(form, "title"), notes: field(form, "notes"), parent_id: Number(field(form, "parent_id")) || null });
          return redirect("/tasks");
        } catch (error) { return text(error.message, 422); }
      }
      const taskAction = url.pathname.match(/^\/tasks\/(\d+)\/(toggle|edit)$/);
      if (request.method === "POST" && taskAction) {
        const task = getTask(db, Number(taskAction[1]));
        if (!task) return text("task not found", 404);
        try {
          if (taskAction[2] === "toggle") {
            if (taskView(db, task).completed_today) uncompleteTask(db, task.id);
            else completeTask(db, task.id);
          } else {
            const form = await request.formData();
            updateTask(db, task.id, { title: field(form, "title"), notes: field(form, "notes"), parent_id: Number(field(form, "parent_id")) || null });
          }
          return redirect("/tasks");
        } catch (error) { return text(error.message, 422); }
      }
      if (request.method === "GET" && url.pathname === "/api/items") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 0), 0), 1000);
        const items = listItems(url).slice(0, limit || undefined).map(item => ({
          id: item.id,
          type: item.type,
          title: item.title,
          description: item.description,
          url: item.url,
          source_path: item.source_path,
          path: item.path,
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
        return Response.json({ ...item, slot_paths: undefined, href: itemHref(item), tags: tagsFor(item.id).map(tag => tag.name), slots: memberSlots(item) });
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
      if (request.method === "GET" && url.pathname === "/api/settings") return Response.json({
        pastry_enabled: pastryEnabled(),
        watched_directories: watchedDirectories().map(directory => ({ ...directory, recursive: Boolean(directory.recursive) })),
      });
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
      if (request.method === "GET" && url.pathname === "/portfolios") return html(portfoliosPage());
      if (request.method === "POST" && url.pathname === "/portfolios") {
        const form = await request.formData();
        const name = field(form, "name");
        if (!name) return text("name is required", 422);
        if (db.query("SELECT 1 FROM portfolios WHERE name = ?").get(name)) return text("a portfolio with that name already exists", 422);
        const { id } = db.query("INSERT INTO portfolios(name, description) VALUES (?, ?) RETURNING id").get(name, field(form, "description"));
        return redirect(`/portfolios/${id}`);
      }
      const portfolioMatch = url.pathname.match(/^(\/api)?\/portfolios\/(\d+)(?:\/(delete|cards))?$/);
      if (portfolioMatch) {
        const [, api, id, action] = portfolioMatch;
        const portfolio = db.query("SELECT * FROM portfolios WHERE id = ?").get(Number(id));
        if (!portfolio) return text("not found", 404);
        if (request.method === "GET" && api && !action) return Response.json({ ...portfolio, cards: portfolioCards(portfolio.id).map(card => ({ ...card, ...cardItems(card) })) });
        if (request.method === "GET" && !api && !action) return html(portfolioPage(portfolio));
        if (request.method === "POST" && !api) {
          if (action === "delete") {
            db.query("DELETE FROM portfolios WHERE id = ?").run(portfolio.id);
            return redirect("/portfolios");
          }
          const form = await request.formData();
          if (action === "cards") {
            const card = cardFields(form);
            if (!card.title) return text("title is required", 422);
            db.query("INSERT INTO cards(portfolio_id, title, tags, types, sort_key, sort_dir, max_items, position) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM cards WHERE portfolio_id = ?))")
              .run(portfolio.id, card.title, card.tags, card.types, card.sortKey, card.sortDir, card.maxItems, portfolio.id);
            return redirect(`/portfolios/${portfolio.id}`);
          }
          const name = field(form, "name");
          if (!name) return text("name is required", 422);
          if (db.query("SELECT 1 FROM portfolios WHERE name = ? AND id != ?").get(name, portfolio.id)) return text("a portfolio with that name already exists", 422);
          db.query("UPDATE portfolios SET name = ?, description = ? WHERE id = ?").run(name, field(form, "description"), portfolio.id);
          return redirect(`/portfolios/${portfolio.id}`);
        }
      }
      const cardMatch = url.pathname.match(/^\/cards\/(\d+)(?:\/(delete|move))?$/);
      if (request.method === "POST" && cardMatch) {
        const card = db.query("SELECT * FROM cards WHERE id = ?").get(Number(cardMatch[1]));
        if (!card) return text("not found", 404);
        if (cardMatch[2] === "delete") db.query("DELETE FROM cards WHERE id = ?").run(card.id);
        else if (cardMatch[2] === "move") moveCard(card, field(await request.formData(), "direction"));
        else {
          const next = cardFields(await request.formData());
          if (!next.title) return text("title is required", 422);
          db.query("UPDATE cards SET title = ?, tags = ?, types = ?, sort_key = ?, sort_dir = ?, max_items = ? WHERE id = ?")
            .run(next.title, next.tags, next.types, next.sortKey, next.sortDir, next.maxItems, card.id);
        }
        return redirect(`/portfolios/${card.portfolio_id}`);
      }
      if (request.method === "GET" && url.pathname === "/categories") return html(categoriesPage());
      if (request.method === "POST" && url.pathname === "/categories") {
        let name, kind, slots;
        try { [name, kind, slots] = categoryFields(await request.formData()); } catch (error) { return text(error.message, 422); }
        if (db.query("SELECT 1 FROM categories WHERE name = ?").get(name)) return text("a category with that name already exists", 422);
        db.query("INSERT INTO categories(name, kind, slots) VALUES (?, ?, ?)").run(name, kind, slots);
        return redirect("/categories");
      }
      const categoryMatch = url.pathname.match(/^\/categories\/(\d+)(\/delete)?$/);
      if (categoryMatch) {
        const category = db.query("SELECT * FROM categories WHERE id = ?").get(Number(categoryMatch[1]));
        if (!category) return text("not found", 404);
        if (request.method === "GET" && !categoryMatch[2]) return html(libraryPage(url, { category: category.id, heading: category.name, subhead: `Every ${category.kind} item in this category.`, active: "categories" }));
        if (request.method === "POST" && categoryMatch[2]) {
          db.query("DELETE FROM categories WHERE id = ?").run(category.id);
          return redirect("/categories");
        }
        if (request.method === "POST") {
          let name, kind, slots;
          try { [name, kind, slots] = categoryFields(await request.formData()); } catch (error) { return text(error.message, 422); }
          if (db.query("SELECT 1 FROM categories WHERE name = ? AND id != ?").get(name, category.id)) return text("a category with that name already exists", 422);
          if (kind !== category.kind && db.query("SELECT 1 FROM items WHERE category_id = ? LIMIT 1").get(category.id)) return text(`this category still has ${category.kind} items, so its kind cannot change`, 422);
          db.query("UPDATE categories SET name = ?, kind = ?, slots = ? WHERE id = ?").run(name, kind, slots, category.id);
          return redirect("/categories");
        }
      }
      const pathActionMatch = url.pathname.match(/^\/items\/(\d+)\/(path-action|slot-path)$/);
      if (request.method === "POST" && pathActionMatch) {
        const item = db.query("SELECT * FROM items WHERE id = ?").get(Number(pathActionMatch[1]));
        if (!item) return text("not found", 404);
        const form = await request.formData();
        const slotName = field(form, "slot");
        const slot = slotName ? memberSlots(item).find(candidate => candidate.name === slotName) : null;
        if (slotName && !slot) return text("no such slot", 404);
        if (pathActionMatch[2] === "slot-path") {
          if (!slot) return text("slot is required", 422);
          const overrides = JSON.parse(item.slot_paths);
          if (field(form, "path")) overrides[slot.name] = field(form, "path"); else delete overrides[slot.name];
          db.query("UPDATE items SET slot_paths = ? WHERE id = ?").run(JSON.stringify(overrides), item.id);
        } else {
          const target = slot ?? (PATH_TYPES.includes(item.type) ? { kind: item.type, path: item.path } : null);
          if (!target?.path) return text("nothing to act on", 422);
          if (!Object.hasOwn(PATH_ACTIONS, field(form, "action"))) return text("invalid action", 422);
          await runPathAction(field(form, "action"), target);
        }
        return redirect(request.headers.get("referer") || `/items/${item.id}`);
      }
      if (request.method === "POST" && url.pathname === "/settings/project-parents") {
        try {
          db.query("INSERT OR IGNORE INTO project_parents(path) VALUES (?)").run(await normalizeWatchedPath(field(await request.formData(), "path")));
        } catch (error) {
          return settingsPage(error.message, 422);
        }
        await scanProjects();
        return redirect("/settings");
      }
      if (request.method === "POST" && url.pathname === "/settings/project-parents/scan") {
        await scanProjects();
        return redirect("/settings");
      }
      const projectParentMatch = url.pathname.match(/^\/settings\/project-parents\/(\d+)\/delete$/);
      if (request.method === "POST" && projectParentMatch) {
        db.query("DELETE FROM project_parents WHERE id = ?").run(Number(projectParentMatch[1]));
        return redirect("/settings");
      }
      if (request.method === "GET" && url.pathname === "/ports") return portsPage();
      if (request.method === "GET" && url.pathname === "/ports/tree") return portsTreePage(url);
      if (request.method === "GET" && url.pathname === "/api/ports") return Response.json(getPortsSnapshot());
      if (request.method === "POST" && url.pathname === "/api/ports/kill") return killPortProcess(request);
      if (request.method === "GET" && url.pathname === "/settings") return settingsPage();
      if (request.method === "POST" && url.pathname === "/api/settings/pick-directory") {
        if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
            request.headers.get("X-Portfolio-Picker") !== "1" ||
            (request.headers.has("origin") && request.headers.get("origin") !== url.origin) ||
            request.headers.get("sec-fetch-site") === "cross-site") {
          return Response.json({ error: "Local same-origin requests only." }, { status: 403 });
        }
        if (process.platform !== "darwin") return Response.json({ error: "Native folder selection requires macOS. Enter a directory path instead." }, { status: 501 });
        server.timeout(request, 0);
        const picker = Bun.spawn(["/usr/bin/osascript", "-e", 'try\nactivate\nreturn POSIX path of (choose folder with prompt "Choose a watched directory")\non error number -128\nreturn ""\nend try'], { stdout: "pipe", stderr: "pipe" });
        const [path, error, code] = await Promise.all([new Response(picker.stdout).text(), new Response(picker.stderr).text(), picker.exited]);
        if (code !== 0) return Response.json({ error: error.trim() || "Could not open the folder picker." }, { status: 500 });
        return Response.json({ path: path.replace(/\n$/, "") });
      }
      if (request.method === "GET" && url.pathname === "/api/settings/directories") return listDirectories(url);
      if (request.method === "POST" && url.pathname === "/settings") {
        const form = await request.formData();
        setSetting("pastry_enabled", form.has("pastry_enabled") ? "1" : "0");
        return redirect("/settings");
      }
      if (request.method === "POST" && url.pathname === "/settings/watched-directories") {
        const form = await request.formData();
        try {
          const path = await normalizeWatchedPath(field(form, "path"));
          if (db.query("SELECT 1 FROM watched_directories WHERE path = ?").get(path)) return settingsPage("That directory is already being watched.", 422);
          db.query("INSERT INTO watched_directories(path, recursive) VALUES (?, ?)").run(path, form.has("recursive") ? 1 : 0);
          await reloadWatchedDirectories();
          return redirect("/settings");
        } catch (error) {
          return settingsPage(error.message, 422);
        }
      }
      if (request.method === "POST" && url.pathname === "/settings/watched-directories/sync") {
        await reloadWatchedDirectories();
        return redirect("/settings");
      }
      const watchedDirectoryMatch = url.pathname.match(/^\/settings\/watched-directories\/(\d+)$/);
      if (request.method === "POST" && watchedDirectoryMatch) {
        const id = Number(watchedDirectoryMatch[1]);
        const form = await request.formData();
        const result = db.query("UPDATE watched_directories SET recursive = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(form.has("recursive") ? 1 : 0, id);
        if (!result.changes) return text("not found", 404);
        await reloadWatchedDirectories();
        return redirect("/settings");
      }
      const watchedDirectoryDeleteMatch = url.pathname.match(/^\/settings\/watched-directories\/(\d+)\/delete$/);
      if (request.method === "POST" && watchedDirectoryDeleteMatch) {
        const id = Number(watchedDirectoryDeleteMatch[1]);
        const itemIds = db.query("SELECT item_id FROM watched_items WHERE watched_directory_id = ?").all(id).map(row => row.item_id);
        db.transaction(() => {
          db.query("DELETE FROM watched_directories WHERE id = ?").run(id);
          const hasClaim = db.query("SELECT 1 FROM watched_items WHERE item_id = ? LIMIT 1");
          const removeItem = db.query("DELETE FROM items WHERE id = ?");
          for (const itemId of itemIds) if (!hasClaim.get(itemId)) removeItem.run(itemId);
          db.query("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM taggings)").run();
        })();
        await reloadWatchedDirectories();
        return redirect("/settings");
      }
      if (request.method === "GET" && url.pathname === "/new") {
        return html(shell("Add an item", `<section class="page-head"><h1>Add an item</h1><p>Documents and notes use Markdown. Links and PRs point outward. Files and dirs point at your disk.</p></section><form class="editor" method="post" action="/items"><label>Type<select name="type"><option value="note">Note</option><option value="document">Document</option><option value="link">Link</option><option value="pr">PR</option><option value="file">File</option><option value="dir">Dir</option></select></label><label>Title<input name="title" placeholder="Files and dirs default to their name"></label><label>Description<input name="description"></label><label>URL<input name="url" type="url" placeholder="https://"></label><label>Path — file and dir items<input name="path" placeholder="~/proj/thing"></label>${categorySelect(null)}<label>Tags<input name="tags" placeholder="architecture, portfolio-name"></label><label>Markdown<textarea name="content" rows="16"></textarea></label><button class="primary">Save item</button></form>`, "new"));
      }
      const manageMatch = url.pathname.match(/^\/items\/(\d+)\/manage$/);
      if (request.method === "GET" && manageMatch) {
        const item = db.query("SELECT * FROM items WHERE id = ?").get(Number(manageMatch[1]));
        if (!item) return text("not found", 404);
        const tags = tagsFor(item.id);
        const source = item.source_path ? `<div class="source-file"><strong>Tracked source</strong><code>${escapeHtml(item.source_path)}</code></div>` : `<div class="source-file"><strong>Tracked source</strong><span>No source file</span></div>`;
        const body = `<section class="detail-head"><a href="${escapeHtml(itemHref(item))}">Open item</a><h1>Edit item</h1>${source}</section>
          <form class="editor" method="post" action="/items/${item.id}/manage"><label>Type<select name="type">${ITEM_TYPES.map(type => `<option value="${type}"${item.type === type ? " selected" : ""}>${type}</option>`).join("")}</select></label><label>Title<input name="title" value="${escapeHtml(item.title)}" required></label><label>Description<input name="description" value="${escapeHtml(item.description)}"></label><label>URL<input name="url" type="url" value="${escapeHtml(item.url || "")}"></label><label>Path — file and dir items<input name="path" value="${escapeHtml(item.path ? abbreviatePath(item.path) : "")}" placeholder="~/proj/thing"></label>${categorySelect(item.category_id)}<label>Markdown<textarea name="content" rows="18">${escapeHtml(item.content)}</textarea></label><label class="check"><input type="checkbox" name="toc"${item.toc ? " checked" : ""}> Include table of contents</label>${item.source_path?.toLowerCase().endsWith(".md") ? `<label class="check"><input type="checkbox" name="sync_source" checked> Write Markdown changes to tracked source file</label>` : ""}<button class="primary">Save changes</button></form>
          ${PATH_TYPES.includes(item.type) ? "" : slotsSection(item)}
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
        if (item.type === "task") return html(tasksPage(item.task_id));
        if (PATH_TYPES.includes(item.type)) return html(pathItemPage(item));
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
        return redirect(item.returnTo || item.href);
      }
      if (request.method === "GET" && url.pathname === "/api/detect") {
        const { shape, ...detected } = await detectType(url.searchParams.get("content") ?? "").catch(error => ({ type: "note", error: error.message }));
        return Response.json(detected);
      }
      if (request.method === "POST" && url.pathname === "/items/quick") {
        const item = await quickAdd(request);
        return item instanceof Response ? item : Response.json(item, { status: 201 });
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
