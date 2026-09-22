import { PortfolioClient } from "@portfolio/client";
import type { CardSpec, ItemFilter, Slot, TaskInput } from "@portfolio/core";
import type {
  CategorySummary,
  Detection,
  DueReminder,
  ItemDetail,
  PortfolioSummary,
  PortfolioView,
  PortsSnapshot,
  ProjectParentSummary,
  ProjectView,
  Settings,
  TaskView,
} from "./types.ts";

export const api = new PortfolioClient(import.meta.env.VITE_PORTFOLIO_API ?? "http://127.0.0.1:4388");

// Typed helpers for every contract route this app calls. Each one goes through
// `api.request<T>()` directly instead of relying on @portfolio/client methods that may not
// exist yet, since the client and this frontend are built concurrently.

// -- Items --------------------------------------------------------------

export const listItems = (filter: ItemFilter & { starred?: boolean; category?: number } = {}) =>
  api.request<{ items: import("@portfolio/core").ItemView[] }>("/api/items", { query: filter as Record<string, string | number | boolean | undefined> });

export const getItem = (id: number) => api.request<ItemDetail>(`/api/items/${id}`);

export const patchItem = (id: number, patch: Record<string, unknown>) =>
  api.request<{ ok: true }>(`/api/items/${id}`, { method: "PATCH", json: patch });

export const deleteItem = (id: number, deleteFiles = false) =>
  api.request<{ ok: true }>(`/api/items/${id}`, { method: "DELETE", query: { delete_files: deleteFiles } });

export const itemHtmlUrl = (id: number) => api.url(`/api/items/${id}/html`);

export const toggleItem = (id: number, field: "pinned" | "starred") =>
  api.request<{ ok: true; value: boolean }>(`/api/items/${id}/toggle`, { method: "POST", json: { field } });

export const addItemTags = (id: number, tags: string[]) =>
  api.request<{ tags: string[] }>(`/api/items/${id}/tags`, { method: "POST", json: { tags } });

export const removeItemTag = (id: number, name: string) =>
  api.request<{ tags: string[] }>(`/api/items/${id}/tags/${encodeURIComponent(name)}`, { method: "DELETE" });

export const pathAction = (id: number, action: "copy" | "reveal" | "open" | "create", slot?: string) =>
  api.request<{ ok: true; path: string }>(`/api/items/${id}/path-action`, { method: "POST", json: { action, slot } });

export const setSlotPath = (id: number, slot: string, path: string) =>
  api.request<{ slots: import("@portfolio/core").ResolvedSlot[] }>(`/api/items/${id}/slot-path`, { method: "POST", json: { slot, path } });

export const detect = (content: string) => api.request<Detection>("/api/detect", { query: { content } });

export const quickAdd = (content: string, options: { type?: string; tags?: string[] } = {}) =>
  api.request<{ id: number; href: string; type: string; title: string }>("/api/quick", { method: "POST", json: { content, ...options } });

export const listTags = () => api.request<{ tags: { id: number; name: string; count: number }[] }>("/api/tags");

// -- Portfolios and cards -------------------------------------------------

export const listPortfolios = () => api.request<{ portfolios: PortfolioSummary[] }>("/api/portfolios");

export const createPortfolio = (name: string, description = "") =>
  api.request<{ id: number }>("/api/portfolios", { method: "POST", json: { name, description } });

export const getPortfolio = (id: number) => api.request<PortfolioView>(`/api/portfolios/${id}`);

export const patchPortfolio = (id: number, patch: { name?: string; description?: string }) =>
  api.request<{ ok: true }>(`/api/portfolios/${id}`, { method: "PATCH", json: patch });

export const deletePortfolio = (id: number) => api.request<{ ok: true }>(`/api/portfolios/${id}`, { method: "DELETE" });

export type CardInput = Partial<CardSpec> & { title: string };

export const createCard = (portfolioId: number, card: CardInput) =>
  api.request<{ id: number }>(`/api/portfolios/${portfolioId}/cards`, { method: "POST", json: card });

export const updateCard = (id: number, card: CardInput) =>
  api.request<{ ok: true }>(`/api/cards/${id}`, { method: "PATCH", json: card });

export const deleteCard = (id: number) => api.request<{ ok: true }>(`/api/cards/${id}`, { method: "DELETE" });

export const moveCard = (id: number, direction: "left" | "right") =>
  api.request<{ ok: true }>(`/api/cards/${id}/move`, { method: "POST", json: { direction } });

