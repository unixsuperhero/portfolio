import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "@portfolio/db";
import { upsertOncallItem } from "../../db/src/oncall.ts";
import { createApi } from "../src/index.ts";
import { classifyOncallMessage, createOncallPoller, syncDirectGithubReviews } from "../src/oncall-poller.ts";
import { parseSlackResults } from "../src/slack-oncall.ts";
import type { SlackMessage } from "../src/slack-oncall.ts";

const post = (api: (request: Request) => Promise<Response>, url: string, method: string, body: unknown, origin?: string) =>
  api(new Request(`http://127.0.0.1${url}`, { method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }));

test("Slack search preserves bot messages with an unnamed sender and their thread link", () => {
  const results = `### Result 1 of 2
Channel: #rpp-bot-notifications (ID: C02QXBMBQ5Q)
From:  (ID: U00)  [BOT]
Message_ts: 1792684691.693019
Permalink: [link](https://instacart.enterprise.slack.com/archives/C02QXBMBQ5Q/p1792684691693019?thread_ts=1792684691.366089&cid=C02QXBMBQ5Q)
Text: 
[IPP] Account updated

---

### Result 2 of 2
Channel: #rpp-bot-notifications (ID: C02QXBMBQ5Q)
From: IPP Bot (ID: U02KCL13HEH)  [BOT]
Message_ts: 1792684691.366089
Permalink: [link](https://instacart.enterprise.slack.com/archives/C02QXBMBQ5Q/p1792684691366089)
Text: 

---`;
  expect(parseSlackResults(results)).toEqual([
    { channel: "rpp-bot-notifications", channelId: "C02QXBMBQ5Q", author: "Bot", authorId: "U00",
      ts: "1792684691.693019", threadTs: "1792684691.366089", text: "[IPP] Account updated",
      url: "https://instacart.enterprise.slack.com/archives/C02QXBMBQ5Q/p1792684691693019?thread_ts=1792684691.366089&cid=C02QXBMBQ5Q" },
    { channel: "rpp-bot-notifications", channelId: "C02QXBMBQ5Q", author: "IPP Bot", authorId: "U02KCL13HEH",
      ts: "1792684691.366089", threadTs: "1792684691.366089", text: "",
      url: "https://instacart.enterprise.slack.com/archives/C02QXBMBQ5Q/p1792684691366089" },
  ]);
  expect(() => parseSlackResults(`### Result 1 of 1
Channel: #rpp-bot-notifications (ID: C02QXBMBQ5Q)
From:  (ID: U00)  [BOT]
Message_ts: 1792684691.693019
Text: 
[IPP] Account updated`)).toThrow("Slack search message is missing source context");
});

test("manual status survives source updates until explicitly cleared", async () => {
  const store = openStore(":memory:");
  try {
    const api = createApi(store);
    const created = await post(api, "/api/oncall/items", "POST", {
      title: "Investigate blocked approvals", body: "A teammate asked for help", kind: "slack",
      slack_channel: "#retailer-app-support", slack_message_url: "https://instacart.slack.com/archives/C1/p1234567890000000",
      slack_thread_url: "https://instacart.slack.com/archives/C1/p1234567890000000?thread_ts=1234567890.000000",
    }, "http://127.0.0.1:4387");
    expect(created.status).toBe(201);
    const item = await created.json();
    expect(item).toMatchObject({ status: "open", manual_status: null, slack_channel: "retailer-app-support" });

    const updated = await post(api, `/api/oncall/items/${item.id}`, "PATCH", { status: "blocked" });
    expect((await updated.json()).status).toBe("blocked");
    store.db.query("UPDATE oncall_items SET suggested_status = 'done' WHERE id = ?").run(item.id);
    const read = await (await api(new Request("http://127.0.0.1/api/oncall"))).json();
    expect(read.items[0]).toMatchObject({ status: "blocked", suggested_status: "done", manual_status: "blocked" });

    const cleared = await post(api, `/api/oncall/items/${item.id}`, "PATCH", { status: null });
    expect(await cleared.json()).toMatchObject({ status: "done", manual_status: null });
    expect((await post(api, `/api/oncall/items/${item.id}`, "PATCH", { status: "finished" })).status).toBe(422);
  } finally { store.close(); }
});

