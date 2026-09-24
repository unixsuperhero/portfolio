import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { PortfolioApiError } from "@portfolio/client";
import type { Pr, PrsResponse } from "../types.ts";
import { getPrs, patchPr, refreshPrs, watchPr } from "../api.ts";
import { PrRow, dirLabel } from "../components/PrRow.tsx";
import { CollectionToolbar, SelectionBar, useSelection } from "../components/CollectionTools.tsx";
import "../operational.css";

const EMPTY: PrsResponse = { mine: [], review_requested: [], watched: [], status: { last_poll_at: null, next_poll_at: null, rate: null, polling: false, error: null, gh_ok: true, login: null } };

const SORT_OPTIONS = [
  { value: "updated", label: "Updated" },
  { value: "title", label: "Title" },
  { value: "repo", label: "Repo" },
  { value: "dir", label: "Directory" },
] as const;

type PrSort = "updated" | "title" | "repo" | "dir";

/** The filter value for a PR's directory; "-" stands for the API's own directory (source_dir null). */
const DEFAULT_DIR = "-";
const dirKey = (pr: Pr) => pr.source_dir ?? DEFAULT_DIR;

function formatTime(value: string | null): string {
  if (!value) return "–";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

function errorMessage(error: unknown): string {
  return error instanceof PortfolioApiError ? error.message : "Request failed.";
}

function setParam(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

function comparePrs(sort: PrSort): (a: Pr, b: Pr) => number {
  if (sort === "title") return (a, b) => a.title.localeCompare(b.title) || a.repo.localeCompare(b.repo);
  if (sort === "repo") return (a, b) => `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`) || a.number - b.number;
  if (sort === "dir") return (a, b) => (a.source_dir ?? "").localeCompare(b.source_dir ?? "") || Date.parse(b.updated_at) - Date.parse(a.updated_at);
  return (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.title.localeCompare(b.title);
}

function matchesPr(pr: Pr, query: string, state: string, checks: string, dir: string): boolean {
  const needle = query.trim().toLowerCase();
  if (state && pr.state !== state) return false;
  if (checks && pr.checks_summary !== checks) return false;
  if (dir && dirKey(pr) !== dir) return false;
  return !needle || [pr.title, pr.owner, pr.repo, `${pr.owner}/${pr.repo}`, String(pr.number), pr.source_dir ?? ""].some(value => value.toLowerCase().includes(needle));
}

function PrListCard({
  title,
  prs,
  total,
  selected,
  onToggle,
  onChanged,
}: {
  title: string;
  prs: Pr[];
  total: number;
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onChanged: () => void;
}) {
  return (
    <section className="rail-section portfolio-card">
      <header>
        <h2>{title}</h2>
        <div className="rail-heading-actions"><span>{prs.length}{prs.length === total ? "" : ` / ${total}`}</span></div>
      </header>
      {prs.length ? (
        <div className="pr-list">
          {prs.map(pr => (
            <div className={`selectable-pr-row${selected.has(pr.id) ? " is-selected" : ""}`} key={pr.id}>
              <input type="checkbox" checked={selected.has(pr.id)} onChange={() => onToggle(pr.id)} aria-label={`Select ${pr.owner}/${pr.repo}#${pr.number}`} />
              <PrRow pr={pr} onChanged={onChanged} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty"><strong>No pull requests.</strong></div>
      )}
    </section>
  );
}

export default function PullRequests() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<PrsResponse>(EMPTY);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [ignoredText, setIgnoredText] = useState("");
  const query = params.get("q") ?? "";
  const stateFilter = params.get("state") ?? "";
  const checksFilter = params.get("checks") ?? "";
  const dirFilter = params.get("dir") ?? "";
  const sort = (params.get("sort") as PrSort | null) ?? "updated";

  const load = () => {
    getPrs()
      .then(result => { setData(result); setOffline(false); })
      .catch(() => setOffline(true));
  };
  useEffect(load, []);

  const refresh = () => {
    setRefreshing(true);
    setRefreshError(null);
    refreshPrs()
      .then(result => { setData(result); setOffline(false); })
      .catch(error => setRefreshError(error instanceof PortfolioApiError ? error.message : "Refresh failed."))
      .finally(() => setRefreshing(false));
  };

  const filterList = (prs: Pr[]) => prs.filter(pr => matchesPr(pr, query, stateFilter, checksFilter, dirFilter)).sort(comparePrs(sort));
  const lists = useMemo(() => ({
    mine: filterList(data.mine),
    review_requested: filterList(data.review_requested),
    watched: filterList(data.watched),
  }), [checksFilter, data.mine, data.review_requested, data.watched, dirFilter, query, sort, stateFilter]);
  // Every directory that any loaded PR came from, so the filter only offers real choices.
  const dirs = useMemo(() => Array.from(new Set([...data.mine, ...data.review_requested, ...data.watched].map(dirKey))).sort(), [data.mine, data.review_requested, data.watched]);

  const visiblePrs = useMemo(() => Array.from(new Map([...lists.mine, ...lists.review_requested, ...lists.watched].map(pr => [pr.id, pr])).values()), [lists.mine, lists.review_requested, lists.watched]);
  const selection = useSelection(visiblePrs.map(pr => pr.id));
  const selectedPrs = visiblePrs.filter(pr => selection.selected.has(pr.id));

  const runBulk = (label: string, action: (pr: Pr) => Promise<unknown>) => {
    if (!selectedPrs.length) return;
    setBulkBusy(true);
    setBulkMessage(null);
    Promise.allSettled(selectedPrs.map(action))
      .then(results => {
        const failed = results.filter(result => result.status === "rejected");
        const succeeded = results.length - failed.length;
        setBulkMessage(failed.length ? `${label}: ${succeeded} succeeded, ${failed.length} failed (${failed.map(result => result.status === "rejected" ? errorMessage(result.reason) : "").filter(Boolean).slice(0, 2).join("; ")}).` : `${label}: updated ${succeeded} pull request${succeeded === 1 ? "" : "s"}.`);
        selection.clear();
        load();
      })
      .finally(() => setBulkBusy(false));
  };

  const ignoredChecks = ignoredText.split("\n").map(line => line.trim()).filter(Boolean);
  const status = data.status;

  return (
    <div>
      <div className="page-header">
        <h1>Pull requests</h1>
        <div className="page-actions">
          <button type="button" className="primary" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>

      {offline ? (
        <p className="pr-status pr-status-error">Couldn't reach the API. Make sure the desktop sidecar is running.</p>
      ) : !status.gh_ok ? (
        <p className="pr-status pr-status-error">
          gh not authenticated. Run <code>gh auth login</code> in a terminal, then hit Refresh.
        </p>
      ) : (
        <p className="pr-status">
          {status.login ? `Signed in as ${status.login} · ` : ""}
          Last poll {formatTime(status.last_poll_at)} · Next {formatTime(status.next_poll_at)}
          {status.rate ? ` · Rate remaining ${status.rate.remaining}` : ""}
          {status.error ? ` · ${status.error}` : ""}
        </p>
      )}
      {refreshError ? <p className="pr-status pr-status-error">{refreshError}</p> : null}

      <CollectionToolbar
        query={query}
        onQueryChange={value => setParams(setParam(params, "q", value))}
        sort={sort}
        onSortChange={value => setParams(setParam(params, "sort", value))}
        sortOptions={SORT_OPTIONS}
      >
        <label>State
          <select value={stateFilter} onChange={event => setParams(setParam(params, "state", event.target.value))}>
            <option value="">Any state</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="merged">Merged</option>
          </select>
        </label>
        <label>Checks
          <select value={checksFilter} onChange={event => setParams(setParam(params, "checks", event.target.value))}>
            <option value="">Any checks</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="pending">Pending</option>
            <option value="none">None</option>
          </select>
        </label>
        {dirs.length > 1 || dirFilter ? (
          <label>Directory
            <select value={dirFilter} onChange={event => setParams(setParam(params, "dir", event.target.value))}>
              <option value="">Any directory</option>
              {dirs.map(dir => <option key={dir} value={dir}>{dir === DEFAULT_DIR ? "API directory" : dirLabel(dir)}</option>)}
            </select>
          </label>
        ) : null}
      </CollectionToolbar>

      <SelectionBar
        count={selection.selected.size}
        total={visiblePrs.length}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clear}
        busy={bulkBusy}
      >
        <button type="button" className="secondary" onClick={() => runBulk("Watch", pr => watchPr(pr.url, true))} disabled={!selection.selected.size || bulkBusy}>Watch</button>
        <button type="button" className="secondary" onClick={() => runBulk("Unwatch", pr => watchPr(pr.url, false))} disabled={!selection.selected.size || bulkBusy}>Unwatch</button>
        <label className="bulk-inline-field">Ignored checks
          <textarea value={ignoredText} onChange={event => setIgnoredText(event.target.value)} rows={2} placeholder="one glob per line" />
        </label>
        <button type="button" className="secondary" onClick={() => runBulk("Ignored checks", pr => patchPr(pr.id, { ignored_checks: ignoredChecks }))} disabled={!selection.selected.size || bulkBusy}>Apply ignored checks</button>
      </SelectionBar>
      {bulkMessage ? <p className={bulkMessage.includes("failed") ? "operational-error" : "operational-status"}>{bulkMessage}</p> : null}

      <div className="portfolio-grid">
        <PrListCard title="Mine" prs={lists.mine} total={data.mine.length} selected={selection.selected} onToggle={selection.toggle} onChanged={load} />
        <PrListCard title="Review requested" prs={lists.review_requested} total={data.review_requested.length} selected={selection.selected} onToggle={selection.toggle} onChanged={load} />
        <PrListCard title="Watched" prs={lists.watched} total={data.watched.length} selected={selection.selected} onToggle={selection.toggle} onChanged={load} />
      </div>
    </div>
  );
}
