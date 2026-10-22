import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import { OncallApi, type Fetcher, type OncallItem, type PromptRun } from "../src/client.ts";
import { handleRequest, serve } from "../src/server.ts";
import { main } from "../src/index.ts";
import { TOOLS, toolListing } from "../src/tools.ts";
import { isRecord } from "../src/validate.ts";

/** A `tools/call` result, once we have checked the shape our own server produced. */
interface Reply {
  content: { type: string; text: string }[];
  isError?: boolean;
}

type Recorded = { method: string; path: string; body: unknown };

const item = (over: Partial<OncallItem> = {}): OncallItem => ({
  id: 1,
  kind: "slack",
  title: "deploy failing",
  body: "thread body",
  status: "open",
  suggested_status: "open",
  slack_channel: "#oncall",
  slack_channel_url: "https://slack.example/#oncall",
  slack_message_url: "https://slack.example/msg/1",
  slack_thread_url: "https://slack.example/thread/1",
  author: "josh",
  pr_url: null,
  created_at: "2026-10-22T09:00:00.000Z",
  ...over,
});

const run = (over: Partial<PromptRun> = {}): PromptRun => ({
  id: 7,
  prompt_id: "triage",
  status: "completed",
  output: "all clear",
  started_at: "2026-10-22T09:00:00.000Z",
  finished_at: "2026-10-22T09:00:03.000Z",
  ...over,
});

/** A fake API: route key is "METHOD /path", value is the JSON body to answer with (a number answers as that status). */
function fakeApi(routes: Record<string, unknown>, recorded: Recorded[] = []): OncallApi {
  const fetcher: Fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    recorded.push({ method, path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) return Response.json({ error: `no route ${key}` }, { status: 404 });
    const value = routes[key];
    return typeof value === "number" ? new Response("boom", { status: value }) : Response.json(value);
  };
  return new OncallApi("http://127.0.0.1:4388", { fetch: fetcher });
}

const isReply = (value: unknown): value is Reply => {
  if (!isRecord(value) || !Array.isArray(value.content) || value.content.length === 0) return false;
  const first: unknown = value.content[0];
  return isRecord(first) && typeof first.text === "string";
};

async function call(api: OncallApi, name: string, args: unknown = {}): Promise<Reply> {
  const response = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { api });
  if (!response || !isReply(response.result)) throw new Error(`no tool result for ${name}: ${JSON.stringify(response)}`);
  return response.result;
}

/** Tool output is JSON text; parse it back to assert on the structure. */
const payload = (reply: Reply): unknown => JSON.parse(reply.content[0].text);

const textOf = (reply: Reply): string => reply.content[0].text;

const toolNames = (value: unknown): string[] => {
  if (!isRecord(value) || !isRecord(value.result) || !Array.isArray(value.result.tools)) return [];
  return value.result.tools.map(tool => (isRecord(tool) && typeof tool.name === "string" ? tool.name : ""));
};

test("initialize, ping, and unknown methods speak JSON-RPC", async () => {
  const api = fakeApi({});
  const init = await handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", clientInfo: { name: "codex" } } }, { api });
  expect(init?.result).toMatchObject({
    protocolVersion: "2024-11-05",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "portfolio-oncall", version: "0.1.0" },
  });
  expect(init?.result).toMatchObject({ instructions: expect.stringContaining("oncall_list_items") });

  // A client that names no protocol version gets the server's latest.
  const fallback = await handleRequest({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }, { api });
  expect(fallback?.result).toMatchObject({ protocolVersion: "2025-06-18" });

  const ping = await handleRequest({ jsonrpc: "2.0", id: "p", method: "ping" }, { api });
  expect(ping?.result).toEqual({});

  const missing = await handleRequest({ jsonrpc: "2.0", id: 3, method: "resources/list" }, { api });
  expect(missing?.error).toMatchObject({ code: -32601, message: "unknown method: resources/list" });

  // Notifications get no reply at all.
  expect(await handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, { api })).toBeNull();
  expect(await handleRequest({ jsonrpc: "2.0", method: "resources/list" }, { api })).toBeNull();
});

test("tools/list advertises the six oncall tools with object schemas", () => {
  const tools = toolListing();
  expect(tools.map(tool => tool.name)).toEqual([
    "oncall_list_items", "oncall_create_item", "oncall_update_status",
    "oncall_list_prompts", "oncall_run_prompt", "oncall_get_prompt_run",
  ]);
  for (const tool of tools) {
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.description.length).toBeGreaterThan(20);
    expect(tool.title.length).toBeGreaterThan(0);
  }
  expect(TOOLS.find(tool => tool.name === "oncall_update_status")?.inputSchema.required).toEqual(["id", "status"]);
  expect(TOOLS.find(tool => tool.name === "oncall_list_items")?.inputSchema.properties?.status?.enum)
    .toEqual(["all", "open", "working", "blocked", "done", "dismissed"]);
  expect(JSON.stringify(tools)).not.toContain("handler");
});

