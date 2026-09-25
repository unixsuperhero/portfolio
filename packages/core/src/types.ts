export type ItemType = "document" | "note" | "link" | "pr" | "file" | "dir" | "task";
export type PathType = "file" | "dir";
export type CardSortKey = "created_at" | "updated_at" | "title" | "type";
export type SortDir = "asc" | "desc";
export type CardKind = "query" | "tasks" | "reminders" | "ports" | "clock" | "note" | "services";
export type Recurrence = "daily" | "once";

export interface Item {
  id: number;
  type: ItemType;
  title: string;
  description: string;
  content: string;
  rendered_html: string;
  url: string | null;
  source_path: string | null;
  task_id: number | null;
  path: string | null;
  category_id: number | null;
  slot_paths: string;
  toc: 0 | 1;
  pinned: 0 | 1;
  starred: 0 | 1;
  created_at: string;
  updated_at: string;
}

/** The shape the JSON API and the React components use. Booleans, tag names, resolved href. */
export interface ItemView {
  id: number;
  type: ItemType;
  title: string;
  description: string;
  url: string | null;
  source_path: string | null;
  task_id: number | null;
  path: string | null;
  pinned: boolean;
  starred: boolean;
  created_at: string;
  updated_at: string;
  href: string;
  tags: string[];
}

export interface Tag {
  id: number;
  name: string;
  created_at: string;
}

