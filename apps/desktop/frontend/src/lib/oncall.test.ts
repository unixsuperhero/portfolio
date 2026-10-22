import { expect, test } from "bun:test";
import type { OncallItem } from "../types.ts";
import { groupOncallItems } from "./oncall.ts";

const base: OncallItem = {
  id: 1, kind: "slack", title: "First reply", body: "", thread_context: "",
  suggested_status: "open", manual_status: null, status: "open",
  slack_channel: "support", slack_channel_url: null, slack_message_url: null,
  slack_thread_url: null, author: null, pr_url: null, created_at: "2026-10-22T10:00:00Z",
  updated_at: "2026-10-22T10:00:00Z",
};

const root = "https://instacart.enterprise.slack.com/archives/C1/p1792614069210349";
const reply = "https://instacart.enterprise.slack.com/archives/C1/p1792682220872919?thread_ts=1792614069.210349&cid=C1";

test("groups Slack replies with their root while keeping other threads and PRs separate", () => {
  const groups = groupOncallItems([
    { ...base, id: 1, slack_thread_url: reply },
    { ...base, id: 2, title: "Different thread", slack_thread_url: "https://instacart.slack.com/archives/C1/p1792682003392469" },
    { ...base, id: 3, title: "Root request", slack_thread_url: root },
    { ...base, id: 4, kind: "pr", title: "Direct review", slack_channel: null, slack_thread_url: null },
    { ...base, id: 5, title: "Another reply", slack_thread_url: "https://instacart.slack.com/archives/C1/p1792681157175939?thread_ts=1792614069.210349" },
  ]);
  expect(groups.map(group => group.items.map(item => item.id))).toEqual([[1, 3, 5], [2], [4]]);
  expect(groups[0].thread?.url).toBe(root);
  expect(groups[1].thread?.url).toBe("https://instacart.slack.com/archives/C1/p1792682003392469");
  expect(groups[2].thread).toBeNull();
});
