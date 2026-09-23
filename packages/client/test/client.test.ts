import { describe, expect, test } from "bun:test";
import { openStore } from "@portfolio/db";
import { createApi } from "@portfolio/api";
import type { ApiOptions } from "@portfolio/api";
import { PortfolioApiError, PortfolioClient } from "../src/index.ts";

const calls: { url: string; init: RequestInit }[] = [];

/** Routes fetch calls straight into a real createApi handler, so the client is tested end to end. */
function fakeClient(): PortfolioClient {
  return fakeClientWithStore().client;
}

function fakeClientWithStore(options: { withPoller?: boolean } = {}): { client: PortfolioClient; store: ReturnType<typeof openStore> } {
  const store = openStore(":memory:");
  const idleStatus = { last_poll_at: null, next_poll_at: null, rate: null, polling: false, error: null, gh_ok: false, login: null };
  const api = createApi(store, {
    render: async (markdown, options) => `<h1>${options.title}</h1>${markdown.length}`,
    scanPorts: () => ({ scanned_at: "t", herdr_available: false, warnings: [], ports: [] }),
    prPoller: options.withPoller ? ({ status: () => idleStatus } as unknown as ApiOptions["prPoller"]) : undefined,
  });
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const request = new Request(String(url), init);
    return api(request);
  }) as unknown as typeof fetch;
  return { client: new PortfolioClient("http://x", { fetch: fetcher }), store };
}

test("builds urls, sends json bodies, surfaces errors", async () => {
  const client = fakeClient();
  expect(await client.health()).toEqual({ ok: true, items: 0 });
  expect(await client.items({ q: "a b", limit: 5, starred: true, pinned: false })).toEqual([]);
  expect(calls.at(-1)!.url).toBe("http://x/api/items?q=a+b&starred=1&limit=5");

  const quick = await client.quickAdd("https://x.dev", { tags: "t" });
  expect(quick).toMatchObject({ type: "link" });
  expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ content: "https://x.dev", type: undefined, tags: "t" });

  await client.killPort(12).catch(() => {});
  expect(calls.at(-1)!.init.body).toBe('{"pid":12,"signal":"TERM"}');

  await expect(client.item(9999)).rejects.toBeInstanceOf(PortfolioApiError);
  expect(client.absolute("https://e.com")).toBe("https://e.com");
  expect(client.absolute("/items/1")).toBe("http://x/items/1");
});

test("connection refusal becomes a status 0 error", async () => {
  const client = new PortfolioClient("http://127.0.0.1:1", { fetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
  await expect(client.health()).rejects.toMatchObject({ status: 0 });
});

describe("end to end against createApi", () => {
  test("items, tags, path-action, detect", async () => {
    const client = fakeClient();
    const created = await client.createItem({ type: "note", title: "Hello", content: "body", tags: "a,b" });
    expect(created.href).toBe(`/items/${created.id}`);
    const detail = await client.item(created.id);
    expect(detail).toMatchObject({ title: "Hello", tags: ["a", "b"] });
    await client.updateItem(created.id, { title: "Updated" });
    expect((await client.item(created.id)).title).toBe("Updated");
    expect((await client.toggle(created.id, "starred")).value).toBe(true);
    expect(await client.addTags(created.id, ["z"])).toMatchObject({ tags: ["a", "b", "z"] });
    expect(await client.removeTag(created.id, "z")).toMatchObject({ tags: ["a", "b"] });
    expect(await client.itemHtml(created.id)).toBe("<h1>Hello</h1>4");
    expect(await client.deleteItem(created.id)).toEqual({ ok: true });

    const detected = await client.detect("https://example.com/pull/9");
    expect(detected.type).toBe("pr");
  });

  test("portfolios, cards, categories", async () => {
    const client = fakeClient();
    const { id: portfolioId } = await client.createPortfolio("Dash");
    const { id: cardId } = await client.createCard(portfolioId, { title: "Clock", kind: "clock", config: { format: "24h" } });
    const view = await client.portfolio(portfolioId);
    expect(view.cards[0]).toMatchObject({ kind: "clock", items: [], total: 0 });
    expect(await client.updateCard(cardId, { title: "Clock 2", kind: "clock" })).toEqual({ ok: true });
    expect(await client.deleteCard(cardId)).toEqual({ ok: true });
    expect(await client.deletePortfolio(portfolioId)).toEqual({ ok: true });

    const { id: categoryId } = await client.createCategory({ name: "docs", kind: "document", slots: [] });
    const category = await client.category(categoryId);
    expect(category.members).toEqual([]);
    expect(await client.updateCategory(categoryId, { name: "docs2" })).toEqual({ ok: true });
    expect(await client.deleteCategory(categoryId)).toEqual({ ok: true });
  });

  test("settings, home, tasks", async () => {
    const client = fakeClient();
    expect(await client.settings()).toMatchObject({ home_portfolio_id: null });
    const { id } = await client.createPortfolio("Home");
    await client.updateSettings({ home_portfolio_id: id });
    expect((await client.home()).portfolio).toMatchObject({ name: "Home" });

    const { id: taskId } = await client.createTask({ title: "Stretch", recurrence: "daily", reminders: ["08:30"] });
    const task = await client.task(taskId);
    expect(task).toMatchObject({ title: "Stretch", history: [] });
    expect((await client.completeTask(taskId)).completed_today).toBe(true);
    expect((await client.uncompleteTask(taskId)).completed_today).toBe(false);
    expect((await client.tasks(true)).tasks).toHaveLength(1);
    expect((await client.todayTasks()).tasks).toHaveLength(1);
    expect(await client.deleteTask(taskId)).toEqual({ ok: true });
  });

  test("prs, pr events, github settings", async () => {
    const { client, store } = fakeClientWithStore({ withPoller: true });
    expect(await client.prs()).toMatchObject({ mine: [], review_requested: [], watched: [], status: { polling: false, gh_ok: false } });

    const id = store.github.upsertPr({
      url: "https://github.com/acme/app/pull/12", owner: "acme", repo: "app", number: 12, title: "Add widgets",
      author: "jearsh", is_draft: false, state: "open", review_decision: null, updated_at: "t", comments: 0,
      checks: [{ name: "codecov/patch", status: "pending", url: "", ignored: false }], checks_summary: "pending",
      watched: false, ignored_checks: [], lists: ["mine"], item_id: null, fetched_at: "t",
    });
    expect((await client.prs()).mine).toHaveLength(1);

    const patched = await client.setPrIgnoredChecks(id, ["codecov/*"]);
    expect(patched.ignored_checks).toEqual(["codecov/*"]);
    expect(patched.checks[0].ignored).toBe(true);

    store.github.insertEvents([{ pr_id: id, kind: "checks", message: "acme/app#12 checks none", at: "t2" }]);
    const { events } = await client.prEvents();
    expect(events).toHaveLength(1);
    expect(await client.markPrEventsSeen([events[0].id])).toEqual({ ok: true });
    expect((await client.prEvents()).events).toHaveLength(0);

    const settings = await client.updateSettings({ github_ignored_checks: ["ci/*"], github_poll_minutes: 5 });
    expect(settings).toMatchObject({ github_ignored_checks: ["ci/*"], github_poll_minutes: 5 });

    await expect(client.watchPr("https://github.com/acme/app", true)).rejects.toBeInstanceOf(PortfolioApiError);
  });
});
