import type { ChecksSummary, Pr, PrCheck } from "@portfolio/core";

/** Turns a glob pattern with `*` into a case-insensitive, anchored RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/** Whether a check name matches any of the given glob patterns. */
export function isIgnored(name: string, patterns: string[]): boolean {
  return patterns.some(pattern => globToRegex(pattern).test(name));
}

/** Marks each check ignored per the global + per-PR glob patterns. */
export function applyIgnored(checks: PrCheck[], ignoredPatterns: string[]): PrCheck[] {
  return checks.map(check => ({ ...check, ignored: isIgnored(check.name, ignoredPatterns) }));
}

/** The overall status over non-ignored checks only: failure/cancelled > pending > success; "none" when nothing counts. */
export function checksSummary(checks: PrCheck[], ignoredPatterns: string[]): ChecksSummary {
  const active = checks.filter(check => !check.ignored && !isIgnored(check.name, ignoredPatterns));
  if (!active.length) return "none";
  if (active.some(check => check.status === "failure" || check.status === "cancelled")) return "failure";
  if (active.some(check => check.status === "pending")) return "pending";
  return "success";
}

export interface PrEventDraft {
  pr_id: number;
  kind: "state" | "comments" | "checks" | "review";
  message: string;
  at: string;
}

/** `owner/repo#n`, as used in event messages. */
const prLabel = (pr: Pr): string => `${pr.owner}/${pr.repo}#${pr.number}`;

/**
 * Compares the stored row to a freshly parsed one and drafts events for state,
 * review decision, comment-count increases, and effective check-summary changes.
 * No previous row means no events.
 */
export function diffPr(previous: Pr | null, next: Pr, ignoredPatterns: string[], at: string = new Date().toISOString()): PrEventDraft[] {
  if (!previous) return [];
  const events: PrEventDraft[] = [];
  const label = prLabel(next);

  if (previous.state !== next.state) events.push({ pr_id: next.id, kind: "state", message: `${label} ${next.state}`, at });

  if (next.review_decision && previous.review_decision !== next.review_decision) {
    events.push({ pr_id: next.id, kind: "review", message: `${label} review ${next.review_decision}`, at });
  }

  if (next.comments > previous.comments) {
    events.push({ pr_id: next.id, kind: "comments", message: `${label} +${next.comments - previous.comments} comment${next.comments - previous.comments === 1 ? "" : "s"}`, at });
  }

  const previousSummary = checksSummary(applyIgnored(previous.checks, ignoredPatterns), ignoredPatterns);
  const nextSummary = checksSummary(applyIgnored(next.checks, ignoredPatterns), ignoredPatterns);
  if (previousSummary !== nextSummary) events.push({ pr_id: next.id, kind: "checks", message: `${label} checks ${nextSummary}`, at });

  return events;
}
