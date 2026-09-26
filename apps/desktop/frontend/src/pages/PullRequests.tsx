import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { PortfolioApiError } from "@portfolio/client";
import type { GithubIgnoredCheckRule, GithubPrView, Pr, SettingsView } from "../types.ts";
import { getSettings, patchPr, patchSettings, watchPr } from "../api.ts";
import { PrRow, confirmIgnorePr, confirmIgnoreRepo, ignoreRepo } from "../components/PrRow.tsx";
import { PrStatusIcon } from "../components/PrStatus.tsx";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import { useConfirm } from "../components/ConfirmDialog.tsx";
import { BUILTIN_PR_VIEWS, CHECK_FILTERS, defaultPrDirection, ignoredCheckRuleRepos, lifecycle, matchesPr, normalizePrViewQuery, PR_COLLECTIONS, PR_FILTER_KEYS, PR_FILTERS, PR_SORTS, sortPrs } from "../lib/pr-collection.ts";
import type { PrFilter } from "../lib/pr-collection.ts";
import { usePrData } from "../hooks/usePrData.tsx";
import "../operational.css";

const GROUPS = ["People and location", "Tracking", "Identifiers and text", "Activity"] as const;
const formatTime = (value: string | null) => value ? new Date(value).toLocaleTimeString() : "Not scheduled";
const errorMessage = (error: unknown) => error instanceof PortfolioApiError ? error.message : "Request failed.";

