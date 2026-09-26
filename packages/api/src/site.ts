import { realpath, stat } from "node:fs/promises";
import { dirname, extname, sep } from "node:path";
import { resolveSiteFile } from "@portfolio/core";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

const missing = (): Response => new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

async function staysInside(indexPath: string, file: string): Promise<boolean> {
  try {
    const root = await realpath(dirname(indexPath));
    const actual = await realpath(file);
    return actual === root || actual.startsWith(root + sep);
  } catch {
    return false;
  }
}

async function sendFile(indexPath: string, file: string): Promise<Response> {
  if (!await staysInside(indexPath, file)) return missing();
  const body = Bun.file(file);
  if (!await body.exists()) return missing();
  return new Response(body, { headers: { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" } });
}

/** Serves one file from the directory of a site's index.html. A directory URL redirects so relative links resolve inside it. */
export async function serveSite(indexPath: string, relative: string, pathname: string): Promise<Response> {
  const target = resolveSiteFile(indexPath, relative);
  if (!target) return missing();
  let info;
  try {
    info = await stat(target);
  } catch {
    return missing();
  }
  if (info.isDirectory()) {
    if (!pathname.endsWith("/")) return new Response(null, { status: 302, headers: { location: `${pathname}/` } });
    const nested = resolveSiteFile(indexPath, `${relative.replace(/\/+$/, "")}/index.html`);
    if (!nested) return missing();
    return sendFile(indexPath, nested);
  }
  return sendFile(indexPath, target);
}
