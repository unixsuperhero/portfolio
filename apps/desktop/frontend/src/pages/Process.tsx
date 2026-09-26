import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { portSiteUrl } from "@portfolio/ports/url";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import { getPorts } from "../api.ts";
import type { PortsSnapshot } from "../types.ts";
import { processTree } from "../lib/process-tree.ts";
import "../operational.css";

const sorts = [
  { value: "tree", label: "Process tree" },
  { value: "pid", label: "PID" },
  { value: "command", label: "Command" },
  { value: "cwd", label: "Working directory" },
  { value: "elapsed", label: "Uptime" },
  { value: "relation", label: "Relationship" },
];

export default function Process() {
  const { pid: routePid } = useParams();
  const pid = Number(routePid);
  const [params, setParams] = useSearchParams();
  const [snapshot, setSnapshot] = useState<PortsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getPorts().then(value => {
      if (active) { setSnapshot(value); setError(value.error ?? ""); }
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : "Could not load processes.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pid, refresh]);
  const rows = useMemo(() => processTree(snapshot?.ports ?? [], pid), [snapshot, pid]);
  const selected = rows.find(row => row.pid === pid);
  const query = params.get("q") ?? "";
  const sort = params.get("sort") ?? "tree";
  const relation = params.get("relation") ?? "";
  const cwd = params.get("cwd") ?? "";
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { flushSync: true });
  };
  const visible = rows.filter(row => (!relation || row.relation === relation) && (!cwd || row.cwd === cwd)
    && [row.pid, row.ppid, row.command, row.cwd, row.relation, row.elapsed, ...(row.ports ?? []).map(port => port.port)]
      .some(value => String(value ?? "").toLowerCase().includes(query.trim().toLowerCase())));
  if (sort !== "tree") visible.sort((a, b) => {
    if (sort === "pid") return a.pid - b.pid;
    if (sort === "elapsed") return (b.elapsed_secs ?? -1) - (a.elapsed_secs ?? -1);
    if (sort === "cwd") return a.cwd.localeCompare(b.cwd) || a.pid - b.pid;
    if (sort === "relation") return a.relation.localeCompare(b.relation) || a.pid - b.pid;
    return a.command.localeCompare(b.command) || a.pid - b.pid;
  });
  const selection = useSelection(visible.map(row => row.pid));
  return <div>
    <div className="page-header">
      <h1>Process {routePid}</h1>
      <div className="page-actions"><Link to="/ports">Ports</Link><button type="button" className="secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    </div>
    {error ? <p role="alert" className="operational-error">{error}</p> : null}
    {loading ? <p role="status">Loading process snapshot…</p> : null}
    {!loading && !selected ? <p>This process is no longer in the ports snapshot, or is not related to a current listener.</p> : null}
    {selected ? <>
      <p><strong>Command:</strong> <code>{selected.command || "Unavailable"}</code></p>
      <p><strong>Working directory:</strong> <span data-path={selected.cwd || undefined} data-kind="dir">{selected.cwd || "Unavailable"}</span></p>
      <p><strong>Parent PID:</strong> {selected.ppid ?? "Unavailable"} · <strong>Uptime:</strong> {selected.elapsed ?? "Unavailable"}</p>
      <h2>Process tree</h2>
      <p className="operational-status">Ancestors and descendants captured by the ports scanner. Non-listening processes beyond the scanner’s captured children may be absent. Snapshot: {snapshot?.scanned_at}. Refresh to update; no background refresh changes this view.</p>
      <CollectionToolbar query={query} onQueryChange={value => setParam("q", value)} sort={sort} onSortChange={value => setParam("sort", value)} sortOptions={sorts}>
        <label>Relationship<select value={relation} onChange={event => setParam("relation", event.target.value)}><option value="">All relationships</option>{["Ancestor", "Selected", "Descendant"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Working directory<select value={cwd} onChange={event => setParam("cwd", event.target.value)}><option value="">All directories</option>{[...new Set(rows.map(row => row.cwd).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      </CollectionToolbar>
      <SelectionBar count={selection.selected.size} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} />
      <div className="process-table-scroll"><table className="data-table">
        <thead><tr><th><span className="sr-only">Select</span></th><th>Process / PID</th><th>Parent PID</th><th>Relationship</th><th>Working directory</th><th>Uptime</th><th>Ports</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.pid} className={selection.selected.has(row.pid) ? "is-selected" : ""}>
          <td><input type="checkbox" aria-label={`Select process ${row.pid}`} checked={selection.selected.has(row.pid)} onChange={() => selection.toggle(row.pid)} /></td>
          <td><div style={{ paddingLeft: sort === "tree" ? `${row.depth}rem` : 0 }}><Link to={`/processes/${row.pid}`} aria-current={row.pid === pid ? "page" : undefined}>{row.command || "Unknown"} ({row.pid})</Link></div></td>
          <td>{row.ppid === undefined ? "—" : rows.some(node => node.pid === row.ppid) ? <Link to={`/processes/${row.ppid}`}>{row.ppid}</Link> : row.ppid}</td>
          <td>{row.relation}</td><td data-path={row.cwd || undefined} data-kind="dir"><code>{row.cwd || "—"}</code></td><td>{row.elapsed ?? "—"}</td>
          <td>{row.ports?.map(port => <a className="process-port" key={`${port.host}:${port.port}`} href={portSiteUrl(port)} title="Open in system browser">{port.port}</a>)}</td>
        </tr>)}{!visible.length ? <tr><td colSpan={7} className="empty-table-cell">No processes match the current filters.</td></tr> : null}</tbody>
      </table></div>
    </> : null}
  </div>;
}
