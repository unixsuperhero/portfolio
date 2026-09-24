import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import type { PortEntryWithProject, ProjectView } from "../types.ts";
import { getPorts, getProject, killPort } from "../api.ts";
import { CollectionToolbar, SelectionBar, useSelection } from "../components/CollectionTools.tsx";
import { useConfirm } from "../components/ConfirmDialog.tsx";
import { copyText, openInApp, openPath, reveal } from "../native.ts";
import { openTerminal } from "../terminal/store.ts";

type ServiceSort = "name" | "command";
type PortSort = "port" | "command" | "pid";

export default function Project() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [ports, setPorts] = useState<PortEntryWithProject[] | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog } = useConfirm();

  const serviceQuery = params.get("service_q") ?? "";
  const serviceSort = (params.get("service_sort") ?? "name") as ServiceSort;
  const portQuery = params.get("port_q") ?? "";
  const portSort = (params.get("port_sort") ?? "port") as PortSort;
  const host = params.get("host") ?? "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const loadProject = () => { if (id) getProject(Number(id)).then(setProject).catch(error => { setProject(null); setError((error as Error).message); }); };
  useEffect(loadProject, [id]);

  const loadPorts = () => {
    getPorts()
      .then(snapshot => setPorts(id ? snapshot.ports.filter(entry => entry.project?.id === Number(id)) : snapshot.ports))
      .catch(error => { setPorts([]); setError((error as Error).message); });
  };
  useEffect(() => { loadPorts(); const timer = setInterval(loadPorts, 15_000); return () => clearInterval(timer); }, [id]);

  const services = useMemo(() => {
    const needle = serviceQuery.trim().toLowerCase();
    return Object.entries(project?.services.scripts ?? {})
      .filter(([name, command]) => !needle || `${name} ${command}`.toLowerCase().includes(needle))
      .sort(([aName, aCommand], [bName, bCommand]) => (serviceSort === "command" ? aCommand.localeCompare(bCommand) : aName.localeCompare(bName)));
  }, [project, serviceQuery, serviceSort]);

  const portHosts = useMemo(() => Array.from(new Set((ports ?? []).map(port => port.host || "127.0.0.1"))).sort(), [ports]);
  const visiblePorts = useMemo(() => {
    const needle = portQuery.trim().toLowerCase();
    return [...(ports ?? [])]
      .filter(port => {
        if (needle) {
          const haystack = [port.port, port.host, port.command, port.pid, port.cwd].join(" ").toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        if (host && (port.host || "127.0.0.1") !== host) return false;
        return true;
      })
      .sort((a, b) => {
        switch (portSort) {
          case "command": return a.command.localeCompare(b.command);
          case "pid": return a.pid - b.pid;
          default: return (a.port ?? 0) - (b.port ?? 0);
        }
      });
  }, [ports, portQuery, host, portSort]);

  const visiblePids = Array.from(new Set(visiblePorts.map(port => port.pid)));
  const portSelection = useSelection(visiblePids);
  const selectedPids = Array.from(portSelection.selected);

  const run = (name: string, command: string) => {
    if (!project) return;
    const extra = args[name] ?? "";
    openTerminal({ cwd: project.path, command: extra ? `${command} ${extra}` : command, title: `${project.title}: ${name}` });
  };

  const killSelected = async () => {
    if (!selectedPids.length) return;
    if (!(await confirm({ title: `Kill ${selectedPids.length} process${selectedPids.length === 1 ? "" : "es"}?`, confirmLabel: "Kill" }))) return;
    setBusy(true);
    setError("");
    Promise.allSettled(selectedPids.map(pid => killPort(pid)))
      .then(results => {
        const failed = results.filter(result => result.status === "rejected").length;
        if (failed) setError(`${failed} process${failed === 1 ? "" : "es"} failed to stop.`);
        portSelection.clear();
        loadPorts();
      })
      .finally(() => setBusy(false));
  };

  if (!project) return <p>{error || "Loading…"}</p>;
  return (
    <div>
      <div className="page-header"><h1>{project.title}</h1></div>
      <p data-path={project.path} data-kind="dir" data-item={project.id}><code>{project.path}</code></p>
      <div className="page-actions" style={{ marginBottom: "1rem" }}>
        <button type="button" className="secondary" onClick={() => void copyText(project.path)}>Copy path</button>
        <button type="button" className="secondary" onClick={() => void reveal(project.path)}>Reveal</button>
        <button type="button" className="secondary" onClick={() => void openPath(project.path)}>Open</button>
        <button type="button" className="secondary" onClick={() => openTerminal({ cwd: project.path, title: project.title })}>Open terminal here</button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <h2>Services</h2>
      <CollectionToolbar
        query={serviceQuery}
        onQueryChange={value => setParam("service_q", value)}
        sort={serviceSort}
        onSortChange={value => setParam("service_sort", value)}
        sortOptions={[
          { value: "name", label: "Name" },
          { value: "command", label: "Command" },
        ]}
      />
      {!Object.keys(project.services.scripts ?? {}).length ? <div className="empty"><strong>No scripts.</strong></div> : null}
      {Object.keys(project.services.scripts ?? {}).length && !services.length ? <div className="empty"><strong>No matching scripts.</strong></div> : null}
      {services.length ? (
        <table className="data-table">
          <thead><tr><th>Name</th><th>Command</th><th>Args</th><th></th></tr></thead>
          <tbody>
            {services.map(([name, command]) => (
              <tr key={name}>
                <td><strong>{name}</strong></td>
                <td><code>{command}</code></td>
                <td><input className="args" placeholder="args" value={args[name] ?? ""} onChange={event => setArgs(current => ({ ...current, [name]: event.target.value }))} /></td>
                <td><button type="button" className="secondary" onClick={() => run(name, command)}>Run</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>Ports</h2>
      <CollectionToolbar
        query={portQuery}
        onQueryChange={value => setParam("port_q", value)}
        sort={portSort}
        onSortChange={value => setParam("port_sort", value)}
        sortOptions={[
          { value: "port", label: "Port" },
          { value: "command", label: "Command" },
          { value: "pid", label: "PID" },
        ]}
      >
        <label>Host
          <select value={host} onChange={event => setParam("host", event.target.value)}>
            <option value="">Any</option>
            {portHosts.map(host => <option key={host} value={host}>{host}</option>)}
          </select>
        </label>
      </CollectionToolbar>
      <SelectionBar count={selectedPids.length} total={visiblePids.length} allSelected={portSelection.allSelected} onToggleAll={portSelection.toggleAll} onClear={portSelection.clear} busy={busy}>
        <button type="button" className="danger" onClick={killSelected} disabled={busy || !selectedPids.length}>Kill selected</button>
      </SelectionBar>
      {ports === null ? <div className="empty"><strong>Loading…</strong></div> : null}
      {ports?.length === 0 ? <div className="empty"><strong>No listeners.</strong></div> : null}
      {ports?.length && !visiblePorts.length ? <div className="empty"><strong>No matching listeners.</strong></div> : null}
      {visiblePorts.length ? (
        <table className="data-table">
          <thead><tr><th>Select</th><th>Port</th><th>Host</th><th>Command</th><th>PID</th><th></th></tr></thead>
          <tbody>
            {visiblePorts.map(port => (
              <tr key={`${port.pid}-${port.port}`}>
                <td><input type="checkbox" checked={portSelection.selected.has(port.pid)} onChange={() => portSelection.toggle(port.pid)} aria-label={`Select process ${port.pid}`} /></td>
                <td>{port.port}</td>
                <td>{port.host || "127.0.0.1"}</td>
                <td>{port.command}</td>
                <td>{port.pid}</td>
                <td>
                  <button type="button" className="secondary" onClick={() => void openInApp(`http://${port.host || "127.0.0.1"}:${port.port}`)}>Open</button>{" "}
                  <button type="button" className="danger" onClick={async () => { if (await confirm({ title: `Kill process ${port.pid}?`, confirmLabel: "Kill" })) killPort(port.pid).then(loadPorts).catch(error => setError((error as Error).message)); }}>Kill</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {project.slots.length ? (
        <>
          <h2>Slots</h2>
          <table className="data-table">
            <thead><tr><th>Slot</th><th>Path</th><th>Exists</th></tr></thead>
            <tbody>
              {project.slots.map(slot => (
                <tr key={slot.name} data-path={slot.path} data-kind={slot.kind} data-item={project.id} data-slot={slot.name}>
                  <td>{slot.name}</td><td><code>{slot.path}</code></td><td>{slot.exists ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {dialog}
    </div>
  );
}
