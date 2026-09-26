import type {
  Card, CardResult, Category, Completion, Detection, DueReminder, Item, ItemFilter, ItemType, ItemView, ReminderView,
  Portfolio, PortfolioItemFilter, Pr, PrEvent, PrStatus, ProjectView, Recurrence, ResolvedSlot, Settings, Slot, TaskInput, TaskView, WatchedDirectory,
} from "@portfolio/core";

export class PortfolioApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface ClientOptions { fetch?: Fetcher; headers?: Record<string, string> }

export type PortfolioCardView = Card & CardResult;
export type PortfolioView = Portfolio & { cards: PortfolioCardView[]; scope_active: boolean; scope_item_ids: number[] };
export type PortfolioSummary = Portfolio & { card_count: number };
export type CategorySummary = Category & { member_count: number };
export type ItemDetail = Item & { href: string; tags: string[]; slots: ResolvedSlot[]; project: ProjectView | null };
export type QuickAddResult = { id: number; href: string; type: ItemType; title: string };
export type CreateItemInput = { type?: ItemType; title?: string; description?: string; url?: string; path?: string; category?: string; tags?: string | string[]; content?: string; source_path?: string; toc?: boolean };
export type ItemPatch = { type?: ItemType; title?: string; description?: string; content?: string; url?: string | null; toc?: boolean; pinned?: boolean; starred?: boolean; tags?: string[] };
export type CardInput = { title?: string; kind?: string; config?: unknown; tags?: string | string[]; types?: string | string[]; sort_key?: string; sort_dir?: string; max_items?: number | string };
export type CategoryInput = { name: string; kind: ItemType; slots: Slot[] | string };
export type TaskDetail = TaskView & { history: Completion[] };

/** The default server: PORTFOLIO_SERVER or HDOCS_SERVER, else http://127.0.0.1:4387 (the old HTML server). */
export const defaultServer = (): string => (globalThis.process?.env?.PORTFOLIO_SERVER ?? globalThis.process?.env?.HDOCS_SERVER ?? "http://127.0.0.1:4387").replace(/\/$/, "");

/** The desktop app's @portfolio/api server. */
export const API_PORT = 4388;
export const desktopServer = (): string => `http://127.0.0.1:${API_PORT}`;

export class PortfolioClient {
  readonly base: string;
  private fetcher: Fetcher;
  private headers: Record<string, string>;

