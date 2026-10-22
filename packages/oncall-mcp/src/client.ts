/**
 * Fetch-based client for the oncall half of the Portfolio desktop API (port 4388).
 *
 * The shapes below mirror the API contract. They are declared here rather than
 * imported from `@portfolio/core` on purpose: this package must run straight from
 * a checkout (`bun bin/pf-oncall-mcp`) with no workspace install and no other
 * package's churn breaking the MCP server.
 */

import { isRecord } from "./validate.ts";

export type OncallItemKind = "slack" | "pr";
export type OncallItemStatus = "open" | "working" | "blocked" | "done" | "dismissed";
export type PromptRunStatus = "running" | "completed" | "failed";

export interface OncallItem {
  id: number;
  kind: OncallItemKind;
  title: string;
  body: string;
  /** The effective status: the manual override when one is set, else `suggested_status`. */
  status: string;
  suggested_status: string;
  slack_channel: string | null;
  slack_channel_url: string | null;
  slack_message_url: string | null;
  slack_thread_url: string | null;
  author: string | null;
  pr_url: string | null;
  created_at: string;
}

export interface OncallPrompt {
  id: string;
  title: string;
  /** Working directory the prompt runs in. */
  directory: string;
  body: string;
}

export interface PromptRun {
  id: number;
  prompt_id: string;
  status: PromptRunStatus;
  output: string;
  started_at: string;
  finished_at: string | null;
}

/** GET /api/oncall */
export interface OncallBoard {
  items: OncallItem[];
  prompts: OncallPrompt[];
  runs: PromptRun[];
  last_polled_at: string | null;
  polling_error: string | null;
}

/** POST /api/oncall/items — `status` sets the manual override straight away. */
export interface OncallItemInput {
  title: string;
  body?: string;
  kind?: OncallItemKind;
  pr_url?: string;
  slack_channel?: string;
  slack_channel_url?: string;
  slack_message_url?: string;
  slack_thread_url?: string;
  author?: string;
  status?: OncallItemStatus;
}

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class OncallApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "OncallApiError";
  }
}

export const API_PORT = 4388;

/** `PORTFOLIO_API_URL` when set, else the desktop app's default port. */
export function defaultApiUrl(env: Record<string, string | undefined> = globalThis.process?.env ?? {}): string {
  const configured = env.PORTFOLIO_API_URL?.trim();
  return (configured || `http://127.0.0.1:${API_PORT}`).replace(/\/+$/, "");
}

/**
 * The API's item, checked as far as the tools depend on it — id, kind, title, status.
 * The remaining fields are the API's contract; they pass through to the caller verbatim.
 */
const isItem = (value: unknown): value is OncallItem => isRecord(value)
  && typeof value.id === "number"
  && (value.kind === "slack" || value.kind === "pr")
  && typeof value.title === "string"
  && typeof value.status === "string";

/**
 * `POST /api/oncall/items` and `PATCH /api/oncall/items/:id` answer with the item,
 * sometimes wrapped in `{ item }`.
 */
const unwrapItem = (body: unknown): OncallItem => {
  const candidate = isRecord(body) && isRecord(body.item) ? body.item : body;
  if (!isItem(candidate)) throw new OncallApiError(0, `unexpected response: ${JSON.stringify(body)}`);
  return candidate;
};

export class OncallApi {
  readonly base: string;
  private fetcher: Fetcher;

  constructor(base: string = defaultApiUrl(), options: { fetch?: Fetcher } = {}) {
    this.base = base.replace(/\/+$/, "");
    // Wrapped, not stored: browsers throw "Illegal invocation" when fetch is called as a method.
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  url(path: string): string {
    return `${this.base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, ...rest } = init;
    const headers: Record<string, string> = { ...(rest.headers as Record<string, string> | undefined) };
    let body = rest.body;
    if (json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(json);
    }
    let response: Response;
    try {
      response = await this.fetcher(this.url(path), { ...rest, headers, body });
    } catch (error) {
      throw new OncallApiError(
        0,
        `the Portfolio API is not answering at ${this.base} (${(error as Error).message}). ` +
        `Start the desktop app, or point PORTFOLIO_API_URL at a running instance.`,
      );
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text.trim()) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    if (response.status >= 400) {
      const message = (parsed as { error?: string } | null)?.error
        ?? (typeof parsed === "string" && parsed.trim() ? parsed.trim() : `${response.status} ${response.statusText}`);
      throw new OncallApiError(response.status, message, parsed);
    }
    return parsed as T;
  }

  /** The whole board: items, prompts, and how the last poll went. */
  board(): Promise<OncallBoard> {
    return this.request<OncallBoard>("/api/oncall");
  }

  async createItem(input: OncallItemInput): Promise<OncallItem> {
    return unwrapItem(await this.request("/api/oncall/items", { method: "POST", json: input }));
  }

  /** `null` clears the manual override and falls back to the suggested status. */
  async setStatus(id: number, status: OncallItemStatus | null): Promise<OncallItem> {
    return unwrapItem(await this.request(`/api/oncall/items/${id}`, { method: "PATCH", json: { status } }));
  }

  async runPrompt(promptId: string): Promise<PromptRun> {
    const body = await this.request<{ run: PromptRun }>(`/api/oncall/prompts/${encodeURIComponent(promptId)}/run`, { method: "POST" });
    if (!body?.run) throw new OncallApiError(0, `unexpected response: ${JSON.stringify(body)}`);
    return body.run;
  }

  async runs(): Promise<PromptRun[]> {
    const body = await this.request<{ runs: PromptRun[] }>("/api/oncall/prompts/runs");
    return body?.runs ?? [];
  }

  /** One run, with its captured output. */
  async run(id: number): Promise<PromptRun> {
    const body = await this.request<{ run: PromptRun }>(`/api/oncall/prompts/runs/${id}`);
    if (!body?.run) throw new OncallApiError(0, `unexpected response: ${JSON.stringify(body)}`);
    return body.run;
  }
}
