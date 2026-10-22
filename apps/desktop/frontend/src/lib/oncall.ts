import type { OncallStatus } from "@portfolio/core";
import type { OncallItem } from "../types.ts";

/** The statuses a person can set on an oncall item, in the order the pickers show them. */
export const ONCALL_STATUSES: readonly { value: OncallStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "working", label: "Working" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "dismissed", label: "Dismissed" },
];

export const oncallStatusLabel = (status: OncallStatus) =>
  ONCALL_STATUSES.find(option => option.value === status)?.label ?? status;

type OncallGroup = { key: string; thread: { url: string; channel: string | null; startedAt: string } | null; items: OncallItem[] };

/** Keep the first visible item's position for each thread while retaining the order within it. */
export function groupOncallItems(items: readonly OncallItem[]): OncallGroup[] {
  const groups = new Map<string, OncallGroup>();
  for (const item of items) {
    let key = "other";
    let thread: OncallGroup["thread"] = null;
    const link = item.slack_thread_url ?? item.slack_message_url;
    if (link) {
      try {
        const url = new URL(link);
        const match = url.pathname.match(/^\/archives\/([^/]+)\/p(\d{16})\/?$/);
        if (match) {
          const threadTs = url.searchParams.get("thread_ts");
          const messageId = threadTs && /^\d+\.\d{6}$/.test(threadTs) ? threadTs.replace(".", "") : match[2];
          key = `thread:${match[1]}:${messageId}`;
          if (!groups.has(key)) thread = { url: `${url.origin}/archives/${match[1]}/p${messageId}`, channel: item.slack_channel,
            startedAt: new Date(Number(messageId) / 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) };
        }
      } catch { /* A malformed source link stays in Other actions. */ }
    }
    let group = groups.get(key);
    if (!group) {
      group = { key, thread, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
