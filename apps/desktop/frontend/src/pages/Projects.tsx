import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { ProjectParentSummary, ProjectView } from "../types.ts";
import { addProjectParent, listProjectParents, listProjects, removeProjectParent, scanProjects } from "../api.ts";
import { PathField } from "../components/PathField.tsx";
import { CollectionToolbar, ItemBulkActions, SelectionBar, useSelection } from "../components/CollectionTools.tsx";
import { useConfirm } from "../components/ConfirmDialog.tsx";

type SortKey = "title" | "path" | "updated" | "ports" | "scripts";

const updatedAtMs = (project: ProjectView): number => {
  const parsed = Date.parse(project.updated_at);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function Projects() {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [parents, setParents] = useState<ProjectParentSummary[]>([]);
  const [newParent, setNewParent] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  const { confirm, dialog } = useConfirm();

  const query = params.get("q") ?? "";
  const sort = (params.get("sort") ?? "title") as SortKey;
  const runner = params.get("runner") ?? "";
  const runningOnly = params.get("running") === "1";
  const tag = params.get("tag") ?? "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const load = () => {
    setLoading(true);
    return Promise.all([
      listProjects().then(({ projects }) => setProjects(projects)),
      listProjectParents().then(({ parents }) => setParents(parents)),
    ]).catch(error => setError((error as Error).message)).finally(() => setLoading(false));
  };
  useEffect(() => { void load(); }, []);

  const scan = () => {
    setBusy(true);
    setError("");
    scanProjects()
      .then(({ added }) => { setScanResult(`${added.length} added`); load(); })
      .catch(error => setError((error as Error).message))
      .finally(() => setBusy(false));
  };
  const addParent = (event: FormEvent) => {
    event.preventDefault();
    if (!newParent.trim()) return;
    setBusy(true);
    setError("");
    addProjectParent(newParent.trim())
      .then(() => { setNewParent(""); load(); })
      .catch(error => setError((error as Error).message))
      .finally(() => setBusy(false));
  };

  const allTags = useMemo(() => Array.from(new Set(projects.flatMap(project => project.tags ?? []))).sort(), [projects]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects
      .filter(project => {
        if (needle) {
          const haystack = [project.title, project.path, project.description, ...(project.tags ?? []), ...Object.keys(project.services.scripts ?? {})]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        if (runner && (project.services.runner ?? "none") !== runner) return false;
        if (runningOnly && project.ports.length === 0) return false;
        if (tag && !(project.tags ?? []).includes(tag)) return false;
        return true;
      })
      .sort((a, b) => {
        switch (sort) {
          case "path": return a.path.localeCompare(b.path);
          case "updated": return updatedAtMs(b) - updatedAtMs(a);
          case "ports": return b.ports.length - a.ports.length;
          case "scripts": return Object.keys(b.services.scripts ?? {}).length - Object.keys(a.services.scripts ?? {}).length;
          default: return a.title.localeCompare(b.title);
        }
      });
  }, [projects, query, sort, runner, runningOnly, tag]);

  const selection = useSelection(visible.map(project => project.id));
  const selectedIds = Array.from(selection.selected);

  const removeParent = async (parent: ProjectParentSummary) => {
    if (!(await confirm({ title: `Remove project parent ${parent.path}?`, body: "Projects and disk files are preserved." }))) return;
    removeProjectParent(parent.id).then(load).catch(error => setError((error as Error).message));
  };

  return (
    <div>
      <div className="page-header">
        <h1>Projects</h1>
        <div className="page-actions">
          <button type="button" className="primary" onClick={scan} disabled={busy}>Scan</button>
        </div>
      </div>
      {scanResult ? <p style={{ color: "var(--text2)" }}>{scanResult}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <CollectionToolbar
        query={query}
        onQueryChange={value => setParam("q", value)}
        sort={sort}
        onSortChange={value => setParam("sort", value)}
        sortOptions={[
          { value: "title", label: "Title" },
          { value: "path", label: "Path" },
          { value: "updated", label: "Recently updated" },
          { value: "ports", label: "Running ports" },
          { value: "scripts", label: "Script count" },
        ]}
      >
        <label>Runner
          <select value={runner} onChange={event => setParam("runner", event.target.value)}>
            <option value="">Any</option>
            {["bun", "pnpm", "yarn", "npm", "none"].map(runner => <option key={runner} value={runner}>{runner}</option>)}
          </select>
        </label>
        <label>Tag
          <select value={tag} onChange={event => setParam("tag", event.target.value)}>
            <option value="">Any</option>
            {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={runningOnly} onChange={event => setParam("running", event.target.checked ? "1" : "")} /> Has running ports</label>
      </CollectionToolbar>
      <SelectionBar count={selectedIds.length} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={busy}>
        <ItemBulkActions ids={selectedIds} onChanged={async () => { await load(); }} />
      </SelectionBar>
      <p style={{ color: "var(--text3)", fontSize: "0.82rem", marginTop: "-0.4rem" }}>{visible.length} of {projects.length} projects</p>

      {loading && !projects.length ? <div className="empty"><strong>Loading…</strong></div> : null}
      {!loading && !projects.length ? <div className="empty"><strong>No projects yet.</strong><p>Add a parent folder and scan.</p></div> : null}
      {projects.length && !visible.length ? <div className="empty"><strong>No matching projects.</strong><p>Adjust search or filters.</p></div> : null}
      {visible.length ? (
        <table className="data-table" style={{ marginBottom: "1.5rem" }}>
          <thead><tr><th>Select</th><th>Project</th><th>Path</th><th>Runner</th><th>Scripts</th><th>Ports</th></tr></thead>
          <tbody>
            {visible.map(project => (
              <tr key={project.id} data-item={project.id} data-path={project.path} data-kind="dir">
                <td><input type="checkbox" checked={selection.selected.has(project.id)} onChange={() => selection.toggle(project.id)} aria-label={`Select ${project.title}`} /></td>
                <td><Link to={`/projects/${project.id}`}>{project.title}</Link></td>
                <td><code>{project.path}</code></td>
                <td>{project.services.runner ?? "none"}</td>
                <td>{Object.keys(project.services.scripts).length}</td>
                <td>{project.ports.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>Project parents</h2>
      <form className="field-row" onSubmit={addParent}>
        <PathField label="Path" kind="dir" value={newParent} onChange={setNewParent} placeholder="~/proj" />
        <button className="secondary" type="submit" disabled={busy}>Add</button>
      </form>
      <table className="data-table">
        <thead><tr><th>Path</th><th>Projects</th><th></th></tr></thead>
        <tbody>
          {parents.map(parent => (
            <tr key={parent.id}>
              <td><code>{parent.path}</code></td>
              <td>{parent.count}</td>
              <td><button type="button" className="danger" onClick={() => removeParent(parent)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {dialog}
    </div>
  );
}
