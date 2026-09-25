import { useSearchParams } from "react-router";
import { CollectionToolbar } from "@portfolio/ui/collections";
import type { Pr } from "../types.ts";
import { CHECK_LABELS } from "../lib/pr-collection.ts";
import { PrStatus, PrStatusIcon } from "./PrStatus.tsx";

export function checkStats(checks: Pr["checks"]) {
  const isFailure = (status: Pr["checks"][number]["status"]) => status === "failure" || status === "cancelled";
  return {
    complete: checks.filter(check => check.status !== "pending").length,
    passing: checks.filter(check => check.status === "success").length,
    failing: checks.filter(check => isFailure(check.status)).length,
    running: checks.filter(check => check.status === "pending").length,
    total: checks.length,
    ignoredFailures: checks.filter(check => check.ignored && isFailure(check.status)).length,
    active: checks.filter(check => !check.ignored).length,
  };
}

export function PrCheckStats({ checks }: { checks: Pr["checks"] }) {
  if (!checks.length) return null;
  const stats = checkStats(checks);
  return <div className="pr-row-check-stats" aria-label={`${stats.complete} complete, ${stats.passing} passing, ${stats.failing} failing, ${stats.running} running, ${stats.total} total${stats.ignoredFailures ? `, ${stats.ignoredFailures} ignored failures` : ""}`}>
    <span className="pr-tone-none"><PrStatusIcon kind="none" />{stats.complete} complete</span>
    <span className="pr-tone-success"><PrStatusIcon kind="success" />{stats.passing} passing</span>
    <span className="pr-tone-failure"><PrStatusIcon kind="failure" />{stats.failing} failing</span>
    <span className="pr-tone-pending"><PrStatusIcon kind="pending" />{stats.running} running</span>
    <span className="pr-tone-none">{stats.total} total</span>
    {stats.ignoredFailures ? <span className="pr-tone-ignored pr-check-ignored-failures"><PrStatusIcon kind="ignored" />{stats.ignoredFailures} ignored failure{stats.ignoredFailures === 1 ? "" : "s"}</span> : null}
  </div>;
}

export function PrChecks({ pr }: { pr: Pr }) {
  const [params, setParams] = useSearchParams();
  const prefix = `pr${pr.id}_check_`;
  const query = params.get(`${prefix}q`) ?? "";
  const sort = params.get(`${prefix}sort`) ?? "name";
  const status = params.get(`${prefix}status`) ?? "";
  const ignored = params.get(`${prefix}ignored`) ?? "";
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(prefix + key, value); else next.delete(prefix + key);
    setParams(next, { replace: true, flushSync: true });
  };
  const visible = pr.checks.map((check, index) => ({ check, key: `${index}:${check.name}` })).filter(({ check }) =>
    (!status || check.status === status) && (!ignored || String(check.ignored) === ignored)
    && [check.name, check.url, CHECK_LABELS[check.status], check.ignored ? "ignored" : "active"].join(" ").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => String(sort === "status" ? a.check.status : sort === "url" ? a.check.url : sort === "ignored" ? a.check.ignored : a.check.name)
      .localeCompare(String(sort === "status" ? b.check.status : sort === "url" ? b.check.url : sort === "ignored" ? b.check.ignored : b.check.name)));
  if (!pr.checks.length) return <PrStatus kind="none" label="No checks" />;
  const stats = checkStats(pr.checks);
  const summary = pr.checks_summary === "none" ? stats.active ? "No pass/fail result" : "All checks ignored" : `Checks ${CHECK_LABELS[pr.checks_summary].toLowerCase()}`;

  return <details className="pr-checks">
    <summary className={`pr-badge pr-tone-${pr.checks_summary}`}><PrStatusIcon kind={pr.checks_summary} />{summary}</summary>
    <div className="pr-checks-panel">
      <p className="pr-ignore-hint">{stats.active} effective of {stats.total} checks. Ignored failures remain listed and counted, but do not affect the summary.</p>
      <CollectionToolbar query={query} onQueryChange={value => update("q", value)} sort={sort} onSortChange={value => update("sort", value)} sortOptions={[
        { value: "name", label: "Name" }, { value: "status", label: "Status" }, { value: "url", label: "URL" }, { value: "ignored", label: "Ignored" },
      ]}>
        <label>Status<select value={status} onChange={event => update("status", event.target.value)}><option value="">Any status</option>{Object.entries(CHECK_LABELS).filter(([value]) => value !== "none").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Ignored<select value={ignored} onChange={event => update("ignored", event.target.value)}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></label>
      </CollectionToolbar>
      <ul className="pr-checks-list">
        {visible.map(({ check, key }) => <li key={key}>
          <PrStatus kind={check.status} label={CHECK_LABELS[check.status]} />
          {check.url ? <a href={check.url} data-url={check.url}>{check.name}</a> : <span>{check.name}</span>}
          {check.ignored ? <PrStatus kind="ignored" label="Ignored" /> : null}
        </li>)}
      </ul>
      {!visible.length ? <p className="pr-ignore-hint">No checks match these filters.</p> : null}
    </div>
  </details>;
}
