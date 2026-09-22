import type { Card, CardResult, Detection, Item, ItemFilter, ItemType, ItemView, Portfolio, ResolvedSlot, WatchedDirectory } from "@portfolio/core";

export class PortfolioApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

export interface ClientOptions { fetch?: typeof fetch; headers?: Record<string, string> }
export type PortfolioCardView = Card & CardResult;
export type PortfolioView = Portfolio & { cards: PortfolioCardView[] };
export type QuickAddResult = { id: number; href: string; type: ItemType; title: string };
export type CreateItemInput = { type?: ItemType; title?: string; description?: string; url?: string; path?: string; category?: string; tags?: string; content?: string; source_path?: string; toc?: "true" | "false" };
export type BatchDocument = { sourcePath: string; content: string };

/** The default server: PORTFOLIO_SERVER or HDOCS_SERVER, else http://127.0.0.1:4387. */
export const defaultServer = (): string => (globalThis.process?.env?.PORTFOLIO_SERVER ?? globalThis.process?.env?.HDOCS_SERVER ?? "http://127.0.0.1:4387").replace(/\/$/, "");

const form = (fields: Record<string, string | string[] | undefined>): URLSearchParams => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) [value].flat().forEach(entry => body.append(key, entry));
  return body;
};

export class PortfolioClient {
  readonly base: string;
  private fetcher: typeof fetch;
  private headers: Record<string, string>;

  constructor(base: string = defaultServer(), options: ClientOptions = {}) {
    this.base = base.replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.headers = options.headers ?? {};
  }

  url(path: string, query: Record<string, string | number | boolean | undefined> = {}): string {
    const url = new URL(path.replace(/^\//, ""), `${this.base}/`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === false || value === "") continue;
      url.searchParams.set(key, value === true ? "1" : String(value));
    }
    return url.toString();
  }

  /** Absolute URL for an item href, which may already be external. */
  absolute(href: string): string { return /^https?:\/\//.test(href) ? href : this.url(href); }

  async request<T>(path: string, init: RequestInit & { query?: Record<string, string | number | boolean | undefined>; json?: unknown } = {}): Promise<T> {
    const { query, json, ...rest } = init;
    const headers: Record<string, string> = { ...this.headers, ...(rest.headers as Record<string, string> ?? {}) };
    let body = rest.body;
    if (json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
    let response: Response;
    try {
      response = await this.fetcher(this.url(path, query), { ...rest, headers, body, redirect: "manual" });
    } catch (error) {
      throw new PortfolioApiError(0, `Portfolio is unavailable at ${this.base}: ${(error as Error).message}`);
    }
    const text = await response.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch {}
    if (response.status >= 400) throw new PortfolioApiError(response.status, (parsed as { error?: string })?.error ?? text ?? response.statusText, parsed);
    return parsed as T;
  }

  health() { return this.request<{ ok: boolean; items: number }>("/health"); }

  async items(filter: ItemFilter = {}): Promise<ItemView[]> {
    const { items } = await this.request<{ items: ItemView[] }>("/api/items", { query: { q: filter.q, contents: filter.contents, pinned: filter.pinned, starred: filter.starred, type: filter.type, tag: filter.tag, limit: filter.limit } });
    return items;
  }

  item(id: number) { return this.request<Item & { href: string; tags: string[]; slots: ResolvedSlot[] }>(`/api/items/${id}`); }
  deleteItem(id: number, deleteFiles = false) { return this.request<null>(`/api/items/${id}`, { method: "DELETE", query: { delete_files: deleteFiles } }); }
  detect(content: string) { return this.request<Omit<Detection, "shape"> & { error?: string }>("/api/detect", { query: { content } }); }

  /** The quick-add box: paste anything, get the detected item. `type` overrides the guess. */
  quickAdd(content: string, options: { type?: ItemType; tags?: string } = {}) {
    return this.request<QuickAddResult>("/items/quick", { method: "POST", body: form({ content, type: options.type, tags: options.tags }) });
  }

  createItem(input: CreateItemInput) { return this.request<{ id: number; href: string }>("/api/items", { method: "POST", body: form(input as Record<string, string | undefined>) }); }

  /** Imports a batch of Markdown/HTML files as tracked documents, the way mdoc does. */
  createDocuments(documents: BatchDocument[], options: { roots: string[]; title?: string; description?: string; toc?: boolean }) {
    const body = new FormData();
    body.set("roots", JSON.stringify(options.roots));
    body.set("title", options.title ?? "");
    body.set("description", options.description ?? "");
    body.set("toc", String(options.toc ?? true));
    for (const document of documents) {
      body.append("file", new File([document.content], document.sourcePath.split("/").pop() ?? "document.md"));
      body.append("source_path", document.sourcePath);
    }
    return this.request<{ items: { id: number; href: string; source_path: string }[] }>("/api/documents", { method: "POST", body });
  }

  toggle(id: number, field: "pinned" | "starred") { return this.request<string>(`/items/${id}/toggle`, { method: "POST", body: form({ field }) }); }
  addTags(id: number, tags: string) { return this.request<null>(`/items/${id}/tags`, { method: "POST", body: form({ tags }) }); }

  portfolio(id: number) { return this.request<PortfolioView>(`/api/portfolios/${id}`); }
  createPortfolio(name: string, description = "") { return this.request<null>("/portfolios", { method: "POST", body: form({ name, description }) }); }
  createCard(portfolioId: number, card: { title: string; tags?: string; types?: string[]; sort_key?: string; sort_dir?: string; max_items?: string | number }) {
    return this.request<null>(`/portfolios/${portfolioId}/cards`, { method: "POST", body: form({ ...card, max_items: card.max_items === undefined ? undefined : String(card.max_items) }) });
  }

  ports() { return this.request<{ scanned_at: string; herdr_available: boolean; ports: unknown[]; warnings: string[]; error?: string }>("/api/ports"); }
  killPort(pid: number, signal: "TERM" | "KILL" = "TERM") { return this.request<{ ok: boolean; pid: number; signal: string }>("/api/ports/kill", { method: "POST", json: { pid, signal } }); }
  settings() { return this.request<{ pastry_enabled: boolean; watched_directories: (Omit<WatchedDirectory, "recursive"> & { recursive: boolean })[] }>("/api/settings"); }
  directories(path: string, files = false) { return this.request<{ path: string; parent: string | null; directories: { name: string; path: string }[]; files?: { name: string; path: string }[] }>("/api/settings/directories", { query: { path, files } }); }
  pastry(id: number, format: "md" | "html" = "md", visibility: "public" | "private" = "public") { return this.request<{ slug: string | null; url: string | null }>(`/api/items/${id}/pastry`, { method: "POST", json: { format, visibility } }); }
}

export const createClient = (base?: string, options?: ClientOptions) => new PortfolioClient(base, options);
