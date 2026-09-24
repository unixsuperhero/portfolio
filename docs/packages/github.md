# @portfolio/github

GitHub pull requests, reached only through the `gh` CLI (`gh api graphql`). Pure query building and response parsing, plus one poller that shells out. No UI, and no direct network calls — everything goes through `gh`.

```ts
import { createPrPoller, ghAuth, ghGraphql } from "@portfolio/github";
import { openStore } from "@portfolio/db";

const store = openStore();
const auth = await ghAuth();                    // { ok, login } from `gh api user`
const poller = createPrPoller({ db: store, gh: { graphql: query => ghGraphql(query) }, login: auth.login, ghOk: auth.ok });
poller.start();                                   // one tick now, then every cadenceMs()
```

## Files

| File | Holds |
|------|-------|
| `query.ts` | `listsQuery()` — both search lists (`is:pr is:open author:@me` / `review-requested:@me`, first 50 each) plus `rateLimit`, as one GraphQL document; `watchedQuery(refs)` — up to `WATCHED_BATCH_LIMIT` (25) watched PRs, one aliased `repository { pullRequest }` per PR |
| `parse.ts` | `parsePrNode(node, existing?, fetchedAt?)` — a `...prFields` GraphQL node to the contract's `Pr` shape (minus `id`); `parseCheck(node)` — one `CheckRun`/`StatusContext` to `{ name, status, url }`; `watchedNodes(response)` — every non-null `pullRequest` alias in a watched-batch response |
| `diff.ts` | `checksSummary(checks, ignoredPatterns)` — over non-ignored checks only, `failure`/`cancelled` > `pending` > `success`, `"none"` when nothing counts; `isIgnored(name, patterns)` — case-insensitive glob match (`*`); `applyIgnored(checks, patterns)`; `diffPr(previous, next, globalIgnored, at?)` — drafts `PrEvent`s for a state change, a `review_decision` change, a comment-count increase, and a `checks_summary` change; `null` previous means no events |
| `gh.ts` | `ghGraphql(query, variables?, { run?, bin? })` — `gh api graphql -f query=… -F var=…` via `Bun.spawn`, 30s timeout, injectable `run`; `ghAuth({ run?, bin? })` — `{ ok, login }` from `gh api user`, falling back to `gh auth status` |
| `poller.ts` | `createPrPoller({ db, gh, now?, log?, login?, ghOk? })` — see below |

## The poller

`createPrPoller({ db, gh, ... })` returns `{ tick, start, stop, status, refresh, fetchOne }`. `db` is a `@portfolio/db` `Store` (or anything shaped like `store.github` + `store.settings`); `gh` is `{ graphql(query, { cwd }?) }`, normally `ghGraphql` wrapped so tests can inject a recording fake instead. `ghGraphql(query, variables, { cwd })` passes `cwd` to `Bun.spawn`, so gh resolves the host and repo from that directory's git remote.

- **`tick()`** — one cycle: the lists request (mine + review_requested + rateLimit) once per `settings.github_dirs` entry, with `gh` run from that directory (`{ cwd }`), or once with no cwd when the list is empty. A PR belongs to the first directory that returns it (`source_dir`). Then, only if the lowest `rateLimit.remaining >= 200`, one request per directory for the watched PRs not already in the lists (up to 25 each, grouped by `source_dir`). Never more than 2 GraphQL requests per directory. A directory that throws is skipped and named in `status().error`; the tick fails only when every directory throws. Each returned node is parsed, ignored-check patterns (global + per-PR) are applied, the row is upserted, and `diffPr` runs against the previous row to append events. `rateLimit.remaining < 200` schedules a skip until `resetAt`; a thrown error backs off exponentially up to 15 minutes.
- **`start()` / `stop()`** — ticks immediately, then reschedules itself after each tick: every `github_poll_minutes` (default 2) while any PR is watched, else every 10 minutes, or after the current backoff on error.
- **`status()`** → `PrStatus` — `{ last_poll_at, next_poll_at, rate, polling, error, gh_ok, login }`.
- **`refresh()`** — forces a tick; throws `{ status: 429, message }` when called again within 30 seconds.
- **`fetchOne({ owner, repo, number })`** — one GraphQL request per directory, stopping at the first that returns the PR, which becomes its `source_dir` (used by `POST /api/prs/watch` when the URL isn't tracked yet).

## Example

```js
const events = diffPr(
  { ...previousPr, state: "open" },
  { ...previousPr, state: "merged" },
  [],
);
// [{ pr_id: 7, kind: "state", message: "acme/app#12 merged", at: "…" }]

checksSummary(
  [{ name: "codecov/patch", status: "failure", url: "…", ignored: false }],
  ["codecov/*"],
);
// "none" — the only check is ignored
```

Tests: `packages/github/test/{parse,diff,poller}.test.ts`, with GraphQL response fixtures in `packages/github/test/fixtures/`. The poller tests use a fake `gh` that records calls and a real in-memory `@portfolio/db` store. Back to the [index](../index.md).
