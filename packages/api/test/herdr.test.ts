import { expect, test } from "bun:test";
import { openStore } from "@portfolio/db";
import { createApi } from "../src/index.ts";

test("Herdr rejects browser cross-origin attacks before allowing local command validation", async () => {
  const store = openStore(":memory:");
  const api = createApi(store);
  const post = (origin: string, contentType = "application/json", host = "127.0.0.1", fetchSite?: string) => api(new Request(`http://${host}/api/herdr/command`, {
    method: "POST", headers: { origin, "content-type": contentType, ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}) }, body: "{}",
  }));
  try {
    expect((await post("https://attacker.example")).status).toBe(403);
    expect((await post("null")).status).toBe(403);
    expect((await post("http://127.0.0.1", "application/json", "rebind.example")).status).toBe(403);
    expect((await post("http://127.0.0.1", "application/json", "127.0.0.1", "cross-site")).status).toBe(403);
    expect((await post("http://127.0.0.1", "text/plain")).status).toBe(415);
    const local = await post("http://localhost:9245");
    expect(local.status).toBe(422);
    expect(await local.json()).toEqual({ error: "Expected session, method, and params object" });
    expect((await post("wails://localhost")).status).toBe(422);
  } finally { store.close(); }
});

test("Herdr rejects malformed and oversized command bodies", async () => {
  const store = openStore(":memory:");
  const api = createApi(store);
  try {
    const send = (body: string) => api(new Request("http://localhost/api/herdr/command", { method: "POST", headers: { "content-type": "application/json" }, body }));
    const malformed = await send("{");
    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toEqual({ error: "Invalid JSON body" });
    const oversized = await send(JSON.stringify({ params: "x".repeat(1024 * 1024) }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "Herdr request exceeds 1 MiB" });
  } finally { store.close(); }
});
