import { useEffect, useState } from "react";
import type { PortEntryWithProject } from "../types.ts";
import { getPorts, killPort } from "../api.ts";
import { openSystem } from "../native.ts";

export function PortsCard({ projectId }: { projectId?: number }) {
  const [ports, setPorts] = useState<PortEntryWithProject[] | null>(null);

  const load = () => {
    getPorts()
      .then(snapshot => setPorts(projectId ? snapshot.ports.filter(entry => entry.project?.id === projectId) : snapshot.ports))
      .catch(() => setPorts([]));
  };

  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, [projectId]);

  const kill = (pid: number) => killPort(pid).then(load).catch(() => {});

  if (ports === null) return <div className="empty"><strong>Loading…</strong></div>;
  if (!ports.length) return <div className="empty"><strong>No listeners.</strong></div>;
  return (
    <div>
      {ports.map(entry => (
        <div className="port-row" key={`${entry.pid}-${entry.port}`}>
          <span>{entry.port}</span>
          <span style={{ color: "var(--text2)" }}>{entry.command}</span>
          <button type="button" className="secondary" onClick={() => void openSystem(`http://${entry.host || "127.0.0.1"}:${entry.port}`)}>Open</button>
          <button type="button" className="danger" onClick={() => kill(entry.pid)}>Kill</button>
        </div>
      ))}
    </div>
  );
}
