const MCP_URL = "http://127.0.0.1:15245/https://mcp.instacart.tools/api/v1/proxy/4f73fee8-5586-455c-a9f6-20cefe4abb09/mcp";

export interface SlackMessage {
  channel: string;
  channelId: string;
  author: string;
  authorId: string;
  ts: string;
  url: string;
  threadTs: string;
  text: string;
}

interface McpText { type: "text"; text: string }

async function slackTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Slack connector returned HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("result" in data)) throw new Error("Slack connector returned no result");
  const result = data.result;
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    throw new Error("Slack connector returned invalid content");
  }
  const content: unknown = result.content[0];
  if (!content || typeof content !== "object" || !("type" in content) || content.type !== "text" || !("text" in content) || typeof content.text !== "string") {
    throw new Error("Slack connector returned no text");
  }
  const parsed: unknown = JSON.parse((content as McpText).text);
  if (!("isError" in result) || !result.isError) {
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  throw new Error(`Slack connector ${name} failed: ${(content as McpText).text.slice(0, 500)}`);
}

export async function findSlackChannel(name: string): Promise<string> {
  const data = await slackTool("slack_search_channels", {
    keywords: [name], natural_language_query: "", channel_types: "public_channel,private_channel", limit: 20, response_format: "concise",
  });
  const text = String(data.results ?? "");
  const match = new RegExp(`(?:^|\\n)\\d+\\. #${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(([CG][A-Z0-9]+)\\)`).exec(text);
  if (!match) throw new Error(`Slack channel #${name} was not found or is inaccessible`);
  return match[1];
}

export function parseSlackResults(text: string): SlackMessage[] {
  const messages: SlackMessage[] = [];
  for (const block of text.split(/### Result \d+ of \d+\n/).slice(1)) {
    const channel = /^Channel: #([^\n]+) \(ID: ([CG][A-Z0-9]+)\)/m.exec(block);
    const author = /^From: (.*?) \(ID: ([UBW][A-Z0-9]+)\)(?: +(\[BOT\]))?/m.exec(block);
    const ts = /^Message_ts: (\d+\.\d+)$/m.exec(block);
    const permalink = /^Permalink: \[link\]\((https:\/\/[^)]+)\)/m.exec(block);
    const textStart = block.indexOf("Text: \n");
    if (!channel || !author || !ts || !permalink || textStart < 0) throw new Error("Slack search message is missing source context");
    const textEnd = block.indexOf("\n\n---", textStart);
    const body = block.slice(textStart + "Text: \n".length, textEnd < 0 ? undefined : textEnd).trim();
    const link = new URL(permalink[1]);
    if (!link.hostname.endsWith("slack.com") || !link.pathname.includes(`/archives/${channel[2]}/`)) {
      throw new Error("Slack returned a message permalink for another channel");
    }
    messages.push({ channel: channel[1], channelId: channel[2], author: author[1].trim() || (author[3] ? "Bot" : author[2]), authorId: author[2], ts: ts[1],
      url: link.toString(), threadTs: link.searchParams.get("thread_ts") ?? ts[1], text: body });
  }
  return messages;
}

function nextCursor(info: unknown): string | null {
  return typeof info === "string" ? /cursor[: ]+`([^`]+)`/.exec(info)?.[1] ?? null : null;
}

/** Search rather than channel history: replies in older threads have new timestamps and must be seen. */
export async function searchSlackMessages(channelId: string, after: number, before: number): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor: string | null = null;
  do {
    const data = await slackTool("slack_search_public_and_private", {
      filters: `in:<#${channelId}>`, after: String(after), before: String(before),
      sort: "timestamp", sort_dir: "asc", limit: 20, response_format: "detailed",
      include_context: false, include_bots: true, natural_language_query: "", ...(cursor ? { cursor } : {}),
    });
    if (typeof data.results !== "string") throw new Error("Slack search returned no message list");
    messages.push(...parseSlackResults(data.results));
    cursor = nextCursor(data.pagination_info);
  } while (cursor);
  return messages;
}

export async function readSlackThread(channelId: string, threadTs: string): Promise<string> {
  const chunks: string[] = [];
  let cursor: string | null = null;
  do {
    const data = await slackTool("slack_read_thread", {
      channel_id: channelId, message_ts: threadTs, limit: 100, response_format: "detailed", ...(cursor ? { cursor } : {}),
    });
    if (typeof data.messages !== "string") throw new Error("Slack thread returned no messages");
    chunks.push(data.messages);
    cursor = nextCursor(data.pagination_info);
  } while (cursor);
  return chunks.join("\n\n");
}
