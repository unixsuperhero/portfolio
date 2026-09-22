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

const PR_FRAGMENT = `fragment prFields on PullRequest {\n${PR_FIELDS}\n}`;

/** Escapes a string for inclusion in a double-quoted GraphQL string literal. */
const gqlString = (value: string): string => JSON.stringify(value);

/**
 * Both search lists (`is:pr is:open author:@me` and `is:pr is:open review-requested:@me`,
 * first 50 each) plus rateLimit, as one GraphQL document.
 */
export function listsQuery(): string {
  return `query {
  mine: search(query: ${gqlString("is:pr is:open author:@me")}, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ...prFields } }
  }
  review_requested: search(query: ${gqlString("is:pr is:open review-requested:@me")}, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ...prFields } }
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
