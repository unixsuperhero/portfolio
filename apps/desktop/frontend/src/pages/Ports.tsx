import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { PortEntryWithProject } from "../types.ts";
import { getPorts, killPort } from "../api.ts";
import { openInApp } from "../native.ts";

export default function Ports() {
  const [ports, setPorts] = useState<PortEntryWithProject[]>([]);

  const load = () => getPorts().then(snapshot => setPorts(snapshot.ports)).catch(() => {});

  // Auto-refresh every 15s only while this page is mounted; never touches anything else.
  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, []);

  const kill = (pid: number) => killPort(pid).then(load).catch(() => {});

  return (
    <div>
      <div className="page-header"><h1>Ports</h1></div>
      <table className="data-table">
        <thead><tr><th>Port</th><th>Process</th><th>Cwd</th><th>Project</th><th>Uptime</th><th></th></tr></thead>
        <tbody>
          {ports.map(entry => (
            <tr key={`${entry.pid}-${entry.port}`}>
              <td>{entry.port}</td>
              <td>{entry.command} ({entry.pid})</td>
              <td data-path={entry.cwd} data-kind="dir"><code>{entry.cwd}</code></td>
              <td>{entry.project ? <Link to={`/projects/${entry.project.id}`}>{entry.project.title}</Link> : "—"}</td>
              <td>{entry.elapsed ?? "—"}</td>
              <td className="page-actions">
                <button type="button" className="secondary" onClick={() => void openInApp(`http://${entry.host || "127.0.0.1"}:${entry.port}`)}>Open</button>
                <button type="button" className="danger" onClick={() => kill(entry.pid)}>Kill</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