test("oncall_list_items filters by status, kind, and limit, and reports polling state", async () => {
  const api = fakeApi({
    "GET /api/oncall": {
      items: [
        item({ id: 1, status: "open" }),
        item({ id: 2, kind: "pr", status: "working", pr_url: "https://github.com/o/r/pull/2" }),
        item({ id: 3, status: "done" }),
      ],
      prompts: [{ id: "triage", title: "Triage", directory: "/Users/josh/work", body: "look" }],
      last_polled_at: "2026-10-22T09:00:00.000Z",
      polling_error: "slack rate limited",
    },
  });
  expect(payload(await call(api, "oncall_list_items"))).toMatchObject({
    total: 3,
    count: 3,
    last_polled_at: "2026-10-22T09:00:00.000Z",
    polling_error: "slack rate limited",
    items: [{ id: 1 }, { id: 2 }, { id: 3 }],
  });

  expect(payload(await call(api, "oncall_list_items", { status: "open" }))).toMatchObject({ count: 1, items: [{ id: 1 }] });

  expect(payload(await call(api, "oncall_list_items", { kind: "pr", limit: 1 }))).toMatchObject({
    total: 3,
    count: 1,
    items: [{ id: 2, pr_url: "https://github.com/o/r/pull/2" }],
  });

  const junk = await call(api, "oncall_list_items", { status: "nope" });
  expect(junk.isError).toBe(true);
  expect(textOf(junk)).toContain('"status" must be one of');
});

test("oncall_update_status patches the item and clears the override with auto", async () => {
  const recorded: Recorded[] = [];
  const api = fakeApi({ "PATCH /api/oncall/items/4": { item: item({ id: 4, status: "blocked" }) } }, recorded);
  expect(payload(await call(api, "oncall_update_status", { id: 4, status: "blocked" }))).toMatchObject({ item: { id: 4, status: "blocked" } });
  expect(recorded).toEqual([{ method: "PATCH", path: "/api/oncall/items/4", body: { status: "blocked" } }]);

  const clearing = fakeApi({ "PATCH /api/oncall/items/4": item({ id: 4, status: "open" }) }, recorded);
  await call(clearing, "oncall_update_status", { id: 4, status: "auto" });
  expect(recorded[1].body).toEqual({ status: null });

  // The API clears the override with null, so the tool accepts null as well as "auto".
  await call(clearing, "oncall_update_status", { id: 4, status: null });
  expect(recorded[2].body).toEqual({ status: null });

  const bad = await call(api, "oncall_update_status", { id: 4, status: "banana" });
  expect(bad.isError).toBe(true);
  expect(textOf(bad)).toContain('"status" must be one of');

  const missingId = await call(api, "oncall_update_status", { status: "done" });
  expect(missingId.isError).toBe(true);
  expect(textOf(missingId)).toContain('missing required property "id"');
});

test("oncall_create_item posts the item and reports unexpected responses", async () => {
  const recorded: Recorded[] = [];
  const api = fakeApi({ "POST /api/oncall/items": item({ id: 9, title: "manual", kind: "pr" }) }, recorded);
  expect(payload(await call(api, "oncall_create_item", {
    title: "manual",
    body: "why",
    kind: "pr",
    status: "working",
    pr_url: "https://github.com/o/r/pull/9",
    slack_channel: "#oncall",
    author: "josh",
  }))).toMatchObject({ item: { id: 9, title: "manual", kind: "pr" } });
  expect(recorded[0]).toEqual({
    method: "POST",
    path: "/api/oncall/items",
    body: {
      title: "manual",
      body: "why",
      kind: "pr",
      status: "working",
      pr_url: "https://github.com/o/r/pull/9",
      slack_channel: "#oncall",
      author: "josh",
    },
  });

  const missingTitle = await call(api, "oncall_create_item", { body: "no title" });
  expect(missingTitle.isError).toBe(true);
  expect(textOf(missingTitle)).toContain('missing required property "title"');

  const junk = await call(api, "oncall_create_item", { title: "x", nope: 1 });
  expect(junk.isError).toBe(true);
  expect(textOf(junk)).toContain('unknown property "nope"');

  // A null on an optional field means "not set", so it is simply left out of the request.
  await call(api, "oncall_create_item", { title: "bare", body: null, author: null });
  expect(recorded.at(-1)?.body).toEqual({ title: "bare" });
});

