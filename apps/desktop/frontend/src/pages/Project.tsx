import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { ProjectView } from "../types.ts";
import { getProject } from "../api.ts";
import { ServicesCard } from "../cards/ServicesCard.tsx";
import { PortsCard } from "../cards/PortsCard.tsx";
import { copyText, openPath, reveal } from "../native.ts";
import { openTerminal } from "../terminal/store.ts";

export default function Project() {
  const { id } = useParams();
  const [project, setProject] = useState<ProjectView | null>(null);

  useEffect(() => { if (id) getProject(Number(id)).then(setProject).catch(() => setProject(null)); }, [id]);

  if (!project) return <p>Loading…</p>;
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
      <h2>Services</h2>
      <ServicesCard projectId={project.id} />
      <h2>Ports</h2>
      <PortsCard projectId={project.id} />
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
    </div>
  );
}
