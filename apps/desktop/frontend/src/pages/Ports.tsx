import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { PortEntryWithProject } from "../types.ts";
import { getPorts, killPort } from "../api.ts";
import { openInApp } from "../native.ts";
import { CollectionToolbar, SelectionBar, useSelection } from "../components/CollectionTools.tsx";
import "../operational.css";

type PortSort = "port" | "process" | "project";

const SORT_OPTIONS = [
  { value: "port", label: "Port" },
  { value: "process", label: "Process" },
  { value: "project", label: "Project" },
] as const;

const rowId = (entry: PortEntryWithProject): number => {
  const key = `${entry.pid}:${entry.host}:${entry.port ?? ""}:${entry.command}:${entry.cwd}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash;
};
const lower = (value: string | number | null | undefined): string => String(value ?? "").toLowerCase();
const projectLabel = (entry: PortEntryWithProject): string => entry.project?.title ?? "No project";

function setParam(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export default function Ports() {
  const [params, setParams] = useSearchParams();
  const [ports, setPorts] = useState<PortEntryWithProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = params.get("q") ?? "";
  const sort = (params.get("sort") as PortSort | null) ?? "port";
  const projectFilter = params.get("project") ?? "";
  const processFilter = params.get("process") ?? "";

  const load = () => getPorts()
    .then(snapshot => { setPorts(snapshot.ports); setError(snapshot.error ?? null); })
    .catch(() => setError("Couldn't reach the API. Make sure the desktop sidecar is running."));

  // Auto-refresh every 15s only while this page is mounted; never touches anything else.
  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, []);

  const projects = useMemo(() => Array.from(new Set(ports.map(projectLabel))).sort(), [ports]);
  const processes = useMemo(() => Array.from(new Set(ports.map(entry => entry.command))).sort(), [ports]);

  const visiblePorts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ports
      .filter(entry => !projectFilter || projectLabel(entry) === projectFilter)
      .filter(entry => !processFilter || entry.command === processFilter)
      .filter(entry => !needle || [entry.port, entry.command, entry.pid, entry.cwd, entry.project?.title].some(value => lower(value).includes(needle)))
      .sort((a, b) => {
        if (sort === "process") return a.command.localeCompare(b.command) || a.pid - b.pid || (a.port ?? 0) - (b.port ?? 0);
        if (sort === "project") return projectLabel(a).localeCompare(projectLabel(b)) || (a.port ?? 0) - (b.port ?? 0);
        return (a.port ?? 0) - (b.port ?? 0) || a.pid - b.pid;
      });
  }, [ports, processFilter, projectFilter, query, sort]);

  const selection = useSelection(visiblePorts.map(rowId));
  const selectedPorts = visiblePorts.filter(entry => selection.selected.has(rowId(entry)));
  const selectedPids = Array.from(new Map(selectedPorts.map(entry => [entry.pid, entry])).values());

  const kill = (entry: PortEntryWithProject) => {
    if (!window.confirm(`Send TERM to ${entry.command} (${entry.pid}) on port ${entry.port ?? "—"}? This can stop a live process.`)) return;
    setBusy(true);
    killPort(entry.pid)
      .then(load)
      .catch(() => setError(`Failed to TERM ${entry.command} (${entry.pid}).`))
      .finally(() => setBusy(false));
  };

  const termSelected = () => {
    if (!selectedPids.length) return;
    const names = selectedPids.slice(0, 8).map(entry => `${entry.command} (${entry.pid})`).join(", ");
    const extra = selectedPids.length > 8 ? ` and ${selectedPids.length - 8} more` : "";
    if (!window.confirm(`Send TERM to ${selectedPids.length} selected unique PID${selectedPids.length === 1 ? "" : "s"}: ${names}${extra}?\n\nThis can stop live dev servers. Only visible selected rows are included.`)) return;
    setBusy(true);
    setError(null);
    Promise.allSettled(selectedPids.map(entry => killPort(entry.pid)))
      .then(results => {
        const failed = results.filter(result => result.status === "rejected").length;
        if (failed) setError(`TERM failed for ${failed} of ${selectedPids.length} PID${selectedPids.length === 1 ? "" : "s"}.`);
        selection.clear();
        return load();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <div className="page-header"><h1>Ports</h1></div>
      <CollectionToolbar
        query={query}
        onQueryChange={value => setParams(setParam(params, "q", value))}
        sort={sort}
        onSortChange={value => setParams(setParam(params, "sort", value))}
        sortOptions={SORT_OPTIONS}
      >
        <label>Project
          <select value={projectFilter} onChange={event => setParams(setParam(params, "project", event.target.value))}>
            <option value="">All projects</option>
            {projects.map(project => <option key={project} value={project}>{project}</option>)}
          </select>
        </label>
        <label>Process
          <select value={processFilter} onChange={event => setParams(setParam(params, "process", event.target.value))}>
            <option value="">All processes</option>
            {processes.map(process => <option key={process} value={process}>{process}</option>)}
          </select>
        </label>
      </CollectionToolbar>

      <SelectionBar
        count={selection.selected.size}
        total={visiblePorts.length}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clear}
        busy={busy}
      >
        <button type="button" className="danger" onClick={termSelected} disabled={!selection.selected.size || busy}>TERM selected PIDs</button>
      </SelectionBar>

      {error ? <p className="operational-error">{error}</p> : null}
      <table className="data-table">
        <thead><tr><th><span className="sr-only">Select</span></th><th>Port</th><th>Process</th><th>Cwd</th><th>Project</th><th>Uptime</th><th></th></tr></thead>
        <tbody>
          {visiblePorts.map(entry => {
            const id = rowId(entry);
            return (
              <tr key={`${entry.pid}-${entry.port}`} className={selection.selected.has(id) ? "is-selected" : ""}>
                <td><input type="checkbox" checked={selection.selected.has(id)} onChange={() => selection.toggle(id)} aria-label={`Select ${entry.command} on port ${entry.port ?? "unknown"}`} /></td>
                <td>{entry.port}</td>
                <td>{entry.command} ({entry.pid})</td>
                <td data-path={entry.cwd} data-kind="dir"><code>{entry.cwd}</code></td>
                <td>{entry.project ? <Link to={`/projects/${entry.project.id}`}>{entry.project.title}</Link> : "—"}</td>
                <td>{entry.elapsed ?? "—"}</td>
                <td className="page-actions">
                  <button type="button" className="secondary" onClick={() => void openInApp(`http://${entry.host || "127.0.0.1"}:${entry.port}`)}>Open</button>
                  <button type="button" className="danger" onClick={() => kill(entry)} disabled={busy}>Kill</button>
                </td>
              </tr>
            );
          })}
          {!visiblePorts.length ? <tr><td colSpan={7} className="empty-table-cell">No ports match the current filters.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
