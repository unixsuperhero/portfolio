import type { Pr } from "../types.ts";

export const lifecycle = (pr: Pick<Pr, "state" | "is_draft">) => pr.state === "open" && pr.is_draft ? "draft" : pr.state;
export const REVIEW_LABELS = { approved: "Approved", changes_requested: "Changes requested", review_required: "Review required", none: "No review decision" };
export const CHECK_LABELS = { success: "Passed", failure: "Failed", pending: "Pending", skipped: "Skipped", cancelled: "Cancelled", neutral: "Neutral", none: "No pass/fail result" };
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const yesNo = options({ true: "Yes", false: "No" });
type Scalar = string | number | boolean;
export interface PrFilter {
  key: string;
  label: string;
  group: "Primary" | "People and location" | "Tracking" | "Identifiers and text" | "Activity";
  input: "select" | "text" | "number" | "datetime-local";
  options?: { value: string; label: string }[];
  read: (pr: Pr) => Scalar;
  operator?: "min" | "max" | "after" | "before";
}
export const PR_FILTERS: PrFilter[] = [
  { key: "state", label: "Lifecycle", group: "Primary", input: "select", options: options({ draft: "Draft", open: "Open", merged: "Merged", closed: "Closed" }), read: lifecycle },
  { key: "draft", label: "Draft flag", group: "Primary", input: "select", options: yesNo, read: pr => pr.is_draft },
  { key: "review", label: "Review", group: "Primary", input: "select", options: options(REVIEW_LABELS), read: pr => pr.review_decision ?? "none" },
  { key: "checks", label: "Checks summary", group: "Primary", input: "select", options: options({ success: "Passed", failure: "Failed", pending: "Pending", none: "No pass/fail result" }), read: pr => pr.checks_summary },
  { key: "author", label: "Author", group: "People and location", input: "select", read: pr => pr.author },
  { key: "owner", label: "Owner", group: "People and location", input: "select", read: pr => pr.owner },
  { key: "repo", label: "Repository", group: "People and location", input: "select", read: pr => `${pr.owner}/${pr.repo}` },
  { key: "dir", label: "Source directory", group: "People and location", input: "select", read: pr => pr.source_dir ?? "-" },
  { key: "raw_state", label: "GitHub state", group: "Tracking", input: "select", options: options({ open: "Open (including drafts)", merged: "Merged", closed: "Closed" }), read: pr => pr.state },
  { key: "watched", label: "Watched", group: "Tracking", input: "select", options: yesNo, read: pr => pr.watched },
  { key: "ignored", label: "PR ignored flag", group: "Tracking", input: "select", options: yesNo, read: pr => pr.ignored },
  { key: "linked", label: "Linked library item", group: "Tracking", input: "select", options: yesNo, read: pr => pr.item_id !== null },
  { key: "item_id", label: "Library item ID", group: "Tracking", input: "number", read: pr => pr.item_id ?? "none" },
  { key: "ignored_pattern", label: "Ignored-check pattern contains", group: "Tracking", input: "text", read: pr => pr.ignored_checks.join(" ") },
  { key: "check_count_min", label: "Minimum checks", group: "Tracking", input: "number", operator: "min", read: pr => pr.checks.length },
  { key: "check_count_max", label: "Maximum checks", group: "Tracking", input: "number", operator: "max", read: pr => pr.checks.length },
  { key: "ignored_check_count_min", label: "Minimum ignored checks", group: "Tracking", input: "number", operator: "min", read: pr => pr.checks.filter(check => check.ignored).length },
  { key: "ignored_check_count_max", label: "Maximum ignored checks", group: "Tracking", input: "number", operator: "max", read: pr => pr.checks.filter(check => check.ignored).length },
  { key: "id", label: "PR record ID", group: "Identifiers and text", input: "number", read: pr => pr.id },
  { key: "number", label: "PR number", group: "Identifiers and text", input: "number", read: pr => pr.number },
  { key: "title", label: "Title contains", group: "Identifiers and text", input: "text", read: pr => pr.title },
  { key: "url", label: "URL contains", group: "Identifiers and text", input: "text", read: pr => pr.url },
  { key: "comments_min", label: "Minimum comments", group: "Activity", input: "number", operator: "min", read: pr => pr.comments },
  { key: "comments_max", label: "Maximum comments", group: "Activity", input: "number", operator: "max", read: pr => pr.comments },
  { key: "updated_after", label: "Updated on or after", group: "Activity", input: "datetime-local", operator: "after", read: pr => pr.updated_at },
  { key: "updated_before", label: "Updated on or before", group: "Activity", input: "datetime-local", operator: "before", read: pr => pr.updated_at },
  { key: "fetched_after", label: "Fetched on or after", group: "Activity", input: "datetime-local", operator: "after", read: pr => pr.fetched_at },
  { key: "fetched_before", label: "Fetched on or before", group: "Activity", input: "datetime-local", operator: "before", read: pr => pr.fetched_at },
];
export const CHECK_FILTERS = [
  { key: "check_name", label: "Check name contains", input: "text" },
  { key: "check_url", label: "Check URL contains", input: "text" },
  { key: "check_status", label: "Individual check status", input: "select", options: options({ success: "Passed", failure: "Failed", pending: "Pending", skipped: "Skipped", cancelled: "Cancelled", neutral: "Neutral" }) },
  { key: "check_ignored", label: "Individual check ignored", input: "select", options: yesNo },
] as const;
export const PR_SORTS: { value: string; label: string; read: (pr: Pr) => Scalar }[] = [
  { value: "updated", label: "Updated", read: pr => Date.parse(pr.updated_at) },
  { value: "fetched", label: "Fetched", read: pr => Date.parse(pr.fetched_at) },
  { value: "state", label: "Lifecycle", read: lifecycle },
  { value: "raw_state", label: "GitHub state", read: pr => pr.state },
  { value: "draft", label: "Draft flag", read: pr => pr.is_draft },
  { value: "title", label: "Title", read: pr => pr.title },
  { value: "repo", label: "Repository", read: pr => `${pr.owner}/${pr.repo}` },
  { value: "owner", label: "Owner", read: pr => pr.owner },
  { value: "author", label: "Author", read: pr => pr.author },
  { value: "number", label: "PR number", read: pr => pr.number },
  { value: "id", label: "Record ID", read: pr => pr.id },
  { value: "url", label: "URL", read: pr => pr.url },
  { value: "dir", label: "Source directory", read: pr => pr.source_dir ?? "" },
  { value: "review", label: "Review", read: pr => pr.review_decision ?? "" },
  { value: "checks", label: "Checks summary", read: pr => pr.checks_summary },
  { value: "check_count", label: "Check count", read: pr => pr.checks.length },
  { value: "check_names", label: "Check names", read: pr => pr.checks.map(check => check.name).sort().join(" ") },
  { value: "check_statuses", label: "Check statuses", read: pr => pr.checks.map(check => check.status).sort().join(" ") },
  { value: "check_urls", label: "Check URLs", read: pr => pr.checks.map(check => check.url).sort().join(" ") },
  { value: "ignored_check_count", label: "Ignored check count", read: pr => pr.checks.filter(check => check.ignored).length },
  { value: "ignored_patterns", label: "Ignored-check patterns", read: pr => pr.ignored_checks.join(" ") },
  { value: "comments", label: "Comments", read: pr => pr.comments },
  { value: "watched", label: "Watched", read: pr => pr.watched },
  { value: "ignored", label: "PR ignored flag", read: pr => pr.ignored },
  { value: "lists", label: "List memberships", read: pr => pr.lists.join(" ") },
  { value: "item_id", label: "Library item ID", read: pr => pr.item_id ?? -1 },
];
export const PR_FILTER_KEYS = ["q", "collection", "membership", ...PR_FILTERS.map(filter => filter.key), ...CHECK_FILTERS.map(filter => filter.key)];

