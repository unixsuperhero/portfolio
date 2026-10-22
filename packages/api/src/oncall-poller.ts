import type { Store } from "@portfolio/db";
import { getOncallState, isPollingPaused, setOncallState, upsertOncallItem } from "../../db/src/oncall.ts";
import { findSlackChannel, readSlackThread, searchSlackMessages } from "./slack-oncall.ts";
import type { SlackMessage } from "./slack-oncall.ts";

export const ONCALL_CHANNELS = [
  "eng-retailer-app", "retailer-app-support", "team-insights-portal", "rpp-bot-notifications",
  "team-sfp-onboarding-working-grp", "team-retailer-app-eng", "retailer-onboarding-critical", "askspansions",
] as const;

const INTERVAL_MS = 6 * 60_000;
const JOSH_SLACK_ID = "U07UX04KTFA";
const PR_URL = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i;
const REQUEST = /\b(?:can someone|could (?:you|we|someone)|please|need(?:s)?|request(?:ing)?\b|help|investigat\w*|fix\b|review|block\w*|fail\w*|urgent|error|oncall|pending|approv\w*|alert|down|incident|broken|not working|reject\w*|timed? out|anyone know)\b/i;
const ONCALL = /(?:<!subteam\^[^>]+\|@?on.?call>|@on.?call\b|\bon.?call(?:\s+team)?[,:]\s*(?:could|can|please|review|need|help))/i;

export function classifyOncallMessage(message: SlackMessage): { kind: "slack" | "pr"; prUrl: string | null } | null {
  const targetJosh = message.text.includes(`<@${JOSH_SLACK_ID}>`) || message.text.includes(`<@${JOSH_SLACK_ID}|`)
    || /@joshua[.\s]toyota\b/i.test(message.text);
  const targetOncall = ONCALL.test(message.text);
  const prUrl = PR_URL.exec(message.text)?.[0] ?? null;
  // A generic "team, review my PR" and bot team reminders are never personal review requests.
  if (prUrl) return targetJosh || targetOncall ? { kind: "pr", prUrl } : null;
  if (targetJosh || targetOncall) return { kind: "slack", prUrl: null };
  if (!REQUEST.test(message.text)) return null;
  if (/^(?:thanks|thank you|resolved|done|lgtm|acknowledged|i (?:closed out|handled|resolved|fixed|merged|approved|shipped))\b/i.test(message.text)) return null;
  return { kind: "slack", prUrl: null };
}

function slackMessageUrl(message: SlackMessage): string {
  const url = new URL(message.url);
  url.search = "";
  return url.toString();
}

function statusFromReply(text: string): "done" | "working" | null {
  if (/\b(?:resolved|fixed|merged|approved|shipped|works now|handled|closed out)\b/i.test(text)) return "done";
  if (/\b(?:working on|looking into|taking this|investigating)\b/i.test(text)) return "working";
  return null;
}