test("oncall mutations reject remote origins but allow local desktop origins", async () => {
  const store = openStore(":memory:");
  try {
    const api = createApi(store);
    const url = "/api/oncall/items";
    const item = { title: "Owner needs a reply" };
    expect((await post(api, url, "POST", item, "https://malicious.example")).status).toBe(403);
    expect((await post(api, url, "POST", item, "null")).status).toBe(403);
    expect((await post(api, url, "POST", item, "wails://localhost")).status).toBe(201);
    const read = await (await api(new Request("http://127.0.0.1/api/oncall"))).json();
    expect(read.items.map((value: { title: string }) => value.title)).toEqual(["Owner needs a reply"]);
  } finally { store.close(); }
});

test("Slack PR review intake keeps direct Joshua and oncall requests, never generic team asks", () => {
  const message: SlackMessage = { channel: "eng-retailer-app", channelId: "C07FT2Z4ES2", author: "Santiago", authorId: "U01",
    ts: "1792670431.275439", threadTs: "1792670431.275439", url: "https://instacart.slack.com/archives/C07FT2Z4ES2/p1792670431275439",
    text: "Hi team, could I get a review on this PR? <https://github.com/instacart/carrot/pull/880331|PR>", };
  expect(classifyOncallMessage(message)).toBeNull();
  expect(classifyOncallMessage({ ...message, text: "<@U07UX04KTFA|joshua.toyota> can you review https://github.com/instacart/carrot/pull/880331" }))
    .toEqual({ kind: "pr", prUrl: "https://github.com/instacart/carrot/pull/880331" });
  expect(classifyOncallMessage({ ...message, text: "<@U021EFQJ8SH|joshua.gui> can you review https://github.com/instacart/carrot/pull/880331" })).toBeNull();
  expect(classifyOncallMessage({ ...message, text: "@oncall could you review https://github.com/instacart/carrot/pull/880331" }))
    .toEqual({ kind: "pr", prUrl: "https://github.com/instacart/carrot/pull/880331" });
});

test("progress replies are not new oncall requests", () => {
  const message: SlackMessage = { channel: "retailer-app-support", channelId: "C013GQW0Y3C", author: "Benjamin", authorId: "U01",
    ts: "1792680357.010209", threadTs: "1792679804.027000", url: "https://instacart.slack.com/archives/C013GQW0Y3C/p1792680357010209?thread_ts=1792679804.027000",
    text: "I closed out the original request you sent." };
  expect(classifyOncallMessage(message)).toBeNull();
  expect(classifyOncallMessage({ ...message, text: "I'm split on another issue right now." })).toBeNull();
  expect(classifyOncallMessage({ ...message, text: "Hi team! Would someone review this request before testing begins?" }))
    .toEqual({ kind: "slack", prUrl: null });
});

