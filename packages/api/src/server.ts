import { extname, resolve, sep } from "node:path";
import { openStore } from "@portfolio/db";
import { createPrPoller, ghAuth, ghGraphql } from "@portfolio/github";
import { renderMarkdown } from "@portfolio/render";
import { DirectoryWatcher } from "@portfolio/watch";
import { createApi } from "./index.ts";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "content-type" };

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

const appRoot = resolve(import.meta.dir, "../../../apps/desktop/frontend/dist");

function appContentType(path: string): string {
  switch (extname(path)) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".wasm": return "application/wasm";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

async function appFileResponse(pathname: string): Promise<Response | null> {
  if (pathname !== "/app" && !pathname.startsWith("/app/") && !pathname.startsWith("/assets/")) return null;
  let relative = pathname.startsWith("/assets/") ? pathname.slice(1) : pathname === "/app" || pathname === "/app/" ? "index.html" : pathname.slice("/app/".length);
  try {
    relative = decodeURIComponent(relative);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const candidate = resolve(appRoot, relative);
  if (candidate !== appRoot && !candidate.startsWith(appRoot + sep)) return new Response("not found", { status: 404 });
  const file = Bun.file(candidate);
  if (!await file.exists()) return new Response("not found", { status: 404 });
  return new Response(file, { headers: { "content-type": appContentType(candidate) } });
}

const port = Number(process.env.PORTFOLIO_API_PORT ?? 4388);
const store = openStore();
const watcher = new DirectoryWatcher(store.db, (markdown, options) => renderMarkdown(markdown, options));
await watcher.reload();

const auth = await ghAuth();
const prPoller = auth.ok
  ? createPrPoller({ db: store, gh: { graphql: query => ghGraphql(query) }, log: message => console.log(`prs: ${message}`), login: auth.login, ghOk: true })
  : undefined;
if (prPoller) prPoller.start();
else console.log("prs: gh auth failed, PR polling disabled");

const api = createApi(store, {
  render: async (markdown, options) => renderMarkdown(markdown, options),
  log: message => console.log(message),
  watcher,
  prPoller,
});

// Bun drops any request that runs longer than idleTimeout (default 10s) with an empty reply,
// which the desktop app's Go proxy reports to the page as 502 Bad Gateway. PR refresh and
// watch run up to two `gh` calls with a 30s timeout each, so give those requests room.
const IDLE_TIMEOUT_SECONDS = 120;

const server = Bun.serve({
  port,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  async fetch(request) {
    const start = Date.now();
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    const appResponse = request.method === "GET" ? await appFileResponse(new URL(request.url).pathname) : null;
    if (appResponse) return appResponse;
    const response = await api(request);
    console.log(`${request.method} ${new URL(request.url).pathname} ${response.status} ${Date.now() - start}ms`);
    return withCors(response);
  },
});

console.log(`@portfolio/api listening on http://${server.hostname}:${server.port}`);

process.on("SIGTERM", () => { prPoller?.stop(); watcher.close(); store.close(); process.exit(0); });
process.on("SIGINT", () => { prPoller?.stop(); watcher.close(); store.close(); process.exit(0); });