export interface Portfolio {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

/** A card is a saved query: tags are OR-ed, types narrow the result. Empty means any. */
export interface CardSpec {
  title: string;
  tags: string[];
  types: ItemType[];
  sort_key: CardSortKey;
  sort_dir: SortDir;
  max_items: number;
  /** "query" runs the saved search; every other kind is a dashboard widget. */
  kind: CardKind;
  /** Per-kind JSON config; see CARD_KINDS in constants.ts. */
  config: Record<string, unknown>;
}

export interface Card extends CardSpec {
  id: number;
  portfolio_id: number;
  position: number;
}

export interface CardResult {
  total: number;
  items: ItemView[];
}

export interface Slot {
  name: string;
  kind: PathType;
  path: string;
}

export interface ResolvedSlot extends Slot {
  path: string;
  overridden: boolean;
  exists: boolean;
}

export interface Category {
  id: number;
  name: string;
  kind: ItemType;
  slots: Slot[];
}

export interface WatchedDirectory {
  id: number;
  path: string;
  recursive: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ProjectParent {
  id: number;
  path: string;
}

export type DetectionShape = "url" | "path" | "text";

export interface Detection {
  shape: DetectionShape;
  type: ItemType;
  title: string;
  url?: string;
  path?: string;
  exists?: boolean;
  content?: string;
}

export interface ItemFilter {
  q?: string;
  contents?: boolean;
  pinned?: boolean;
  starred?: boolean;
  type?: ItemType | "";
  tag?: number;
  tagName?: string;
  category?: number;
  limit?: number;
}

export interface Task {
  id: number;
  title: string;
  notes: string;
  recurrence: Recurrence;
  item_id: number | null;
  parent_id: number | null;
  active: 0 | 1;
  created_at: string;
}

export interface Reminder {
  id: number;
  title: string;
  notes: string;
  recurrence: Recurrence;
  /** Optional linked task. Standalone reminders have null. */
  task_id: number | null;
  /** Daily: "HH:MM" local. Once: "YYYY-MM-DDTHH:MM" local. */
  at: string;
  /** JSON array of weekdays (0 = Sunday … 6 = Saturday); "[]" fires every day. Daily reminders only. */
  days: string;
  active: 0 | 1;
  created_at: string;
}

export interface Completion {
  id: number;
  task_id: number;
  on: string;
  at: string;
}

/** A reminder's weekdays; 0 = Sunday … 6 = Saturday. Omitted or [] fires every day. Once-tasks cannot set days. */
export type ReminderInput = string | { at: string; days?: number[] };

export interface ReminderCreateInput {
  title: string;
  notes?: string;
  recurrence?: Recurrence;
  at: string;
  days?: number[];
  task_id?: number | null;
  active?: boolean;
}

export interface TaskInput {
  title: string;
  notes?: string;
  recurrence?: Recurrence;
  item_id?: number | null;
  parent_id?: number | null;
  reminders?: ReminderInput[];
}

/** The shape the JSON API and the React components use: booleans, computed streak and completion. */
export interface TaskView {
  id: number;
  title: string;
  notes: string;
  recurrence: Recurrence;
  item_id: number | null;
  parent_id: number | null;
  active: boolean;
  created_at: string;
  reminders: { id: number; at: string; days: number[] }[];
  completed_today: boolean;
  last_completed: string | null;
  /** Daily only: consecutive days ending today or yesterday. */
  streak: number;
}

export interface ReminderView {
  id: number;
  title: string;
  notes: string;
  recurrence: Recurrence;
  at: string;
  days: number[];
  task_id: number | null;
  active: boolean;
  created_at: string;
  completed_today: boolean;
  last_completed: string | null;
  streak: number;
}

export interface DueReminder {
  reminder: ReminderView;
  due_at: string;
}

export interface ProjectServices {
  runner: "bun" | "pnpm" | "yarn" | "npm" | null;
  scripts: Record<string, string>;
  make_targets: string[];
}

export interface ProjectView {
  id: number;
  title: string;
  path: string;
  description: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  services: ProjectServices;
  ports: unknown[];
  slots: ResolvedSlot[];
}

export interface GithubIgnoredCheckRule {
  repo: string;
  check: string;
}

export interface GithubPrView {
  id: string;
  label: string;
  query: string;
}

export interface Settings {
  home_portfolio_id: number | null;
  pastry_enabled: boolean;
  watched_directories: { id: number; path: string; recursive: boolean }[];
  project_parents: { id: number; path: string; count: number }[];
  github_ignored_check_rules: GithubIgnoredCheckRule[];
  /** owner/repo globs (e.g. "acme/*") whose PRs are hidden from every list and raise no events. */
  github_ignored_repos: string[];
  github_poll_minutes: number;
  /** Directories gh runs from when polling, in order. Empty means the API's own cwd. */
  github_dirs: string[];
  github_pr_views: GithubPrView[];
  github_pr_default_view: string;
}

export type PrState = "open" | "closed" | "merged";
export type ReviewDecision = "approved" | "changes_requested" | "review_required";
export type CheckStatus = "success" | "failure" | "pending" | "skipped" | "cancelled" | "neutral";
export type ChecksSummary = "success" | "failure" | "pending" | "none";
export type PrEventKind = "state" | "comments" | "checks" | "review";
export type PrList = "mine" | "review_requested" | "watched";

export interface PrCheck {
  name: string;
  status: CheckStatus;
  url: string;
  ignored: boolean;
}

/** One row in github_prs, as the JSON API and clients see it. */
export interface Pr {
  id: number;
  url: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  is_draft: boolean;
  state: PrState;
  review_decision: ReviewDecision | null;
  updated_at: string;
  /** Issue comments + review comments + reviews. */
  comments: number;
  checks: PrCheck[];
  /** Over non-ignored checks only. */
  checks_summary: ChecksSummary;
  watched: boolean;
  /** Repository-scoped ignored check names applied during the latest refresh. */
  ignored_checks: string[];
  /** Hidden from every list and raises no events. Set by PATCH /api/prs/:id { ignored }; never touched by polling. */
  ignored: boolean;
  /** Which search lists this PR currently appears in ([] for watched-only). */
  lists: string[];
  /** The library `pr` item, created when watched. */
  item_id: number | null;
  /** The github_dirs entry gh ran from when this PR was fetched; null for the API's own cwd. */
  source_dir: string | null;
  fetched_at: string;
}

export interface PrEvent {
  id: number;
  pr_id: number;
  kind: PrEventKind;
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
