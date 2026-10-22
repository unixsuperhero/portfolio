import { randomUUID } from "node:crypto";
import type { OncallStatus } from "@portfolio/core";
import { getOncallItem, getPromptRun, isPollingPaused, listOncallItems, listPromptRuns, setOncallStatus, setPollingPaused, upsertOncallItem } from "../../db/src/oncall.ts";
import type { Ctx } from "./context.ts";
import { error, json, notFound, readJson } from "./http.ts";
import { ONCALL_PROMPTS } from "./oncall-prompts.ts";

const STATUSES = new Set<OncallStatus>(["open", "working", "blocked", "done", "dismissed"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "wails.localhost"]);

function trustedRequest(request: Request): boolean {
  const host = new URL(request.url).hostname;
  if (!LOCAL_HOSTS.has(host) || request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "wails:" && LOCAL_HOSTS.has(url.hostname))
      || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && ["4387", "4388", "9245"].includes(url.port));
  } catch { return false; }
}

function statusFromInput(value: unknown): OncallStatus | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && STATUSES.has(value as OncallStatus)) return value as OncallStatus;
  return undefined;
}

function sourceLink(value: unknown, hosts: readonly string[]): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.includes(url.hostname) ? url.toString() : undefined;
  } catch { return undefined; }
}

export async function oncallRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  if (!trustedRequest(request)) return error(403, "Oncall is only available from the local Portfolio app");
  const pathname = new URL(request.url).pathname;
  const db = ctx.store.db;
  if (request.method === "GET" && pathname === "/api/oncall") {
    return json({ items: listOncallItems(db), prompts: ONCALL_PROMPTS, runs: listPromptRuns(db),
      polling_paused: isPollingPaused(db),
      ...(ctx.oncallPoller?.status() ?? { last_polled_at: null, polling_error: null }) });
  }
  if (request.method === "PATCH" && pathname === "/api/oncall/polling") {
    const body = await readJson(request);
    if (typeof body.paused !== "boolean") return error(422, "Expected paused to be a boolean");
    return json({ polling_paused: setPollingPaused(db, body.paused) });
  }
  if (request.method === "POST" && pathname === "/api/oncall/items") {
    const body = await readJson(request);
    const title = body.title;
    const status = body.status === undefined ? null : statusFromInput(body.status);
    const prUrl = sourceLink(body.pr_url, ["github.com"]);
    const channelUrl = sourceLink(body.slack_channel_url, ["instacart.slack.com", "instacart.enterprise.slack.com"]);
    const messageUrl = sourceLink(body.slack_message_url, ["instacart.slack.com", "instacart.enterprise.slack.com"]);
    const threadUrl = sourceLink(body.slack_thread_url, ["instacart.slack.com", "instacart.enterprise.slack.com"]);
    if (typeof title !== "string" || !title.trim() || title.length > 500 || (body.body !== undefined && typeof body.body !== "string")
      || (body.kind !== undefined && body.kind !== "slack" && body.kind !== "pr")
      || (body.pr_url != null && prUrl === undefined) || (body.slack_channel_url != null && channelUrl === undefined)
      || (body.slack_message_url != null && messageUrl === undefined) || (body.slack_thread_url != null && threadUrl === undefined)
      || (body.slack_channel !== undefined && typeof body.slack_channel !== "string")
      || (body.author !== undefined && typeof body.author !== "string") || (body.status !== undefined && status === undefined)) {
      return error(422, "Expected a title, optional text, valid source links, and a valid status");
    }
    const item = upsertOncallItem(db, { source_key: `manual:${randomUUID()}`, kind: body.kind === "pr" ? "pr" : "slack",
      title: title.trim(), body: typeof body.body === "string" ? body.body : "",
      pr_url: prUrl, slack_channel: typeof body.slack_channel === "string" ? body.slack_channel.replace(/^#/, "") : null,
      slack_channel_url: channelUrl, slack_message_url: messageUrl, slack_thread_url: threadUrl,
      author: typeof body.author === "string" ? body.author : null });
    return json(status ? setOncallStatus(db, item.id, status) : item, 201);
  }
  if (request.method === "PATCH" && pathname.startsWith("/api/oncall/items/")) {
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id < 1 || !getOncallItem(db, id)) return notFound();
    const body = await readJson(request);
    if (!("status" in body)) return error(422, "status is required; null clears the manual override");
    const status = statusFromInput(body.status);
    if (status === undefined) return error(422, "Unknown oncall status");
    return json(setOncallStatus(db, id, status));
  }
  if (request.method === "GET" && pathname === "/api/oncall/prompts/runs") return json({ runs: listPromptRuns(db) });
  if (request.method === "GET" && pathname.startsWith("/api/oncall/prompts/runs/")) {
    const run = getPromptRun(db, Number(params.id));
    return run ? json({ run }) : notFound();
  }
  if (request.method === "POST" && pathname.startsWith("/api/oncall/prompts/")) {
    if (!ctx.oncallPromptRunner) return error(503, "Oncall prompt runner is not running");
    if (!ONCALL_PROMPTS.some(prompt => prompt.id === params.id)) return notFound();
    try { return json({ run: await ctx.oncallPromptRunner.start(params.id) }, 202); }
    catch (cause) { return error(422, (cause as Error).message); }
  }
  return notFound();
}