export const PR_VIEW_KEYS = [...PR_FILTER_KEYS, "sort", "direction"] as const;
export const BUILTIN_PR_VIEWS = [
  { id: "all", label: "All PRs", query: "" },
  { id: "my_reviews", label: "My Reviews", query: "collection=review_requested&state=open&sort=updated&direction=desc" },
  { id: "watching", label: "Watching", query: "collection=watched" },
  { id: "draft", label: "Draft", query: "state=draft" },
  { id: "open", label: "Open", query: "state=open" },
  { id: "merged", label: "Merged", query: "state=merged" },
  { id: "closed", label: "Closed", query: "state=closed" },
] as const;

export function normalizePrViewQuery(input: URLSearchParams | string): string {
  const source = typeof input === "string" ? new URLSearchParams(input) : input;
  const allowed = new Set<string>(PR_VIEW_KEYS);
  const entries = [...source.entries()]
    .filter(([key, value]) => allowed.has(key) && value && !(key === "collection" && value === "visible"))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return new URLSearchParams(entries).toString();
}

export function matchesPr(pr: Pr, params: URLSearchParams, hidden: boolean): boolean {
  const collection = params.get("collection") ?? "visible";
  if (collection === "ignored" ? !hidden : collection !== "all" && hidden) return false;
  if (collection === "mine" && !pr.lists.includes("mine")) return false;
  if (collection === "review_requested" && !pr.lists.includes("review_requested")) return false;
  if (collection === "watched" && !pr.watched) return false;
  const membership = params.get("membership");
  if (membership === "none" ? pr.lists.length > 0 : membership && !pr.lists.some(list => list === membership)) return false;
  for (const filter of PR_FILTERS) {
    const value = params.get(filter.key);
    if (!value) continue;
    const actual = filter.read(pr);
    if (filter.operator === "min") { if (!(Number(actual) >= Number(value))) return false; }
    else if (filter.operator === "max") { if (!(Number(actual) <= Number(value))) return false; }
    else if (filter.operator === "after") { if (!(Date.parse(String(actual)) >= Date.parse(value))) return false; }
    else if (filter.operator === "before") { if (!(Date.parse(String(actual)) <= Date.parse(value))) return false; }
    else if (filter.input === "text") { if (!String(actual).toLowerCase().includes(value.trim().toLowerCase())) return false; }
    else if (String(actual) !== value) return false;
  }
  const checkName = params.get("check_name")?.trim().toLowerCase() ?? "";
  const checkUrl = params.get("check_url")?.trim().toLowerCase() ?? "";
  const checkStatus = params.get("check_status");
  const checkIgnored = params.get("check_ignored");
  if ((checkName || checkUrl || checkStatus || checkIgnored) && !pr.checks.some(check =>
    (!checkName || check.name.toLowerCase().includes(checkName))
    && (!checkUrl || check.url.toLowerCase().includes(checkUrl))
    && (!checkStatus || check.status === checkStatus)
    && (!checkIgnored || String(check.ignored) === checkIgnored))) return false;
  const query = params.get("q")?.trim().toLowerCase();
  if (!query) return true;
  const text = [pr.id, pr.number, pr.url, pr.title, pr.owner, pr.repo, `${pr.owner}/${pr.repo}`, pr.author, pr.state, lifecycle(pr), pr.is_draft ? "draft" : "ready",
    REVIEW_LABELS[pr.review_decision ?? "none"], CHECK_LABELS[pr.checks_summary], pr.comments, pr.watched ? "watched" : "unwatched", pr.ignored ? "ignored" : "visible",
    hidden ? "ignored" : "visible", pr.source_dir ?? "API directory", pr.updated_at, pr.fetched_at, pr.item_id ?? "unlinked", ...pr.lists, ...pr.ignored_checks,
    ...pr.checks.flatMap(check => [check.name, check.status, CHECK_LABELS[check.status], check.url, check.ignored ? "ignored check" : "active check"]),
  ].join(" ").toLowerCase();
  return text.includes(query);
}

export function sortPrs(prs: Pr[], sort: string, direction: string): Pr[] {
  const field = PR_SORTS.find(field => field.value === sort) ?? PR_SORTS[0];
  const sign = direction === "asc" ? 1 : -1;
  return [...prs].sort((a, b) => {
    const left = field.read(a), right = field.read(b);
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { sensitivity: "base", numeric: true });
    return sign * comparison || a.id - b.id;
  });
}
