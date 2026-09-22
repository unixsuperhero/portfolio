import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ProjectParentSummary, ProjectView } from "../types.ts";
import { addProjectParent, listProjectParents, listProjects, removeProjectParent, scanProjects } from "../api.ts";
import { PathField } from "../components/PathField.tsx";

type SortKey = "name" | "updated" | "ports" | "scripts";

/** ProjectView doesn't carry updated_at in the current contract; read it defensively so sorting
 * degrades gracefully (falls back to 0, keeping relative order) instead of breaking if it's missing. */
const updatedAtMs = (project: ProjectView): number => {
  const value = (project as unknown as { updated_at?: string }).updated_at;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function Projects() {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [parents, setParents] = useState<ProjectParentSummary[]>([]);
  const [newParent, setNewParent] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const sort = (params.get("sort") ?? "name") as SortKey;
  const runner = params.get("runner") ?? "";
  const runningOnly = params.get("running") === "1";
  const tag = params.get("tag") ?? "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const load = () => {
    listProjects().then(({ projects }) => setProjects(projects)).catch(() => {});
    listProjectParents().then(({ parents }) => setParents(parents)).catch(() => {});
  };
  useEffect(load, []);

  const scan = () => scanProjects().then(({ added }) => { setScanResult(`${added.length} added`); load(); }).catch(() => {});
  const addParent = (event: React.FormEvent) => { event.preventDefault(); if (!newParent.trim()) return; addProjectParent(newParent.trim()).then(() => { setNewParent(""); load(); }).catch(() => {}); };

  const allTags = useMemo(() => Array.from(new Set(projects.flatMap(p => p.tags ?? []))).sort(), [projects]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = projects.filter(project => {
      if (needle) {
        const haystack = [project.title, project.path, ...(project.tags ?? []), ...Object.keys(project.services.scripts ?? {})]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (runner && (project.services.runner ?? "none") !== runner) return false;
      if (runningOnly && project.ports.length === 0) return false;
      if (tag && !(project.tags ?? []).includes(tag)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "updated": return updatedAtMs(b) - updatedAtMs(a);
        case "ports": return b.ports.length - a.ports.length;
        case "scripts": return Object.keys(b.services.scripts ?? {}).length - Object.keys(a.services.scripts ?? {}).length;
        default: return a.title.localeCompare(b.title);
      }
    });
    return list;
  }, [projects, q, sort, runner, runningOnly, tag]);

  return (
    <div>
      <div className="page-header">
        <h1>Projects</h1>
        <div className="page-actions">
          <button type="button" className="primary" onClick={scan}>Scan</button>
        </div>
      </div>
      {scanResult ? <p style={{ color: "var(--text2)" }}>{scanResult}</p> : null}

      <div className="field-row">
        <label>Search<input value={q} onChange={event => setParam("q", event.target.value)} placeholder="title, path, tag, script…" /></label>
        <label>Sort
          <select value={sort} onChange={event => setParam("sort", event.target.value)}>
            <option value="name">Name</option>
            <option value="updated">Recently updated</option>
            <option value="ports">Running ports</option>
            <option value="scripts">Script count</option>
          </select>
        </label>
        <label>Runner
          <select value={runner} onChange={event => setParam("runner", event.target.value)}>
            <option value="">Any</option>
            {["bun", "pnpm", "yarn", "npm", "none"].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>Tag
          <select value={tag} onChange={event => setParam("tag", event.target.value)}>
            <option value="">Any</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={runningOnly} onChange={event => setParam("running", event.target.checked ? "1" : "")} /> Has running ports</label>
      </div>
      <p style={{ color: "var(--text3)", fontSize: "0.82rem", marginTop: "-0.4rem" }}>{visible.length} of {projects.length} projects</p>

      <div className="tiles-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", marginBottom: "1.5rem" }}>
        {visible.map(project => (
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