test("prompt tools list, run, and fetch captured output", async () => {
  const recorded: Recorded[] = [];
  const api = fakeApi({
    "GET /api/oncall": {
      items: [],
      prompts: [{ id: "triage", title: "Triage", directory: "/Users/josh/work", body: "look at the board" }],
      last_polled_at: null,
      polling_error: null,
    },
    "POST /api/oncall/prompts/triage/run": { run: run({ status: "running", output: "", finished_at: null }) },
    "GET /api/oncall/prompts/runs/6": { run: run({ id: 6, status: "completed", output: "older", started_at: "2026-10-21T09:00:00.000Z" }) },
    "GET /api/oncall/prompts/runs": {
      runs: [
        run({ id: 7, status: "running", output: "", finished_at: null }),
        run({ id: 6, status: "completed", output: "older", started_at: "2026-10-21T09:00:00.000Z" }),
      ],
    },
  }, recorded);

  expect(payload(await call(api, "oncall_list_prompts"))).toMatchObject({
    count: 1,
    prompts: [{ id: "triage", title: "Triage", directory: "/Users/josh/work" }],
  });

  const started = await call(api, "oncall_run_prompt", { id: "triage" });
  expect(recorded.at(-1)).toEqual({ method: "POST", path: "/api/oncall/prompts/triage/run", body: undefined });
  expect(payload(started)).toMatchObject({
    run: { id: 7, prompt_id: "triage", status: "running", output: "" },
    note: expect.stringContaining("oncall_get_prompt_run with id 7"),
  });

  expect(payload(await call(api, "oncall_get_prompt_run", { id: 6 }))).toMatchObject({ run: { id: 6, output: "older" } });
  expect(recorded.at(-1)).toEqual({ method: "GET", path: "/api/oncall/prompts/runs/6", body: undefined });

  expect(payload(await call(api, "oncall_get_prompt_run", { prompt_id: "triage" }))).toMatchObject({
    prompt_id: "triage",
    count: 2,
    runs: [{ id: 7 }, { id: 6 }],
  });
  expect(recorded.at(-1)).toEqual({ method: "GET", path: "/api/oncall/prompts/runs", body: undefined });

  const neither = await call(api, "oncall_get_prompt_run", {});
  expect(neither.isError).toBe(true);
  expect(textOf(neither)).toContain("pass either id");

  const absent = await call(api, "oncall_get_prompt_run", { id: 99 });
  expect(absent.isError).toBe(true);
  expect(textOf(absent)).toContain("no prompt run with id 99");
});

test("unknown tools are protocol errors and API failures are clear tool errors", async () => {
  const api = fakeApi({});
  const unknown = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "oncall_nope" } }, { api });
  expect(unknown?.error).toMatchObject({ code: -32602, message: "unknown tool: oncall_nope" });
  const unnamed = await handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }, { api });
  expect(unnamed?.error).toMatchObject({ code: -32602 });

  const failing = await call(fakeApi({ "GET /api/oncall": 500 }), "oncall_list_items");
  expect(failing.isError).toBe(true);
  expect(textOf(failing)).toContain("boom");

  const down = new OncallApi("http://127.0.0.1:4388", { fetch: async () => { throw new Error("ECONNREFUSED"); } });
  const offline = await call(down, "oncall_list_items");
  expect(offline.isError).toBe(true);
  expect(textOf(offline)).toContain("not answering at http://127.0.0.1:4388");
  expect(textOf(offline)).toContain("PORTFOLIO_API_URL");
});

test("serve() reads newline-delimited JSON-RPC and writes one reply per request", async () => {
  const api = fakeApi({ "GET /api/oncall": { items: [], prompts: [], last_polled_at: null, polling_error: null } });
  const written: string[] = [];
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "oncall_list_prompts" } },
  ];
  const input = Readable.from([`${requests.map(request => JSON.stringify(request)).join("\n")}\n`, "not json\n"]);
  await serve({ api, input, output: { write: chunk => { written.push(chunk); return true; } }, onError: () => {} });

  const replies: unknown[] = written.map(line => JSON.parse(line));
  expect(replies).toHaveLength(4);
  expect(replies[0]).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "portfolio-oncall" } } });
  expect(toolNames(replies[1])).toHaveLength(6);
  expect(replies[2]).toMatchObject({ id: 3, result: { content: [{ type: "text", text: JSON.stringify({ count: 0, prompts: [] }, null, 2) }] } });
  expect(replies[3]).toMatchObject({ id: null, error: { code: -32700 } });
});

test("PORTFOLIO_API_URL overrides the default API base", () => {
  expect(new OncallApi().base).toBe("http://127.0.0.1:4388");
  expect(new OncallApi("http://127.0.0.1:9999/").base).toBe("http://127.0.0.1:9999");
  const previous = process.env.PORTFOLIO_API_URL;
  process.env.PORTFOLIO_API_URL = "http://127.0.0.1:5555/";
  expect(new OncallApi().base).toBe("http://127.0.0.1:5555");
  if (previous === undefined) delete process.env.PORTFOLIO_API_URL;
  else process.env.PORTFOLIO_API_URL = previous;
});

test("main() prints help and version without touching stdio JSON-RPC", async () => {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array): boolean => { writes.push(String(chunk)); return true; };
  try {
    expect(await main(["--help"])).toBe(0);
    expect(writes.join("")).toContain("oncall_run_prompt");
    expect(await main(["--version"])).toBe(0);
    expect(writes.join("")).toContain("0.1.0");
    expect(await main(["--nope"])).toBe(2);
  } finally {
    process.stdout.write = original;
  }
});