// -- Categories -------------------------------------------------------------

export const listCategories = () => api.request<{ categories: CategorySummary[] }>("/api/categories");

export const createCategory = (name: string, kind: string, slots: Slot[] | string) =>
  api.request<{ id: number }>("/api/categories", { method: "POST", json: { name, kind, slots } });

export const getCategory = (id: number) =>
  api.request<import("@portfolio/core").Category & { members: import("@portfolio/core").ItemView[] }>(`/api/categories/${id}`);

export const patchCategory = (id: number, patch: Record<string, unknown>) =>
  api.request<{ ok: true }>(`/api/categories/${id}`, { method: "PATCH", json: patch });

export const deleteCategory = (id: number) => api.request<{ ok: true }>(`/api/categories/${id}`, { method: "DELETE" });

// -- Settings and directories ------------------------------------------------

export const getSettings = () => api.request<Settings>("/api/settings");

export const patchSettings = (patch: { home_portfolio_id?: number | null; pastry_enabled?: boolean }) =>
  api.request<Settings>("/api/settings", { method: "PATCH", json: patch });

export const getHome = () => api.request<{ portfolio: PortfolioView | null }>("/api/home");

// NOTE: the contract doesn't define explicit CRUD routes for watched directories (only
// GET /api/directories for browsing, and Settings carries the list). These follow the same
// shape as /api/project-parents until the backend documents the real route.
export const addWatchedDirectory = (path: string, recursive = true) =>
  api.request<{ ok: true }>("/api/watched-directories", { method: "POST", json: { path, recursive } });

export const removeWatchedDirectory = (id: number) =>
  api.request<{ ok: true }>(`/api/watched-directories/${id}`, { method: "DELETE" });

export const listDirectories = (path?: string, files = false) =>
  api.request<{ path: string; parent: string | null; directories: { name: string; path: string }[]; files?: { name: string; path: string }[] }>(
    "/api/directories",
    { query: { path, files } },
  );

// -- Ports --------------------------------------------------------------

export const getPorts = () => api.request<PortsSnapshot>("/api/ports");

export const killPort = (pid: number, signal: "TERM" | "KILL" = "TERM") =>
  api.request<{ ok: true; pid: number; signal: string }>("/api/ports/kill", { method: "POST", json: { pid, signal } });

// -- Projects -------------------------------------------------------------

export const listProjects = () => api.request<{ projects: ProjectView[] }>("/api/projects");

export const getProject = (id: number) => api.request<ProjectView>(`/api/projects/${id}`);

export const scanProjects = () => api.request<{ added: string[] }>("/api/projects/scan", { method: "POST" });

export const listProjectParents = () => api.request<{ parents: ProjectParentSummary[] }>("/api/project-parents");

export const addProjectParent = (path: string) =>
  api.request<{ ok: true }>("/api/project-parents", { method: "POST", json: { path } });

export const removeProjectParent = (id: number) =>
  api.request<{ ok: true }>(`/api/project-parents/${id}`, { method: "DELETE" });

// -- Tasks and reminders -------------------------------------------------

export const listTasks = (all = false) => api.request<{ tasks: TaskView[] }>("/api/tasks", { query: { all } });

export const createTask = (task: TaskInput) => api.request<{ id: number }>("/api/tasks", { method: "POST", json: task });

export const getTask = (id: number) =>
  api.request<TaskView & { history: import("@portfolio/core").Completion[] }>(`/api/tasks/${id}`);

export const patchTask = (id: number, patch: Partial<TaskInput> & { active?: boolean }) =>
  api.request<{ ok: true }>(`/api/tasks/${id}`, { method: "PATCH", json: patch });

export const deleteTask = (id: number) => api.request<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" });

export const completeTask = (id: number, on?: string) =>
  api.request<TaskView>(`/api/tasks/${id}/complete`, { method: "POST", json: { on } });

export const uncompleteTask = (id: number, on?: string) =>
  api.request<TaskView>(`/api/tasks/${id}/uncomplete`, { method: "POST", json: { on } });

export const getDueReminders = (minutes = 60) =>
  api.request<{ due: DueReminder[] }>("/api/reminders/due", { query: { minutes } });

export const getTodayReminders = () => api.request<{ tasks: TaskView[] }>("/api/reminders/today");

export const health = () => api.request<{ ok: boolean; items: number }>("/health");