async function ingestMessage(store: Store, message: SlackMessage): Promise<void> {
  const replyStatus = message.threadTs !== message.ts ? statusFromReply(message.text) : null;
  if (message.threadTs !== message.ts) {
    const rootUrl = new URL(message.url);
    rootUrl.pathname = `/archives/${message.channelId}/p${message.threadTs.replace(".", "")}`;
    rootUrl.search = "";
    const root = store.db.query<{ id: number }, [string, string]>(
      "SELECT id FROM oncall_items WHERE source_key = ? OR slack_message_url = ? LIMIT 1",
    ).get(`slack:${message.channelId}:${message.threadTs}`, rootUrl.toString());
    if (root) {
      const context = await readSlackThread(message.channelId, message.threadTs).catch(() => "");
      store.db.query("UPDATE oncall_items SET suggested_status = COALESCE(?, suggested_status), thread_context = CASE WHEN ? <> '' THEN ? ELSE thread_context END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(replyStatus, context, context, root.id);
    }
    if (replyStatus) return;
  }
  const classification = classifyOncallMessage(message);
  if (!classification) return;
  const threadUrl = message.threadTs === message.ts ? slackMessageUrl(message) : message.url;
  const previous = classification.prUrl
    ? store.db.query<{ thread_context: string }, [string]>("SELECT thread_context FROM oncall_items WHERE source_key = ?").get(`pr:${classification.prUrl}`)
    : null;
  let threadContext = previous?.thread_context ?? "";
  try {
    threadContext = await readSlackThread(message.channelId, message.threadTs);
  } catch (error) {
    // Keep the request rather than lose it when Slack denies a thread read.
    threadContext = `${message.author}: ${message.text}\n\nThread read unavailable: ${(error as Error).message}`;
  }
  const createdAt = new Date(Number(message.ts) * 1000).toISOString();
  upsertOncallItem(store.db, {
    source_key: classification.prUrl ? `pr:${classification.prUrl}` : `slack:${message.channelId}:${message.ts}`,
    kind: classification.kind,
    title: classification.prUrl ? `Review ${classification.prUrl.split("/").slice(-2).join("#")}` : message.text.split("\n")[0].slice(0, 160),
    body: message.text,
    thread_context: threadContext,
    slack_channel: message.channel,
    slack_channel_url: `https://instacart.enterprise.slack.com/archives/${message.channelId}`,
    slack_message_url: slackMessageUrl(message),
    slack_thread_url: threadUrl,
    author: message.author,
    pr_url: classification.prUrl,
    created_at: createdAt,
  });
}

export function syncDirectGithubReviews(store: Store): void {
  const requested = new Set<string>();
  for (const pr of store.github.listPrs({ list: "review_requested", hidden: false })) {
    if (pr.state !== "open" || pr.is_draft) continue;
    requested.add(pr.url);
    upsertOncallItem(store.db, { source_key: `pr:${pr.url}`, kind: "pr", title: pr.title,
      body: "", pr_url: pr.url, suggested_status: "open", created_at: pr.updated_at });
  }
  for (const item of store.db.query<{ source_key: string; pr_url: string; slack_message_url: string | null }, []>(
    "SELECT source_key, pr_url, slack_message_url FROM oncall_items WHERE kind = 'pr' AND pr_url IS NOT NULL",
  ).all()) {
    if (requested.has(item.pr_url)) continue;
    const pr = store.github.findPrByUrl(item.pr_url);
    if (pr && (pr.state !== "open" || pr.is_draft || (!item.slack_message_url && !pr.lists.includes("review_requested")))) {
      store.db.query("UPDATE oncall_items SET suggested_status = 'done', updated_at = CURRENT_TIMESTAMP WHERE source_key = ?").run(item.source_key);
    }
  }
}

export interface OncallPoller {
  poll(): Promise<void>;
  start(): void;
  stop(): void;
  status(): { last_polled_at: string | null; polling_error: string | null };
}

export function createOncallPoller(store: Store, log: (message: string) => void, githubLogin: string | null): OncallPoller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let lastError: string | null = null;
  const channelIds = new Map<string, string>();

  async function poll(): Promise<void> {
    // A paused poller keeps its timer armed but never touches Slack, GitHub, or its checkpoints,
    // so resume just waits for the next tick and still sees every message since the last poll.
    if (isPollingPaused(store.db)) return;
    if (inflight) return inflight;
    inflight = (async () => {
      const started = Math.floor(Date.now() / 1000);
      const errors: string[] = [];
      if (githubLogin?.toLowerCase() === "instajosh") syncDirectGithubReviews(store);
      else errors.push("GitHub review intake requires gh authenticated as instajosh");
      for (const channel of ONCALL_CHANNELS) {
        try {
          let id = channelIds.get(channel);
          if (!id) {
            id = await findSlackChannel(channel);
            channelIds.set(channel, id);
          }
          const key = `slack_since:${channel}`;
          const after = Number(getOncallState(store.db, key) ?? started - 360);
          const messages = await searchSlackMessages(id, after, started);
          for (const message of messages) await ingestMessage(store, message);
          setOncallState(store.db, key, String(started));
        } catch (error) {
          const reason = `${channel}: ${(error as Error).message}`;
          errors.push(reason);
          log(`oncall: ${reason}`);
        }
      }
      lastError = errors.length ? errors.join("; ") : null;
      setOncallState(store.db, "last_polled_at", new Date().toISOString());
      if (lastError) log(`oncall: ${errors.length} channel polls failed`);
    })().finally(() => { inflight = null; });
    return inflight;
  }

  function schedule(): void {
    timer = setTimeout(async () => {
      try { await poll(); } catch (error) { lastError = (error as Error).message; log(`oncall: ${lastError}`); }
      schedule();
    }, INTERVAL_MS);
  }

  return {
    poll,
    start(): void {
      if (timer) return;
      void poll().catch(error => { lastError = (error as Error).message; log(`oncall: ${lastError}`); });
      schedule();
    },
    stop(): void { clearTimeout(timer ?? undefined); timer = null; },
    status(): { last_polled_at: string | null; polling_error: string | null } {
      return { last_polled_at: getOncallState(store.db, "last_polled_at"), polling_error: lastError };
    },
  };
}

