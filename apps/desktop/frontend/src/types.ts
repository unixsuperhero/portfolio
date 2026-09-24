// Response shapes for the desktop frontend's API calls, copied from apps/desktop/CONTRACT.md.
// Most are already defined in @portfolio/core (TaskView, TaskInput, ProjectView,
// Settings, ResolvedSlot, Card/CardSpec with kind + config) and are re-exported here so callers
// only need to import from "./types.ts".
import type { Card, ItemType, ItemView, Portfolio, ProjectView, Recurrence, ResolvedSlot, Settings } from "@portfolio/core";
import type { PortEntry } from "@portfolio/ports";

export type {
  Card,
  CardKind,
  CardSpec,
  Completion,
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

export type ReminderCreateInput = { title: string; notes?: string; recurrence?: Recurrence; at: string; days?: number[]; task_id?: number | null; active?: boolean };
export type ReminderView = { id: number; title: string; notes: string; recurrence: Recurrence; at: string; days: number[]; task_id: number | null; active: boolean; created_at: string; completed_today: boolean; last_completed: string | null; streak: number };
export type DueReminder = { reminder: ReminderView; due_at: string };

/** GET /api/items/:id */
export interface ItemDetail extends ItemView {
  task_id: number | null;
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

// -- Pull requests (added 2026-09-22) ----------------------------------------

export type PrCheckStatus = "success" | "failure" | "pending" | "skipped" | "cancelled" | "neutral";
export type PrChecksSummary = "success" | "failure" | "pending" | "none";
export type PrReviewDecision = "approved" | "changes_requested" | "review_required" | null;
export type PrList = "mine" | "review_requested" | "watched";

export interface PrCheck {
  name: string;
  status: PrCheckStatus;
  url: string;
  ignored: boolean;
}

export interface Pr {
  id: number;
  url: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  is_draft: boolean;
  state: "open" | "closed" | "merged";
  review_decision: PrReviewDecision;
  updated_at: string;
  comments: number;
  checks: PrCheck[];
  checks_summary: PrChecksSummary;
  watched: boolean;
  ignored_checks: string[];
  /** Hidden from every list by the user; a PR can also be hidden because its repo is in github_ignored_repos. */
  ignored: boolean;
  lists: PrList[];
  item_id: number | null;
  /** The settings.github_dirs entry gh ran from; null for the API's own cwd. */
  source_dir: string | null;
  fetched_at: string;
}

export interface PrEvent {
  id: number;
  pr_id: number;
  kind: "state" | "comments" | "checks" | "review";
  message: string;
  at: string;
  seen: boolean;
}

export interface PrStatus {
  last_poll_at: string | null;
  next_poll_at: string | null;
  rate: { remaining: number; reset_at: string } | null;
  polling: boolean;
  error: string | null;
  gh_ok: boolean;
  login: string | null;
}

export interface PrsResponse {
  mine: Pr[];
  review_requested: Pr[];
  watched: Pr[];
  /** Hidden PRs: pr.ignored, or (when pr.ignored is false) the repo is in github_ignored_repos. */
  ignored: Pr[];
  status: PrStatus;
}

/** Settings gains github_ignored_checks / github_poll_minutes; kept optional here since
 * @portfolio/core's Settings type may not have caught up yet. */
export type SettingsView = Settings & { github_ignored_checks?: string[]; github_ignored_repos?: string[]; github_poll_minutes?: number; github_dirs?: string[] };
