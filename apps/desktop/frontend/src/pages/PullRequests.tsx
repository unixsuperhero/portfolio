import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { PortfolioApiError } from "@portfolio/client";
import type { Pr, PrsResponse } from "../types.ts";
import { getPrs, getSettings, patchPr, patchSettings, refreshPrs, watchPr } from "../api.ts";
import { PrRow, confirmIgnorePr, confirmIgnoreRepo, ignoreRepo } from "../components/PrRow.tsx";
import { PrStatusIcon } from "../components/PrStatus.tsx";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import { useConfirm } from "../components/ConfirmDialog.tsx";
import { CHECK_FILTERS, lifecycle, matchesPr, PR_FILTER_KEYS, PR_FILTERS, PR_SORTS, sortPrs } from "../lib/pr-collection.ts";
import type { PrFilter } from "../lib/pr-collection.ts";
import "../operational.css";

const EMPTY: PrsResponse = { mine: [], review_requested: [], watched: [], ignored: [], status: { last_poll_at: null, next_poll_at: null, rate: null, polling: false, error: null, gh_ok: true, login: null } };
const COLLECTIONS = [
  { value: "visible", label: "Visible PRs" }, { value: "mine", label: "Mine" }, { value: "review_requested", label: "Review requested" },
  { value: "watched", label: "Watched" }, { value: "ignored", label: "Ignored" }, { value: "all", label: "All, including ignored" },
];
const GROUPS = ["People and location", "Tracking", "Identifiers and text", "Activity"] as const;
const formatTime = (value: string | null) => value ? new Date(value).toLocaleTimeString() : "Not scheduled";
const errorMessage = (error: unknown) => error instanceof PortfolioApiError ? error.message : "Request failed.";

