/** GraphQL query building for the two request shapes the poller sends: search lists, and a batch of watched PRs. */

const PR_FIELDS = `
  url
  number
  title
  isDraft
  state
  merged
  reviewDecision
  updatedAt
  author { login }
  repository { owner { login } name }
  comments { totalCount }
  reviews { totalCount }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name conclusion status detailsUrl }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
`;

const REVIEW_REQUEST_FIELDS = `
    reviewRequests(first: 100) {
      nodes {
        requestedReviewer {
          __typename
          ... on User { id }
        }
      }
    }`;

const PR_FRAGMENT = `fragment prFields on PullRequest {\n${PR_FIELDS}\n}`;

/** Escapes a string for inclusion in a double-quoted GraphQL string literal. */
const gqlString = (value: string): string => JSON.stringify(value);

export type ListName = "mine" | "review_requested";

const LIST_SEARCH: Record<ListName, string> = {
  mine: "is:pr is:open author:@me",
  review_requested: "is:pr is:open -is:draft review-requested:@me sort:updated-desc",
};

/**
 * One search list on its own with a smaller page, plus rateLimit. The poller falls back to
 * this when the combined lists query times out on GitHub's side (HTTP 502/504), which
 * happens for accounts with many open PRs that each carry hundreds of check contexts.
 */
export function listQuery(list: ListName, first: number, after: string | null = null): string {
  const reviewRequests = list === "review_requested" ? REVIEW_REQUEST_FIELDS : "";
  const cursor = after === null ? "" : `, after: ${gqlString(after)}`;
  return `query {
  viewer { id }
  ${list}: search(query: ${gqlString(LIST_SEARCH[list])}, type: ISSUE, first: ${first}${cursor}) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ...prFields${reviewRequests} } }
  }
  rateLimit { remaining resetAt }
}
${PR_FRAGMENT}`;
}

/**
 * Both open search lists, with review requests fetched on review candidates so the
 * poller can distinguish a direct user request from a team request.
 */
export function listsQuery(): string {
  return `query {
  viewer { id }
  mine: search(query: ${gqlString(LIST_SEARCH.mine)}, type: ISSUE, first: 50) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ...prFields } }
  }
  review_requested: search(query: ${gqlString(LIST_SEARCH.review_requested)}, type: ISSUE, first: 50) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ...prFields${REVIEW_REQUEST_FIELDS} } }
  }
  rateLimit { remaining resetAt }
}
${PR_FRAGMENT}`;
}

export const WATCHED_BATCH_LIMIT = 25;

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** Every watched PR (up to WATCHED_BATCH_LIMIT), one aliased `repository { pullRequest }` per PR, plus rateLimit. */
export function watchedQuery(refs: PrRef[]): string {
  const batch = refs.slice(0, WATCHED_BATCH_LIMIT);
  const aliases = batch.map((ref, i) => `  pr${i}: repository(owner: ${gqlString(ref.owner)}, name: ${gqlString(ref.repo)}) {
    pullRequest(number: ${ref.number}) { ...prFields }
  }`).join("\n");
  return `query {
${aliases}
  rateLimit { remaining resetAt }
}
${PR_FRAGMENT}`;
}
