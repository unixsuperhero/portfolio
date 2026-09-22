import { expect, test } from "bun:test";
import { PortfolioApiError, PortfolioClient } from "../src/index.ts";

const calls: { url: string; init: RequestInit }[] = [];
const fake: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), init: init ?? {} });
  if (String(url).includes("/api/items/9")) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  if (String(url).includes("/api/items")) return new Response(JSON.stringify({ items: [{ id: 1, title: "x" }] }));
  return new Response(JSON.stringify({ ok: true, items: 3 }));
}) as unknown as typeof fetch;

test("builds urls, sends forms and json, surfaces errors", async () => {
  const client = new PortfolioClient("http://h:1/", { fetch: fake });
  expect(await client.health()).toEqual({ ok: true, items: 3 });
  expect(await client.items({ q: "a b", limit: 5, starred: true, pinned: false })).toEqual([{ id: 1, title: "x" } as never]);
  expect(calls[1].url).toBe("http://h:1/api/items?q=a+b&starred=1&limit=5");
  await client.quickAdd("https://x.dev", { tags: "t" });
  expect(String(calls[2].init.body)).toBe("content=https%3A%2F%2Fx.dev&tags=t");
  await client.killPort(12);
  expect(calls[3].init.body).toBe('{"pid":12,"signal":"TERM"}');
  await expect(client.item(9)).rejects.toBeInstanceOf(PortfolioApiError);
  expect(client.absolute("https://e.com")).toBe("https://e.com");
  expect(client.absolute("/items/1")).toBe("http://h:1/items/1");
});

test("connection refusal becomes a status 0 error", async () => {
  const client = new PortfolioClient("http://127.0.0.1:1", { fetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
  await expect(client.health()).rejects.toMatchObject({ status: 0 });
});
