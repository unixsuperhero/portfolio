import { HerdrError, HerdrService } from "@portfolio/herdr/server";
import { isObject } from "@portfolio/herdr";
import type { Json, JsonObject } from "@portfolio/herdr";
import { error, json } from "./http.ts";

const service = new HerdrService();
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "wails.localhost"]);

function guard(request: Request) {
  if (!localHosts.has(new URL(request.url).hostname)) throw new HerdrError("Herdr is only available through a local host", 403);
  const origin = request.headers.get("origin");
  if (origin) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new HerdrError("Herdr requires a trusted local origin", 403); }
    if (!localHosts.has(url.hostname) || !["http:", "https:", "wails:"].includes(url.protocol)) throw new HerdrError("Herdr requires a trusted local origin", 403);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new HerdrError("Cross-site Herdr requests are forbidden", 403);
  if (request.method === "POST" && request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") throw new HerdrError("Herdr commands require application/json", 415);
}

async function body(request: Request): Promise<JsonObject> {
  const reader = request.body?.getReader();
  if (!reader) throw new HerdrError("JSON body required", 422);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) { await reader.cancel(); throw new HerdrError("Herdr request exceeds 1 MiB", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let value: Json;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HerdrError("Invalid JSON body", 422); }
  if (!isObject(value)) throw new HerdrError("Expected a JSON object", 422);
  return value;
}

export async function herdrRoute(_ctx: unknown, request: Request): Promise<Response> {
  try {
    guard(request);
    const path = new URL(request.url).pathname;
    if (request.method === "GET") return json(path.endsWith("/catalog") ? await service.catalog() : await service.overview(request.signal));
    const data = await body(request);
    if (path.endsWith("/session")) {
      if (typeof data.name !== "string" || (data.action !== "start" && data.action !== "stop" && data.action !== "delete")) throw new HerdrError("Expected a session name and start, stop, or delete action", 422);
      return json(await service.session(data.name, data.action));
    }
    if (typeof data.session !== "string" || typeof data.method !== "string" || !isObject(data.params)) throw new HerdrError("Expected session, method, and params object", 422);
    if (data.capture_ms !== undefined && typeof data.capture_ms !== "number") throw new HerdrError("capture_ms must be a number", 422);
    return json(await service.command({ session: data.session, method: data.method, params: data.params, capture_ms: data.capture_ms }, request.signal));
  } catch (err) {
    return error(err instanceof HerdrError ? err.status : 502, err instanceof Error ? err.message : String(err));
  }
}
