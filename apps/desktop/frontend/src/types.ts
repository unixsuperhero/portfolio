// Response shapes for the desktop frontend's API calls, copied from apps/desktop/CONTRACT.md.
// Most are already defined in @portfolio/core (TaskView, TaskInput, DueReminder, ProjectView,
// Settings, ResolvedSlot, Card/CardSpec with kind + config) and are re-exported here so callers
// only need to import from "./types.ts".
import type { Card, ItemType, ItemView, Portfolio, ProjectView, ResolvedSlot } from "@portfolio/core";
import type { PortEntry } from "@portfolio/ports";

export type {
  Card,
  CardKind,
  CardSpec,
  Completion,
  DueReminder,
  Item,
  ItemFilter,
  ItemType,
  ItemView,
  Portfolio,
  ProjectServices,
  ProjectView,
  Recurrence,
  Reminder,
  ResolvedSlot,
  Settings,
  Slot,
  Task,
  TaskInput,
  TaskView,
} from "@portfolio/core";

/** GET /api/items/:id */
export interface ItemDetail extends ItemView {
  slots: ResolvedSlot[];
  project: ProjectView | null;
}

/** One card plus the items it matched (query cards only; other kinds have items: []). */
export type PortfolioCardResult = Card & { items: ItemView[]; total: number };

/** GET /api/portfolios/:id and GET /api/home */
export type PortfolioView = Portfolio & { cards: PortfolioCardResult[] };

export interface PortfolioSummary extends Portfolio {}

/** GET /api/ports: each listener plus the project it belongs to, if any. */
export interface PortEntryWithProject extends PortEntry {
  project: { id: number; title: string; path: string } | null;
}

export interface PortsSnapshot {
  scanned_at: string;
  herdr_available: boolean;
  ports: PortEntryWithProject[];
  warnings: string[];
  error?: string;
}

export interface CategorySummary {
  id: number;
  name: string;
  kind: ItemType;
  member_count: number;
}

export interface ProjectParentSummary {
  id: number;
  path: string;
  count: number;
}

export interface Detection {
  shape: "url" | "path" | "text";
  type: ItemType;
  title: string;
  url?: string;
  path?: string;
  exists?: boolean;
  content?: string;
}