test("direct GitHub requests are actionable while Slack-only PR requests are not falsely closed", async () => {
  const store = openStore(":memory:");
  try {
    const api = createApi(store);
    const slackUrl = "https://github.com/instacart/carrot/pull/880331";
    upsertOncallItem(store.db, { source_key: `pr:${slackUrl}`, kind: "pr",
      title: "Review request", body: "<@U07UX04KTFA> review please", pr_url: slackUrl,
      slack_message_url: "https://instacart.slack.com/archives/C1/p1234567890000000" });
    const directUrl = "https://github.com/instacart/carrot/pull/891165";
    store.github.upsertPr({ url: directUrl, owner: "instacart", repo: "carrot", number: 891165,
      title: "Make permissions explicit", author: "contributor", is_draft: false, state: "open", review_decision: null,
      updated_at: "2026-10-22T10:00:00Z", comments: 0, checks: [], checks_summary: "none", watched: false,
      ignored_checks: [], lists: ["review_requested"], item_id: null, source_dir: null, fetched_at: "2026-10-22T10:00:00Z" });
    syncDirectGithubReviews(store);
    const first = await (await api(new Request("http://127.0.0.1/api/oncall"))).json();
    expect(first.items.map((item: { pr_url: string; status: string }) => [item.pr_url, item.status]).sort())
      .toEqual([[slackUrl, "open"], [directUrl, "open"]].sort());
    store.db.query("UPDATE github_prs SET lists = '[]' WHERE url = ?").run(directUrl);
    syncDirectGithubReviews(store);
    const second = await (await api(new Request("http://127.0.0.1/api/oncall"))).json();
    expect(second.items.map((item: { pr_url: string; status: string }) => [item.pr_url, item.status]).sort())
      .toEqual([[slackUrl, "open"], [directUrl, "done"]].sort());
  } finally { store.close(); }
});

test("polling pause is persisted in oncall_state and exposed on the board", async () => {
  const store = openStore(":memory:");
  try {
    const api = createApi(store);
    const board = () => api(new Request("http://127.0.0.1/api/oncall")).then(response => response.json());
    const pausedState = () => store.db.query<{ value: string }, []>("SELECT value FROM oncall_state WHERE key = 'polling_paused'").get()?.value;
    expect((await board()).polling_paused).toBe(false);

    const paused = await post(api, "/api/oncall/polling", "PATCH", { paused: true });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({ polling_paused: true });
    expect(pausedState()).toBe("1");
    expect((await board()).polling_paused).toBe(true);

    const resumed = await post(api, "/api/oncall/polling", "PATCH", { paused: false });
    expect(await resumed.json()).toEqual({ polling_paused: false });
    expect(pausedState()).toBe("0");
    expect((await board()).polling_paused).toBe(false);

    expect((await post(api, "/api/oncall/polling", "PATCH", {})).status).toBe(422);
    expect((await post(api, "/api/oncall/polling", "PATCH", { paused: "yes" })).status).toBe(422);
    expect((await post(api, "/api/oncall/polling", "PATCH", { paused: true }, "https://example.com")).status).toBe(403);
    expect((await board()).polling_paused).toBe(false);
  } finally { store.close(); }
});

test("pause survives reopening the database and a paused poller does no external work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-oncall-pause-"));
  const database = join(dir, "pause.sqlite");
  const store = openStore(database);
  const realFetch = globalThis.fetch;
  let reopened: ReturnType<typeof openStore> | null = null;
  let poller: ReturnType<typeof createOncallPoller> | null = null;
  try {
    await post(createApi(store), "/api/oncall/polling", "PATCH", { paused: true });
    store.close();

    reopened = openStore(database);
    const api = createApi(reopened);
    expect((await (await api(new Request("http://127.0.0.1/api/oncall"))).json()).polling_paused).toBe(true);

    let fetches = 0;
    const blockedFetch = Object.assign(
      async (): Promise<Response> => { fetches++; throw new Error("network disabled for this test"); },
      { preconnect: () => {} },
    ) satisfies typeof fetch;
    globalThis.fetch = blockedFetch;
    poller = createOncallPoller(reopened, () => {}, null);
    poller.start();
    await poller.poll();
    expect(fetches).toBe(0);
    expect(reopened.db.query<{ value: string }, []>("SELECT value FROM oncall_state WHERE key = 'last_polled_at'").get()).toBeNull();

    await post(api, "/api/oncall/polling", "PATCH", { paused: false });
    await poller.poll();
    expect(fetches).toBeGreaterThan(0);
    expect(reopened.db.query<{ value: string }, []>("SELECT value FROM oncall_state WHERE key = 'last_polled_at'").get()?.value).toBeTruthy();
  } finally {
    globalThis.fetch = realFetch;
    poller?.stop();
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
