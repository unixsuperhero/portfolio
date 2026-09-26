import { useEffect, useState } from "react";
import type { PortEntryWithProject } from "../types.ts";
import { getPorts, killPort } from "../api.ts";
import { openSystem } from "../native.ts";
const EMPTY_SCOPE_ITEM_IDS: number[] = [];


export function PortsCard({ projectId, scopeActive = false, scopeItemIds = EMPTY_SCOPE_ITEM_IDS }: { projectId?: number; scopeActive?: boolean; scopeItemIds?: number[] }) {
  const [snapshotPorts, setSnapshotPorts] = useState<PortEntryWithProject[] | null>(null);

  const load = () => {
    getPorts()
      .then(snapshot => setSnapshotPorts(snapshot.ports))
      .catch(() => setSnapshotPorts([]));
  };

  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, []);
  const ports = snapshotPorts?.filter(entry =>
    (!projectId || entry.project?.id === projectId)
    && (!scopeActive || (entry.project !== null && scopeItemIds.includes(entry.project.id)))) ?? null;

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
