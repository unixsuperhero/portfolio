import { useEffect, useMemo, useState } from "react";
import { CollectionToolbar } from "@portfolio/ui/collections";
import { getSettings } from "../api.ts";
import type { Pr, SettingsView } from "../types.ts";
import { BUILTIN_PR_VIEWS, CHECK_FILTERS, defaultPrDirection, matchesPr, normalizePrViewQuery, PR_COLLECTIONS, PR_FILTERS, PR_SORTS } from "../lib/pr-collection.ts";
import type { PrFilter } from "../lib/pr-collection.ts";
import { usePrData } from "../hooks/usePrData.tsx";

const GROUPS = ["People and location", "Tracking", "Identifiers and text", "Activity"] as const;

export function PrCardFilterEditor({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const params = useMemo(() => new URLSearchParams(query), [query]);
  const { data } = usePrData();
  const [settings, setSettings] = useState<SettingsView | null>(null);
  useEffect(() => { getSettings().then(setSettings).catch(() => setSettings(null)); }, []);
  const allPrs = useMemo(() => [...new Map([...data.mine, ...data.review_requested, ...data.watched, ...data.ignored].map(pr => [pr.id, pr])).values()], [data]);
  const hiddenIds = useMemo(() => new Set(data.ignored.map(pr => pr.id)), [data.ignored]);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    onChange(normalizePrViewQuery(next));
  };
  const renderFilter = (filter: PrFilter) => {
    const value = params.get(filter.key) ?? "";
    const dynamic = [...new Set(allPrs.map(pr => String(filter.read(pr))))].sort();
    if (value && !dynamic.includes(value)) dynamic.push(value);
    const choices = filter.options ?? dynamic.map(choice => ({ value: choice, label: choice === "-" ? "API directory" : choice }));
    return <label key={filter.key}>{filter.label}{filter.input === "select"
      ? <select name={filter.key} value={value} onChange={event => update(filter.key, event.target.value)}><option value="">Any</option>{choices.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input name={filter.key} type={filter.input} min={filter.input === "number" ? 0 : undefined} value={value} onChange={event => update(filter.key, event.target.value)} />}</label>;
  };
  const applyView = (value: string) => {
    const view = [...BUILTIN_PR_VIEWS, ...(settings?.github_pr_views ?? [])].find(candidate => candidate.id === value);
    if (view) onChange(normalizePrViewQuery(view.query));
  };
  return <div className="pr-card-filter-editor">
    <label>Start from a PR view<select value="" onChange={event => applyView(event.target.value)}><option value="">Choose a built-in or saved view…</option>{[...BUILTIN_PR_VIEWS, ...(settings?.github_pr_views ?? [])].map(view => <option key={view.id} value={view.id}>{view.label}</option>)}</select></label>
    <CollectionFields params={params} allPrs={allPrs} hiddenIds={hiddenIds} update={update} renderFilter={renderFilter} />
    <details><summary>Advanced PR filters</summary>
      {GROUPS.map(group => <fieldset key={group}><legend>{group}</legend><div className="pr-filter-grid">{PR_FILTERS.filter(filter => filter.group === group).map(renderFilter)}
        {group === "Tracking" ? <label>List membership<select name="membership" value={params.get("membership") ?? ""} onChange={event => update("membership", event.target.value)}><option value="">Any</option><option value="mine">Mine</option><option value="review_requested">Review requested</option><option value="watched">Watched</option><option value="none">No memberships</option></select></label> : null}</div></fieldset>)}
      <fieldset><legend>Individual checks</legend><p>These conditions must match the same check, including ignored checks.</p><div className="pr-filter-grid">{CHECK_FILTERS.map(filter => <label key={filter.key}>{filter.label}{filter.input === "select"
        ? <select name={filter.key} value={params.get(filter.key) ?? ""} onChange={event => update(filter.key, event.target.value)}><option value="">Any</option>{filter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input name={filter.key} type="text" value={params.get(filter.key) ?? ""} onChange={event => update(filter.key, event.target.value)} />}</label>)}</div></fieldset>
    </details>
    <p className="pr-ignore-hint">Portfolio scope additionally requires a linked PR item to match. Unlinked PRs are hidden while the portfolio scope is active.</p>
  </div>;
}

function CollectionFields({ params, allPrs, hiddenIds, update, renderFilter }: {
  params: URLSearchParams;
  allPrs: Pr[];
  hiddenIds: ReadonlySet<number>;
  update: (key: string, value: string) => void;
  renderFilter: (filter: PrFilter) => React.ReactNode;
}) {
  const sort = params.get("sort") ?? "updated";
  const direction = params.get("direction") ?? defaultPrDirection(sort);
  return <CollectionToolbar query={params.get("q") ?? ""} onQueryChange={value => update("q", value)} sort={sort} onSortChange={value => update("sort", value)} sortOptions={PR_SORTS}>
    <label>Collection<select name="collection" value={params.get("collection") ?? "visible"} onChange={event => update("collection", event.target.value)}>{PR_COLLECTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
    {PR_FILTERS.filter(filter => filter.group === "Primary").map(renderFilter)}
    <label>Order<select name="direction" value={direction} onChange={event => update("direction", event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
    <span className="pr-card-filter-count">{allPrs.filter(pr => matchesPr(pr, params, hiddenIds.has(pr.id))).length} current PRs match</span>
  </CollectionToolbar>;
}
