import type { Store } from "@portfolio/db";
import { createContext } from "./context.ts";
import type { ApiOptions } from "./context.ts";
import { compile, error, json } from "./http.ts";
import type { Route } from "./http.ts";
import {
  createCategoryRoute, deleteCategoryRoute, getCategoryRoute, listCategoriesRoute, patchCategoryRoute,
} from "./categories.ts";
import {
  addTagsRoute, createItemRoute, deleteItemRoute, detectRoute, getItemRoute, itemHtmlRoute, listItemsRoute,
  pathActionRoute, patchItemRoute, quickAddRoute, removeTagRoute, slotPathRoute, tagsListRoute, toggleItemRoute,
} from "./items.ts";
import {
  createCardRoute, createPortfolioRoute, deleteCardRoute, deletePortfolioRoute, getPortfolioRoute,
  listPortfoliosRoute, moveCardRoute, patchPortfolioRoute, updateCardRoute,
} from "./portfolios.ts";
import { getPortsRoute, killPortRoute } from "./ports.ts";
import { listPrEventsRoute, listPrsRoute, markPrEventsSeenRoute, patchPrRoute, refreshPrsRoute, watchPrRoute } from "./prs.ts";
import {
  addProjectParentRoute, getProjectRoute, listProjectParentsRoute, listProjectsRoute, removeProjectParentRoute,
  scanProjectsRoute,
} from "./projects.ts";
import { directoriesRoute, getHomeRoute, getSettingsRoute, patchSettingsRoute } from "./settings.ts";
import {
  completeTaskRoute, createTaskRoute, deleteTaskRoute, dueRemindersRoute, getTaskRoute, listTasksRoute,
  patchTaskRoute, todayTasksRoute, uncompleteTaskRoute,
} from "./tasks.ts";
import { addWatchedDirectoryRoute, removeWatchedDirectoryRoute, syncWatchedDirectoriesRoute } from "./watched.ts";

export type { ApiOptions } from "./context.ts";

async function healthRoute(store: Store): Promise<Response> {
  return json({ ok: true, items: store.items.countItems() });
}

const ROUTES: [string, string, (ctx: ReturnType<typeof createContext>, request: Request, params: Record<string, string>) => Promise<Response>][] = [
  ["GET", "/api/items", listItemsRoute],
  ["POST", "/api/items", createItemRoute],
  ["GET", "/api/items/:id", getItemRoute],
  ["PATCH", "/api/items/:id", patchItemRoute],
  ["DELETE", "/api/items/:id", deleteItemRoute],
  ["GET", "/api/items/:id/html", itemHtmlRoute],
  ["POST", "/api/items/:id/toggle", toggleItemRoute],
  ["POST", "/api/items/:id/tags", addTagsRoute],
  ["DELETE", "/api/items/:id/tags/:name", removeTagRoute],
  ["POST", "/api/items/:id/path-action", pathActionRoute],
  ["POST", "/api/items/:id/slot-path", slotPathRoute],

  ["GET", "/api/detect", detectRoute],
  ["POST", "/api/quick", quickAddRoute],
  ["GET", "/api/tags", tagsListRoute],

  ["GET", "/api/portfolios", listPortfoliosRoute],
  ["POST", "/api/portfolios", createPortfolioRoute],
  ["GET", "/api/portfolios/:id", getPortfolioRoute],
  ["PATCH", "/api/portfolios/:id", patchPortfolioRoute],
  ["DELETE", "/api/portfolios/:id", deletePortfolioRoute],
  ["POST", "/api/portfolios/:id/cards", createCardRoute],
  ["PATCH", "/api/cards/:id", updateCardRoute],
  ["DELETE", "/api/cards/:id", deleteCardRoute],
  ["POST", "/api/cards/:id/move", moveCardRoute],

  ["GET", "/api/categories", listCategoriesRoute],
  ["POST", "/api/categories", createCategoryRoute],
  ["GET", "/api/categories/:id", getCategoryRoute],
  ["PATCH", "/api/categories/:id", patchCategoryRoute],
  ["DELETE", "/api/categories/:id", deleteCategoryRoute],

  ["GET", "/api/settings", getSettingsRoute],
  ["PATCH", "/api/settings", patchSettingsRoute],
  ["GET", "/api/home", getHomeRoute],
  ["GET", "/api/directories", directoriesRoute],
  ["POST", "/api/watched-directories", addWatchedDirectoryRoute],
  ["DELETE", "/api/watched-directories/:id", removeWatchedDirectoryRoute],
  ["POST", "/api/watched-directories/sync", syncWatchedDirectoriesRoute],

  ["GET", "/api/ports", getPortsRoute],
  ["POST", "/api/ports/kill", killPortRoute],

  ["GET", "/api/prs", listPrsRoute],
  ["POST", "/api/prs/refresh", refreshPrsRoute],
  ["POST", "/api/prs/watch", watchPrRoute],
  ["PATCH", "/api/prs/:id", patchPrRoute],
  ["GET", "/api/prs/events", listPrEventsRoute],
  ["POST", "/api/prs/events/seen", markPrEventsSeenRoute],

  ["GET", "/api/projects", listProjectsRoute],
  ["GET", "/api/projects/:id", getProjectRoute],
  ["POST", "/api/projects/scan", scanProjectsRoute],
  ["GET", "/api/project-parents", listProjectParentsRoute],
  ["POST", "/api/project-parents", addProjectParentRoute],
  ["DELETE", "/api/project-parents/:id", removeProjectParentRoute],

  ["GET", "/api/tasks", listTasksRoute],
  ["POST", "/api/tasks", createTaskRoute],
  ["GET", "/api/tasks/:id", getTaskRoute],
  ["PATCH", "/api/tasks/:id", patchTaskRoute],
  ["DELETE", "/api/tasks/:id", deleteTaskRoute],
  ["POST", "/api/tasks/:id/complete", completeTaskRoute],
  ["POST", "/api/tasks/:id/uncomplete", uncompleteTaskRoute],
  ["GET", "/api/reminders/due", dueRemindersRoute],
  ["GET", "/api/reminders/today", todayTasksRoute],
];

/** Builds the JSON HTTP handler for the desktop app's backend. Every route in apps/desktop/CONTRACT.md. */
export function createApi(store: Store, options: ApiOptions = {}): (request: Request) => Promise<Response> {
  const ctx = createContext(store, options);
  const routes: Route[] = ROUTES.map(([method, path, handler]) => ({ method, pattern: compile(path), handler: (request, params) => handler(ctx, request, params) }));

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return healthRoute(store);
    for (const route of routes) {
      if (route.method !== request.method) continue;
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      try {
        return await route.handler(request, match.groups ?? {});
      } catch (err) {
        ctx.log(`error: ${(err as Error).message}`);
        return error(500, (err as Error).message);
      }
    }
    return error(404, "not found");
  };
}
