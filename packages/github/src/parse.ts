import type { CheckStatus, Pr, ReviewDecision } from "@portfolio/core";
import { isIgnored } from "./diff.ts";

/** The shape a `...prFields` fragment resolves to in the GraphQL response. */
export interface PrNode {
  url: string;
  number: number;
  title: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  merged: boolean;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  updatedAt: string;
  author: { login: string } | null;
  repository: { owner: { login: string }; name: string };
  comments: { totalCount: number };
  reviews: { totalCount: number };
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: CheckContextNode[] } } | null } }[] };
}

interface CheckContextNode {
  __typename: "CheckRun" | "StatusContext";
  name?: string;
  conclusion?: string | null;
  status?: string | null;
  detailsUrl?: string | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
}

const CHECK_RUN_CONCLUSION: Record<string, CheckStatus> = {
  SUCCESS: "success",
  FAILURE: "failure",
  TIMED_OUT: "failure",
  ACTION_REQUIRED: "failure",
  STALE: "failure",
  CANCELLED: "cancelled",
  SKIPPED: "skipped",
  NEUTRAL: "neutral",
};

const STATUS_CONTEXT_STATE: Record<string, CheckStatus> = {
  SUCCESS: "success",
  ERROR: "failure",
  FAILURE: "failure",
  PENDING: "pending",
  EXPECTED: "pending",
};

/** Maps one CheckRun/StatusContext node to the contract's { name, status, url } shape. */
export function parseCheck(node: CheckContextNode): { name: string; status: CheckStatus; url: string } {
  if (node.__typename === "StatusContext") {
    return { name: node.context ?? "", status: STATUS_CONTEXT_STATE[node.state ?? ""] ?? "pending", url: node.targetUrl ?? "" };
  }
  const status: CheckStatus = node.status !== "COMPLETED" ? "pending" : (CHECK_RUN_CONCLUSION[node.conclusion ?? ""] ?? "pending");
  return { name: node.name ?? "", status, url: node.detailsUrl ?? "" };
}

/** Parses a GraphQL `...prFields` node into the contract's Pr shape. `ignored_checks` and `watched` carry over from the stored row. */
/** Everything polling can know about a PR: the row minus its id and the user-owned `ignored` flag. */
export type PrDraft = Omit<Pr, "id" | "ignored">;

export function parsePrNode(node: PrNode, existing: { ignored_checks?: string[]; watched?: boolean; lists?: string[]; item_id?: number | null; source_dir?: string | null } = {}, fetchedAt: string = new Date().toISOString()): PrDraft {
  const contexts = node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  const ignored_checks = existing.ignored_checks ?? [];
  const checks = contexts.map(context => {
    const check = parseCheck(context);
    return { ...check, ignored: isIgnored(check.name, ignored_checks) };
  });
  return {
    url: node.url,
    owner: node.repository.owner.login,
    repo: node.repository.name,
    number: node.number,
    title: node.title,
    author: node.author?.login ?? "",
    is_draft: node.isDraft,
    state: node.merged ? "merged" : (node.state.toLowerCase() as Pr["state"]),
    review_decision: node.reviewDecision ? (node.reviewDecision.toLowerCase() as ReviewDecision) : null,
    updated_at: node.updatedAt,
    comments: node.comments.totalCount + node.reviews.totalCount,
    checks,
    checks_summary: "none",
    watched: existing.watched ?? false,
    ignored_checks,
    lists: existing.lists ?? [],
    item_id: existing.item_id ?? null,
    source_dir: existing.source_dir ?? null,
    fetched_at: fetchedAt,
  };
}

export interface RateLimit {
  remaining: number;
  resetAt: string;
}

/** The lists response's shape (mine/review_requested/rateLimit), pre-parse. */
export interface ListsResponse {
  mine: { nodes: PrNode[] };
  review_requested: { nodes: PrNode[] };
  rateLimit: RateLimit;
}

/** A watched-batch response: pr0, pr1, ... aliases each { pullRequest: PrNode | null }, plus rateLimit. */
export type WatchedResponse = Record<string, { pullRequest: PrNode | null } | RateLimit | undefined> & { rateLimit: RateLimit };

/** Every non-null PrNode in a watched-batch response, in alias order. */
export function watchedNodes(response: WatchedResponse): PrNode[] {
  const nodes: PrNode[] = [];
  for (const [key, value] of Object.entries(response)) {
    if (key === "rateLimit" || !value) continue;
    const pr = (value as { pullRequest: PrNode | null }).pullRequest;
    if (pr) nodes.push(pr);
  }
  return nodes;
}
