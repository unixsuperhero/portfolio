import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ProjectParentSummary, ProjectView } from "../types.ts";
import { addProjectParent, listProjectParents, listProjects, removeProjectParent, scanProjects } from "../api.ts";
import { PathField } from "../components/PathField.tsx";

export default function Projects() {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [parents, setParents] = useState<ProjectParentSummary[]>([]);
  const [newParent, setNewParent] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);

  const load = () => {
    listProjects().then(({ projects }) => setProjects(projects)).catch(() => {});
    listProjectParents().then(({ parents }) => setParents(parents)).catch(() => {});
  };
  useEffect(load, []);

  const scan = () => scanProjects().then(({ added }) => { setScanResult(`${added.length} added`); load(); }).catch(() => {});
  const addParent = (event: React.FormEvent) => { event.preventDefault(); if (!newParent.trim()) return; addProjectParent(newParent.trim()).then(() => { setNewParent(""); load(); }).catch(() => {}); };

  return (
    <div>
      <div className="page-header">
        <h1>Projects</h1>
        <div className="page-actions">
          <button type="button" className="primary" onClick={scan}>Scan</button>
        </div>
      </div>
      {scanResult ? <p style={{ color: "var(--text2)" }}>{scanResult}</p> : null}

      <div className="tiles-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", marginBottom: "1.5rem" }}>
        {projects.map(project => (
          <Link key={project.id} to={`/projects/${project.id}`} className="tile" style={{ alignItems: "start", textAlign: "left", minHeight: "auto", padding: "0.8rem" }} data-item={project.id} data-path={project.path} data-kind="dir">
            <strong>{project.title}</strong>
            <span style={{ color: "var(--text3)", fontSize: "0.78rem" }}>{project.services.runner ?? "no runner"} · {Object.keys(project.services.scripts).length} scripts · {project.ports.length} ports</span>
          </Link>
        ))}
      </div>

      <h2>Project parents</h2>
      <form className="field-row" onSubmit={addParent}>
        <PathField label="Path" kind="dir" value={newParent} onChange={setNewParent} placeholder="~/proj" />
        <button className="secondary" type="submit">Add</button>
      </form>
      <table className="data-table">
        <thead><tr><th>Path</th><th>Projects</th><th></th></tr></thead>
        <tbody>
          {parents.map(parent => (
            <tr key={parent.id}>
              <td><code>{parent.path}</code></td>
              <td>{parent.count}</td>
              <td><button type="button" className="danger" onClick={() => removeProjectParent(parent.id).then(load)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