export default function PullRequests() {
  const [params, setParams] = useSearchParams();
  const { data, loading, offline, reload, refresh: refreshData } = usePrData();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [viewName, setViewName] = useState("");
  const [includeAllChecks, setIncludeAllChecks] = useState(false);
  const [selectedCheckRule, setSelectedCheckRule] = useState("");
  const initialQuery = useRef(params.size > 0);
  const defaultApplied = useRef(false);
  const { confirm, dialog } = useConfirm();
  const query = params.get("q") ?? "";
  const sort = params.get("sort") ?? "updated";
  const direction = params.get("direction") ?? defaultPrDirection(sort);
  const collection = params.get("collection") ?? "visible";
  const expanded = params.get("filters") === "1";
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true, flushSync: true });
  };
  const applyView = (view: Pick<GithubPrView, "query">) => {
    setParams(new URLSearchParams(view.query), { replace: true, flushSync: true });
    selection.clear();
  };
  const toggleWatching = () => update("collection", params.get("collection") === "watched" ? "" : "watched");
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
    void reload().catch(() => {});
    getSettings().then(setSettings).catch(() => {});
  };
  useEffect(() => { getSettings().then(setSettings).catch(() => {}); }, []);
  useEffect(() => {
    if (!settings || defaultApplied.current) return;
    defaultApplied.current = true;
    if (initialQuery.current) return;
    const view = [...BUILTIN_PR_VIEWS, ...settings.github_pr_views].find(candidate => candidate.id === settings.github_pr_default_view);
    if (view?.query) setParams(new URLSearchParams(view.query), { replace: true });
  }, [settings, setParams]);
  const refresh = () => {
    setRefreshing(true); setRefreshError(null);
    refreshData()
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
  const withoutWatching = new URLSearchParams(params);
  withoutWatching.delete("collection");
  const watchingCandidates = allPrs.filter(pr => pr.watched && matchesPr(pr, withoutWatching, hiddenIds.has(pr.id)));
  const currentViewQuery = normalizePrViewQuery(params);
  const saveCurrentView = () => {
    const label = viewName.trim();
    if (!label || !settings) return;
    const view: GithubPrView = { id: crypto.randomUUID(), label, query: currentViewQuery };
    patchSettings({ github_pr_views: [...settings.github_pr_views, view] })
      .then(next => { setSettings(next); setViewName(""); })
      .catch(error => setRefreshError(errorMessage(error)));
  };
  const ignoredCheckRules = settings?.github_ignored_check_rules ?? [];
  const ignoredRuleQuery = params.get("ignored_rule_q") ?? "";
  const ignoredRuleSort = params.get("ignored_rule_sort") ?? "repo";
  const ignoredRuleRepo = params.get("ignored_rule_repo") ?? "";
  const ignoredRuleRepos = ignoredCheckRuleRepos(allPrs, ignoredCheckRules);
  const visibleIgnoredCheckRules = ignoredCheckRules
    .filter(rule => (!ignoredRuleRepo || rule.repo === ignoredRuleRepo) && `${rule.repo} ${rule.check}`.toLowerCase().includes(ignoredRuleQuery.toLowerCase()))
    .sort((left, right) => ignoredRuleSort === "check" ? left.check.localeCompare(right.check) || left.repo.localeCompare(right.repo) : left.repo.localeCompare(right.repo) || left.check.localeCompare(right.check));
  const checkRuleOptions = useMemo(() => {
    const options = new Map<string, { repo: string; check: string; failing: boolean }>();
    for (const pr of allPrs) {
      const repo = `${pr.owner}/${pr.repo}`;
      for (const check of pr.checks) {
        const failing = check.status === "failure" || check.status === "cancelled";
        const key = JSON.stringify([repo, check.name]);
        if (!options.has(key)) options.set(key, { repo, check: check.name, failing });
      }
    }
    const existing = new Set(ignoredCheckRules.map(rule => JSON.stringify([rule.repo, rule.check])));
    return [...options.entries()]
      .filter(([key, option]) => !existing.has(key) && (includeAllChecks || option.failing))
      .sort(([, left], [, right]) => Number(right.failing) - Number(left.failing) || left.repo.localeCompare(right.repo) || left.check.localeCompare(right.check));
  }, [allPrs, ignoredCheckRules, includeAllChecks]);
  const saveIgnoredCheckRules = (github_ignored_check_rules: GithubIgnoredCheckRule[]) =>
    patchSettings({ github_ignored_check_rules }).then(next => {
      setSettings(next);
      setSelectedCheckRule("");
      void reload().catch(() => {});
    }).catch(error => setRefreshError(errorMessage(error)));
  const addIgnoredCheckRule = () => {
    if (!selectedCheckRule) return;
    const [repo, check] = JSON.parse(selectedCheckRule) as [string, string];
    void saveIgnoredCheckRules([...ignoredCheckRules, { repo, check }]);
  };
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
  const ignoredRepos = settings?.github_ignored_repos ?? [];
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
      <button type="button" className="pr-tone-watched" aria-pressed={params.get("collection") === "watched"} onClick={toggleWatching}><PrStatusIcon kind="watched" />Watching <span>{watchingCandidates.length}</span></button>
      {settings?.github_pr_views.map(view => <button type="button" key={view.id} aria-pressed={currentViewQuery === normalizePrViewQuery(view.query)} onClick={() => applyView(view)}>{view.label}</button>)}
    </div>
    <form className="pr-save-view" onSubmit={event => { event.preventDefault(); saveCurrentView(); }}>
      <label>Save current filters as a shortcut<input value={viewName} onChange={event => setViewName(event.target.value)} placeholder="View name" /></label>
      <button type="submit" className="secondary" disabled={!viewName.trim()}>Save view</button>
    </form>
    <CollectionToolbar query={query} onQueryChange={value => update("q", value)} sort={sort} onSortChange={value => update("sort", value)} sortOptions={PR_SORTS}>
      <label>Collection<select name="collection" value={collection} onChange={event => update("collection", event.target.value)}>{PR_COLLECTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
      {PR_FILTERS.filter(filter => filter.group === "Primary").map(renderFilter)}
      <label>Order<select name="direction" value={direction} onChange={event => update("direction", event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
    </CollectionToolbar>
    <div className="pr-filter-actions"><button type="button" className="secondary" aria-expanded={expanded} aria-controls="pr-advanced-filters" onClick={() => update("filters", expanded ? "" : "1")}>{expanded ? "Fewer filters" : "More filters"}{advancedCount ? ` (${advancedCount} active)` : ""}</button>
      {activeFilters.length ? <button type="button" className="secondary" onClick={clearFilters}>Clear filters ({activeFilters.length})</button> : null}</div>
    {activeFilters.length ? <div className="pr-active-filters" aria-label="Active filters">{activeFilters.map(key => {
      const filter = PR_FILTERS.find(filter => filter.key === key);
      const label = filter?.label ?? CHECK_FILTERS.find(filter => filter.key === key)?.label ?? (key === "q" ? "Search" : key === "membership" ? "List membership" : "Collection");
      const value = (key === "collection" ? PR_COLLECTIONS : filter?.options)?.find(option => option.value === params.get(key))?.label ?? params.get(key);
      return <button type="button" key={key} onClick={() => update(key, "")} aria-label={`Remove ${label} filter`}><span>{label}: {value}</span><PrStatusIcon kind="closed" /></button>;
    })}</div> : null}
    <div id="pr-advanced-filters" className="pr-advanced-filters" hidden={!expanded}>
      {GROUPS.map(group => <fieldset key={group}><legend>{group}</legend><div className="pr-filter-grid">{PR_FILTERS.filter(filter => filter.group === group).map(renderFilter)}
        {group === "Tracking" ? <label>List membership<select name="membership" value={params.get("membership") ?? ""} onChange={event => update("membership", event.target.value)}><option value="">Any</option><option value="mine">Mine</option><option value="review_requested">Review requested</option><option value="watched">Watched</option><option value="none">No memberships</option></select></label> : null}</div></fieldset>)}
      <fieldset><legend>Individual checks</legend><p className="pr-ignore-hint">These conditions must match the same check, including ignored checks.</p><div className="pr-filter-grid">{CHECK_FILTERS.map(filter => <label key={filter.key}>{filter.label}{filter.input === "select" ? <select name={filter.key} value={params.get(filter.key) ?? ""} onChange={event => update(filter.key, event.target.value)}><option value="">Any</option>{filter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input name={filter.key} type="text" value={params.get(filter.key) ?? ""} onChange={event => update(filter.key, event.target.value)} />}</label>)}</div></fieldset>
    </div>

    <details className="pr-ignored-check-rules">
      <summary>Ignored check failures ({ignoredCheckRules.length})</summary>
      <p className="pr-ignore-hint">Rules apply only to the named repository. Matching failures stay visible and counted, but do not make the effective checks status fail.</p>
      <CollectionToolbar query={ignoredRuleQuery} onQueryChange={value => update("ignored_rule_q", value)} sort={ignoredRuleSort} onSortChange={value => update("ignored_rule_sort", value)} sortOptions={[
        { value: "repo", label: "Repository" }, { value: "check", label: "Check name" },
      ]}>
        <label>Repository<select value={ignoredRuleRepo} onChange={event => update("ignored_rule_repo", event.target.value)}><option value="">All repositories</option>{ignoredRuleRepos.map(repo => <option key={repo} value={repo}>{repo}</option>)}</select></label>
      </CollectionToolbar>
      <div className="pr-ignore-check-controls">
        <label>Repository check<select value={selectedCheckRule} onChange={event => setSelectedCheckRule(event.target.value)}>
          <option value="">{checkRuleOptions.length ? "Choose a check…" : includeAllChecks ? "No checks available" : "No failing checks available"}</option>
          {checkRuleOptions.map(([value, option]) => <option key={value} value={value}>{option.repo} — {option.check}{option.failing ? " (failing)" : ""}</option>)}
        </select></label>
        <label className="form-checkbox"><input type="checkbox" checked={includeAllChecks} onChange={event => setIncludeAllChecks(event.target.checked)} /> Include all checks</label>
        <button type="button" className="secondary" disabled={!selectedCheckRule} onClick={addIgnoredCheckRule}>Ignore failure</button>
      </div>
      <div className="pr-ignored-check-rule-list" aria-label="Repository ignored-check rules">
        {visibleIgnoredCheckRules.map(rule => <button type="button" className="secondary" key={`${rule.repo}:${rule.check}`} onClick={() => void saveIgnoredCheckRules(ignoredCheckRules.filter(item => item !== rule))} aria-label={`Remove ignored check rule ${rule.repo} ${rule.check}`}>{rule.repo} — {rule.check} ×</button>)}
        {!visibleIgnoredCheckRules.length ? <span className="pr-ignore-hint">{ignoredCheckRules.length ? "No rules match these filters." : "No ignored check failures."}</span> : null}
      </div>
    </details>

    <SelectionBar count={selection.selected.size} total={visiblePrs.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={bulkBusy}>
      <button type="button" className="secondary" onClick={() => runBulk("Watch", pr => watchPr(pr.url, true))}>Watch</button>
      <button type="button" className="secondary" onClick={() => runBulk("Unwatch", pr => watchPr(pr.url, false))}>Unwatch</button>
      <button type="button" className="secondary" onClick={() => void bulkIgnore()}>Ignore</button>
      <button type="button" className="secondary" disabled={!selectedPrs.some(pr => pr.ignored)} onClick={() => runBulk("Unignore", pr => patchPr(pr.id, { ignored: false }))}>Unignore PRs</button>
      <button type="button" className="secondary" onClick={() => void bulkIgnoreRepos()}>Ignore repos</button>
      
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
