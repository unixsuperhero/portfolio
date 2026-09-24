import { useSearchParams } from "react-router";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import type { Pr } from "../types.ts";
import { CHECK_LABELS } from "../lib/pr-collection.ts";
import { PrStatus, PrStatusIcon } from "./PrStatus.tsx";

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
  const selection = useSelection(visible.map(item => item.key));
  if (!pr.checks.length) return <PrStatus kind="none" label="No checks" />;
  const active = pr.checks.filter(check => !check.ignored).length;
  const summary = pr.checks_summary === "none" ? active ? "No pass/fail result" : "All checks ignored" : `Checks ${CHECK_LABELS[pr.checks_summary].toLowerCase()}`;

  return <details className="pr-checks">
    <summary className={`pr-badge pr-tone-${pr.checks_summary}`}><PrStatusIcon kind={pr.checks_summary} />{summary}<span className="pr-check-count">{active}/{pr.checks.length}</span></summary>
    <div className="pr-checks-panel">
      <p className="pr-ignore-hint">{active} active of {pr.checks.length} checks. Ignored checks do not affect the summary.</p>
      <CollectionToolbar query={query} onQueryChange={value => update("q", value)} sort={sort} onSortChange={value => update("sort", value)} sortOptions={[
        { value: "name", label: "Name" }, { value: "status", label: "Status" }, { value: "url", label: "URL" }, { value: "ignored", label: "Ignored" },
      ]}>
        <label>Status<select value={status} onChange={event => update("status", event.target.value)}><option value="">Any status</option>{Object.entries(CHECK_LABELS).filter(([value]) => value !== "none").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Ignored<select value={ignored} onChange={event => update("ignored", event.target.value)}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></label>
      </CollectionToolbar>
      <SelectionBar count={selection.selected.size} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} />
      <ul className="pr-checks-list">
        {visible.map(({ check, key }) => <li key={key}>
          <input type="checkbox" aria-label={`Select check ${check.name}`} checked={selection.selected.has(key)} onChange={() => selection.toggle(key)} />
          <PrStatus kind={check.status} label={CHECK_LABELS[check.status]} />
          {check.url ? <a href={check.url} data-url={check.url}>{check.name}</a> : <span>{check.name}</span>}
          {check.ignored ? <PrStatus kind="ignored" label="Ignored" /> : null}
        </li>)}
      </ul>
      {!visible.length ? <p className="pr-ignore-hint">No checks match these filters.</p> : null}
    </div>
  </details>;
}