  constructor(base: string = defaultServer(), options: ClientOptions = {}) {
    this.base = base.replace(/\/$/, "");
    // Wrapped, not stored: browsers throw "Illegal invocation" when fetch is called as a method.
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
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

  /** A route whose response is raw text/HTML rather than JSON. */
  async requestText(path: string, init: RequestInit = {}): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(this.url(path), { ...init, redirect: "manual" });
    } catch (error) {
      throw new PortfolioApiError(0, `Portfolio is unavailable at ${this.base}: ${(error as Error).message}`);
    }
    const text = await response.text();
    if (response.status >= 400) throw new PortfolioApiError(response.status, text || response.statusText);
    return text;
  }

  health() { return this.request<{ ok: boolean; items: number }>("/health"); }

  async items(filter: ItemFilter = {}): Promise<ItemView[]> {
    const { items } = await this.request<{ items: ItemView[] }>("/api/items", { query: { q: filter.q, contents: filter.contents, pinned: filter.pinned, starred: filter.starred, type: filter.type, tag: filter.tag, tagName: filter.tagName, category: filter.category, limit: filter.limit } });
    return items;
  }

  item(id: number) { return this.request<ItemDetail>(`/api/items/${id}`); }
  itemDetail(id: number) { return this.item(id); }
  itemHtml(id: number) { return this.requestText(`/api/items/${id}/html`); }
  createItem(input: CreateItemInput) { return this.request<{ id: number; href: string }>("/api/items", { method: "POST", json: input }); }
  updateItem(id: number, patch: ItemPatch) { return this.request<{ ok: true }>(`/api/items/${id}`, { method: "PATCH", json: patch }); }
  deleteItem(id: number, deleteFiles = false) { return this.request<{ ok: true }>(`/api/items/${id}`, { method: "DELETE", query: { delete_files: deleteFiles } }); }

  detect(content: string) { return this.request<Detection>("/api/detect", { query: { content } }); }

  /** The quick-add box: paste anything, get the detected item. `type` overrides the guess. */
  quickAdd(content: string, options: { type?: ItemType; tags?: string } = {}) {
    return this.request<QuickAddResult>("/api/quick", { method: "POST", json: { content, type: options.type, tags: options.tags } });
  }

  toggle(id: number, field: "pinned" | "starred") { return this.request<{ ok: true; value: boolean }>(`/api/items/${id}/toggle`, { method: "POST", json: { field } }); }
  addTags(id: number, tags: string | string[]) { return this.request<{ tags: string[] }>(`/api/items/${id}/tags`, { method: "POST", json: { tags } }); }
  removeTag(id: number, name: string) { return this.request<{ tags: string[] }>(`/api/items/${id}/tags/${encodeURIComponent(name)}`, { method: "DELETE" }); }
  tags() { return this.request<{ tags: { id: number; name: string; count: number }[] }>("/api/tags"); }

  pathAction(id: number, action: "copy" | "reveal" | "open" | "create", slot?: string) {
    return this.request<{ ok: true; path: string }>(`/api/items/${id}/path-action`, { method: "POST", json: { action, slot } });
  }
  setSlotPath(id: number, slot: string, path: string) { return this.request<{ slots: ResolvedSlot[] }>(`/api/items/${id}/slot-path`, { method: "POST", json: { slot, path } }); }

  portfolios() { return this.request<{ portfolios: PortfolioSummary[] }>("/api/portfolios"); }
  portfolio(id: number) { return this.request<PortfolioView>(`/api/portfolios/${id}`); }
  createPortfolio(name: string, description = "", tags: string[] = [], item_filter: PortfolioItemFilter = {}) {
    return this.request<{ id: number }>("/api/portfolios", { method: "POST", json: { name, description, tags, item_filter } });
  }
  updatePortfolio(id: number, patch: { name?: string; description?: string; tags?: string[]; item_filter?: PortfolioItemFilter }) {
    return this.request<{ ok: true }>(`/api/portfolios/${id}`, { method: "PATCH", json: patch });
  }
  deletePortfolio(id: number) { return this.request<{ ok: true }>(`/api/portfolios/${id}`, { method: "DELETE" }); }

  createCard(portfolioId: number, card: CardInput) { return this.request<{ id: number }>(`/api/portfolios/${portfolioId}/cards`, { method: "POST", json: card }); }
  updateCard(id: number, card: CardInput) { return this.request<{ ok: true }>(`/api/cards/${id}`, { method: "PATCH", json: card }); }
  deleteCard(id: number) { return this.request<{ ok: true }>(`/api/cards/${id}`, { method: "DELETE" }); }
  moveCard(id: number, direction: "left" | "right") { return this.request<{ ok: boolean }>(`/api/cards/${id}/move`, { method: "POST", json: { direction } }); }

  categories() { return this.request<{ categories: CategorySummary[] }>("/api/categories"); }
  category(id: number) { return this.request<Category & { members: ItemView[] }>(`/api/categories/${id}`); }
  createCategory(input: CategoryInput) { return this.request<{ id: number }>("/api/categories", { method: "POST", json: input }); }
  updateCategory(id: number, patch: Partial<CategoryInput>) { return this.request<{ ok: true }>(`/api/categories/${id}`, { method: "PATCH", json: patch }); }
  deleteCategory(id: number) { return this.request<{ ok: true }>(`/api/categories/${id}`, { method: "DELETE" }); }

  settings() { return this.request<Settings>("/api/settings"); }
  updateSettings(patch: Partial<Pick<Settings, "home_portfolio_id" | "pastry_enabled" | "github_ignored_check_rules" | "github_ignored_repos" | "github_poll_minutes" | "github_dirs" | "github_pr_views" | "github_pr_default_view">>) { return this.request<Settings>("/api/settings", { method: "PATCH", json: patch }); }
  home() { return this.request<{ portfolio: PortfolioView | null }>("/api/home"); }
  directories(path: string, files = false) { return this.request<{ path: string; parent: string | null; directories: { name: string; path: string }[]; files?: { name: string; path: string }[] }>("/api/directories", { query: { path, files } }); }

  addWatchedDirectory(path: string, recursive = false) { return this.request<{ id: number }>("/api/watched-directories", { method: "POST", json: { path, recursive } }); }
  removeWatchedDirectory(id: number) { return this.request<{ ok: true }>(`/api/watched-directories/${id}`, { method: "DELETE" }); }
  syncWatchedDirectories() { return this.request<{ ok: true }>("/api/watched-directories/sync", { method: "POST" }); }

  ports() { return this.request<{ scanned_at: string; herdr_available: boolean; ports: (Record<string, unknown> & { project: { id: number; title: string; path: string } | null })[]; warnings: string[]; error?: string }>("/api/ports"); }
  killPort(pid: number, signal: "TERM" | "KILL" = "TERM") { return this.request<{ ok: boolean; pid: number; signal: string }>("/api/ports/kill", { method: "POST", json: { pid, signal } }); }

  projects() { return this.request<{ projects: ProjectView[] }>("/api/projects"); }
  project(id: number) { return this.request<ProjectView>(`/api/projects/${id}`); }
  scanProjects() { return this.request<{ added: string[] }>("/api/projects/scan", { method: "POST" }); }
  projectParents() { return this.request<{ parents: { id: number; path: string; count: number }[] }>("/api/project-parents"); }
  addProjectParent(path: string) { return this.request<{ ok: true }>("/api/project-parents", { method: "POST", json: { path } }); }
  removeProjectParent(id: number) { return this.request<{ ok: true }>(`/api/project-parents/${id}`, { method: "DELETE" }); }

  tasks(all = false) { return this.request<{ tasks: TaskView[] }>("/api/tasks", { query: { all } }); }
  task(id: number) { return this.request<TaskDetail>(`/api/tasks/${id}`); }
  createTask(input: TaskInput) { return this.request<{ id: number }>("/api/tasks", { method: "POST", json: input }); }
  updateTask(id: number, patch: Partial<TaskInput> & { active?: boolean }) { return this.request<{ ok: true }>(`/api/tasks/${id}`, { method: "PATCH", json: patch }); }
  deleteTask(id: number) { return this.request<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" }); }
  completeTask(id: number, on?: string) { return this.request<TaskView>(`/api/tasks/${id}/complete`, { method: "POST", json: { on } }); }
  uncompleteTask(id: number, on?: string) { return this.request<TaskView>(`/api/tasks/${id}/uncomplete`, { method: "POST", json: { on } }); }
  dueReminders(minutes = 60) { return this.request<{ due: DueReminder[] }>("/api/reminders/due", { query: { minutes } }); }
  todayReminders() { return this.request<{ reminders: ReminderView[] }>("/api/reminders/today"); }

  prs() { return this.request<{ mine: Pr[]; review_requested: Pr[]; watched: Pr[]; ignored: Pr[]; status: PrStatus }>("/api/prs"); }
  refreshPrs() { return this.request<{ mine: Pr[]; review_requested: Pr[]; watched: Pr[]; ignored: Pr[]; status: PrStatus }>("/api/prs/refresh", { method: "POST" }); }
  watchPr(url: string, watched: boolean) { return this.request<Pr>("/api/prs/watch", { method: "POST", json: { url, watched } }); }
  setPrIgnored(id: number, ignored: boolean) { return this.request<Pr>(`/api/prs/${id}`, { method: "PATCH", json: { ignored } }); }
  prEvents(since = 0) { return this.request<{ events: PrEvent[] }>("/api/prs/events", { query: { since } }); }
  markPrEventsSeen(ids: number[]) { return this.request<{ ok: true }>("/api/prs/events/seen", { method: "POST", json: { ids } }); }

  /** Imports a batch of Markdown/HTML files as tracked documents, the way mdoc does. Old server only: @portfolio/api has no /api/documents route. */
  createDocuments(documents: { sourcePath: string; content: string }[], options: { roots: string[]; title?: string; description?: string; toc?: boolean }) {
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

  /** Old server only: @portfolio/api has no pastry route. */
  pastry(id: number, format: "md" | "html" = "md", visibility: "public" | "private" = "public") {
    return this.request<{ slug: string | null; url: string | null }>(`/api/items/${id}/pastry`, { method: "POST", json: { format, visibility } });
  }
}

export const createClient = (base?: string, options?: ClientOptions) => new PortfolioClient(base, options);

export type { Recurrence, WatchedDirectory };