export default function PullRequests() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<PrsResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [ignoredText, setIgnoredText] = useState("");
  const [ignoredRepos, setIgnoredRepos] = useState<string[]>([]);
  const { confirm, dialog } = useConfirm();
  const query = params.get("q") ?? "";
  const sort = params.get("sort") ?? "updated";
  const direction = params.get("direction") ?? (["updated", "fetched", "comments"].includes(sort) ? "desc" : "asc");
  const collection = params.get("collection") ?? "visible";
  const expanded = params.get("filters") === "1";
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true, flushSync: true });
  };
  const toggleMyReviews = () => {
    const next = new URLSearchParams(params);
    if (params.get("collection") === "review_requested") {
      next.delete("collection");
      next.delete("state");
    } else {
      next.set("collection", "review_requested");
      next.set("state", "open");
      next.set("sort", "updated");
      next.set("direction", "desc");
    }
    setParams(next, { replace: true, flushSync: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    PR_FILTER_KEYS.forEach(key => next.delete(key));
    setParams(next, { replace: true, flushSync: true });
    selection.clear();
  };
  const load = () => {
    getPrs().then(result => { setData(result); setOffline(false); }).catch(() => setOffline(true)).finally(() => setLoading(false));
    getSettings().then(settings => setIgnoredRepos(settings.github_ignored_repos ?? [])).catch(() => {});
  };
  useEffect(load, []);
  const refresh = () => {
    setRefreshing(true); setRefreshError(null);
    refreshPrs().then(result => { setData(result); setOffline(false); })
      .catch(error => setRefreshError(errorMessage(error))).finally(() => setRefreshing(false));
  };
  const allPrs = useMemo(() => [...new Map([...data.mine, ...data.review_requested, ...data.watched, ...data.ignored].map(pr => [pr.id, pr])).values()], [data]);
  const hiddenIds = useMemo(() => new Set(data.ignored.map(pr => pr.id)), [data.ignored]);
  const visiblePrs = sortPrs(allPrs.filter(pr => matchesPr(pr, params, hiddenIds.has(pr.id))), sort, direction);
  const selection = useSelection(visiblePrs.map(pr => pr.id));
  const selectedPrs = visiblePrs.filter(pr => selection.selected.has(pr.id));
  const withoutState = new URLSearchParams(params);
  withoutState.delete("state");
  const stateCandidates = allPrs.filter(pr => matchesPr(pr, withoutState, hiddenIds.has(pr.id)));
  const withoutMyReviews = new URLSearchParams(params);
  withoutMyReviews.delete("collection");
  withoutMyReviews.delete("state");
  const myReviewCandidates = allPrs.filter(pr =>
    pr.lists.includes("review_requested")
    && lifecycle(pr) === "open"
    && matchesPr(pr, withoutMyReviews, hiddenIds.has(pr.id)));
  const activeFilters = PR_FILTER_KEYS.filter(key => params.get(key) && !(key === "collection" && params.get(key) === "visible"));
  const primaryKeys = PR_FILTERS.filter(filter => filter.group === "Primary").map(filter => filter.key);
  const advancedCount = activeFilters.filter(key => !["q", "collection", ...primaryKeys].includes(key)).length;

  const renderFilter = (filter: PrFilter) => {
    const value = params.get(filter.key) ?? "";
    const choices = filter.options ?? [...new Set(allPrs.map(pr => String(filter.read(pr))))].sort().map(value => ({ value, label: value === "-" ? "API directory" : value }));
    return <label key={filter.key}>{filter.label}{filter.input === "select"
      ? <select name={filter.key} value={value} onChange={event => update(filter.key, event.target.value)}><option value="">Any</option>{choices.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input name={filter.key} type={filter.input} min={filter.input === "number" ? 0 : undefined} value={value} onChange={event => update(filter.key, event.target.value)} />}</label>;
  };
  const runBulk = (label: string, action: (pr: Pr) => Promise<unknown>) => {
    if (!selectedPrs.length) return;
    setBulkBusy(true); setBulkMessage(null);
    Promise.allSettled(selectedPrs.map(action)).then(results => {
      const failed = results.filter(result => result.status === "rejected");
      const succeeded = results.length - failed.length;
      setBulkMessage(failed.length ? `${label}: ${succeeded} succeeded, ${failed.length} failed (${failed.map(result => result.status === "rejected" ? errorMessage(result.reason) : "").filter(Boolean).slice(0, 2).join("; ")}).` : `${label}: updated ${succeeded} pull request${succeeded === 1 ? "" : "s"}.`);
      selection.clear(); load();
    }).finally(() => setBulkBusy(false));
  };
  const bulkIgnore = async () => {
    if (!selectedPrs.length) return;
    const ok = selectedPrs.length === 1 ? await confirmIgnorePr(confirm, selectedPrs[0])
      : await confirm({ title: `Ignore ${selectedPrs.length} selected pull requests?`, body: "They leave visible lists and stop notifying. Restore them from the Ignored collection.", confirmLabel: "Ignore" });
    if (ok) runBulk("Ignore", pr => patchPr(pr.id, { ignored: true }));
  };
  const bulkIgnoreRepos = async () => {
    const repos = [...new Set(selectedPrs.map(pr => `${pr.owner}/${pr.repo}`))];
    if (repos.length && await confirmIgnoreRepo(confirm, repos)) runBulk("Ignore repos", pr => ignoreRepo(pr));
  };
  const repoQuery = params.get("repo_q") ?? "";
  const repoSort = params.get("repo_sort") ?? "asc";
  const visibleRepos = ignoredRepos.filter(repo => repo.toLowerCase().includes(repoQuery.toLowerCase())).sort((a, b) => (repoSort === "desc" ? -1 : 1) * a.localeCompare(b));
  const repoSelection = useSelection(visibleRepos);
  const restoreRepos = (repos: readonly string[]) => patchSettings({ github_ignored_repos: ignoredRepos.filter(repo => !repos.includes(repo)) })
    .then(() => { repoSelection.clear(); load(); }).catch(error => setRefreshError(errorMessage(error)));
  const status = data.status;

  return <div className="pr-page">
    <div className="page-header"><div><h1>Pull requests</h1><p className="pr-page-intro">Lifecycle, reviews, and checks. One place to see what needs your attention.</p></div>
      <button type="button" className="primary" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></div>
    {offline ? <p className="pr-status pr-status-error" role="alert">Couldn't reach the API. Check the desktop sidecar, then Refresh.</p>
      : !status.gh_ok ? <p className="pr-status pr-status-error" role="alert">GitHub is not authenticated. Run <code>gh auth login</code>, then Refresh.</p>
      : <p className="pr-status">{status.login ? `@${status.login} · ` : ""}Last poll {formatTime(status.last_poll_at)} · Next {formatTime(status.next_poll_at)}{status.rate ? ` · ${status.rate.remaining} API requests remaining` : ""}{status.error ? ` · ${status.error}` : ""}</p>}
    {refreshError ? <p className="pr-status pr-status-error" role="alert">{refreshError}</p> : null}

    <div className="pr-state-shortcuts" aria-label="Pull request shortcuts">
      <button type="button" aria-pressed={!params.get("state")} onClick={() => update("state", "")}>All states <span>{stateCandidates.length}</span></button>
      {(["draft", "open", "merged", "closed"] as const).map(state => <button type="button" className={`pr-tone-${state}`} key={state} aria-pressed={params.get("state") === state} onClick={() => update("state", params.get("state") === state ? "" : state)}><PrStatusIcon kind={state} />{state[0].toUpperCase() + state.slice(1)}<span>{stateCandidates.filter(pr => lifecycle(pr) === state).length}</span></button>)}
      <button type="button" className="pr-tone-review_required" aria-pressed={params.get("collection") === "review_requested"} onClick={toggleMyReviews}><PrStatusIcon kind="review_required" />My Reviews <span>{myReviewCandidates.length}</span></button>
    </div>
    <CollectionToolbar query={query} onQueryChange={value => update("q", value)} sort={sort} onSortChange={value => update("sort", value)} sortOptions={PR_SORTS}>
      <label>Collection<select name="collection" value={collection} onChange={event => update("collection", event.target.value)}>{COLLECTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
      {PR_FILTERS.filter(filter => filter.group === "Primary").map(renderFilter)}
      <label>Order<select name="direction" value={direction} onChange={event => update("direction", event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
    </CollectionToolbar>
    <div className="pr-filter-actions"><button type="button" className="secondary" aria-expanded={expanded} aria-controls="pr-advanced-filters" onClick={() => update("filters", expanded ? "" : "1")}>{expanded ? "Fewer filters" : "More filters"}{advancedCount ? ` (${advancedCount} active)` : ""}</button>
      {activeFilters.length ? <button type="button" className="secondary" onClick={clearFilters}>Clear filters ({activeFilters.length})</button> : null}</div>
    {activeFilters.length ? <div className="pr-active-filters" aria-label="Active filters">{activeFilters.map(key => {
      const filter = PR_FILTERS.find(filter => filter.key === key);
      const label = filter?.label ?? CHECK_FILTERS.find(filter => filter.key === key)?.label ?? (key === "q" ? "Search" : key === "membership" ? "List membership" : "Collection");
      const value = (key === "collection" ? COLLECTIONS : filter?.options)?.find(option => option.value === params.get(key))?.label ?? params.get(key);
      return <button type="button" key={key} onClick={() => update(key, "")} aria-label={`Remove ${label} filter`}><span>{label}: {value}</span><PrStatusIcon kind="closed" /></button>;
    })}</div> : null}
    <div id="pr-advanced-filters" className="pr-advanced-filters" hidden={!expanded}>
      {GROUPS.map(group => <fieldset key={group}><legend>{group}</legend><div className="pr-filter-grid">{PR_FILTERS.filter(filter => filter.group === group).map(renderFilter)}
        {group === "Tracking" ? <label>List membership<select name="membership" value={params.get("membership") ?? ""} onChange={event => update("membership", event.target.value)}><option value="">Any</option><option value="mine">Mine</option><option value="review_requested">Review requested</option><option value="watched">Watched</option><option value="none">No memberships</option></select></label> : null}</div></fieldset>)}
      <fieldset><legend>Individual checks</legend><p className="pr-ignore-hint">These conditions must match the same check, including ignored checks.</p><div className="pr-filter-grid">{CHECK_FILTERS.map(filter => <label key={filter.key}>{filter.label}{filter.input === "select" ? <select name={filter.key} value={params.get(filter.key) ?? ""} onChange={event => update(filter.key, event.target.value)}><option value="">Any</option>{filter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input name={filter.key} type="text" value={params.get(filter.key) ?? ""} onChange={event => update(filter.key, event.target.value)} />}</label>)}</div></fieldset>
    </div>

    <SelectionBar count={selection.selected.size} total={visiblePrs.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={bulkBusy}>
      <button type="button" className="secondary" onClick={() => runBulk("Watch", pr => watchPr(pr.url, true))}>Watch</button>
      <button type="button" className="secondary" onClick={() => runBulk("Unwatch", pr => watchPr(pr.url, false))}>Unwatch</button>
      <button type="button" className="secondary" onClick={() => void bulkIgnore()}>Ignore</button>
      <button type="button" className="secondary" disabled={!selectedPrs.some(pr => pr.ignored)} onClick={() => runBulk("Unignore", pr => patchPr(pr.id, { ignored: false }))}>Unignore PRs</button>
      <button type="button" className="secondary" onClick={() => void bulkIgnoreRepos()}>Ignore repos</button>
      <label className="bulk-inline-field">Ignored-check patterns<textarea value={ignoredText} onChange={event => setIgnoredText(event.target.value)} rows={2} placeholder="one glob per line" /></label>
      <button type="button" className="secondary" onClick={() => runBulk("Ignored checks", pr => patchPr(pr.id, { ignored_checks: ignoredText.split("\n").map(line => line.trim()).filter(Boolean) }))}>Apply ignored checks</button>
    </SelectionBar>
    {bulkMessage ? <p role="status" className={bulkMessage.includes("failed") ? "operational-error" : "operational-status"}>{bulkMessage}</p> : null}
    {loading ? <p className="pr-status" role="status">Loading pull requests…</p> : <div className="pr-list" aria-label="Pull requests">
      {visiblePrs.map(pr => <div className={`selectable-pr-row${selection.selected.has(pr.id) ? " is-selected" : ""}`} key={pr.id}>
        <input type="checkbox" checked={selection.selected.has(pr.id)} onChange={() => selection.toggle(pr.id)} aria-label={`Select ${pr.owner}/${pr.repo}#${pr.number}`} />
        <PrRow pr={pr} onChanged={load} confirm={confirm} repoIgnored={hiddenIds.has(pr.id) && !pr.ignored} />
      </div>)}
      {!visiblePrs.length ? <div className="empty"><strong>{activeFilters.length ? "No pull requests match these filters." : "No pull requests in this collection."}</strong><p>{activeFilters.length ? "Clear filters to see the rest of your pull requests." : "Refresh to check GitHub for updates, or choose another collection."}</p>{activeFilters.length ? <button type="button" className="secondary" onClick={clearFilters}>Clear filters</button> : null}</div> : null}
    </div>}
    {ignoredRepos.length ? <details className="pr-ignored-repos"><summary>Ignored repositories ({ignoredRepos.length})</summary>
      <CollectionToolbar query={repoQuery} onQueryChange={value => update("repo_q", value)} sort={repoSort} onSortChange={value => update("repo_sort", value)} sortOptions={[{ value: "asc", label: "Repository A–Z" }, { value: "desc", label: "Repository Z–A" }]} />
      <SelectionBar count={repoSelection.selected.size} total={visibleRepos.length} allSelected={repoSelection.allSelected} onToggleAll={repoSelection.toggleAll} onClear={repoSelection.clear}><button type="button" className="secondary" onClick={() => void restoreRepos([...repoSelection.selected])}>Restore selected repositories</button></SelectionBar>
      <ul>{visibleRepos.map(repo => <li key={repo}><label><input type="checkbox" checked={repoSelection.selected.has(repo)} onChange={() => repoSelection.toggle(repo)} />{repo}</label><button type="button" className="secondary" onClick={() => void restoreRepos([repo])}>Unignore repo</button></li>)}</ul>
      {!visibleRepos.length ? <p className="pr-ignore-hint">No repositories match this search.</p> : null}
    </details> : null}
    {dialog}
  </div>;
}
