import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { PortfolioSummary, SettingsView as SettingsType } from "../types.ts";
import { addProjectParent, addWatchedDirectory, getSettings, listPortfolios, patchSettings, removeProjectParent, removeWatchedDirectory } from "../api.ts";
import { BUILTIN_PR_VIEWS } from "../lib/pr-collection.ts";
import { CollectionToolbar } from "@portfolio/ui/collections";
import { useSidecarStatus } from "../hooks/useSidecarStatus.ts";
import { PathField } from "../components/PathField.tsx";
import "../operational.css";
import "../forms.css";
import { getTerminalOptionAsAlt, setTerminalOptionAsAlt, type TerminalOptionAsAlt } from "../terminal/GhosttyTerminal.tsx";

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [optionAsAlt, setOptionAsAltState] = useState<TerminalOptionAsAlt>(getTerminalOptionAsAlt());
  const [newWatchDir, setNewWatchDir] = useState("");
  const [newParentDir, setNewParentDir] = useState("");
  const [ignoredReposText, setIgnoredReposText] = useState("");
  const [pollMinutes, setPollMinutes] = useState("2");
  const [savingGithub, setSavingGithub] = useState(false);
  const [newGithubDir, setNewGithubDir] = useState("");
  const [githubDirError, setGithubDirError] = useState("");
  const status = useSidecarStatus();
  const viewQuery = params.get("pr_view_q") ?? "";
  const viewSort = params.get("pr_view_sort") ?? "saved";
  const updateViewParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const load = () => getSettings().then(loaded => {
    setSettings(loaded);
    setIgnoredReposText((loaded.github_ignored_repos ?? []).join("\n"));
    setPollMinutes(String(loaded.github_poll_minutes ?? 2));
  }).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { listPortfolios().then(({ portfolios }) => setPortfolios(portfolios)).catch(() => {}); }, []);

  if (!settings) return <p>Loading…</p>;

  const setHome = (value: string) => patchSettings({ home_portfolio_id: value ? Number(value) : null }).then(load).catch(() => {});
  const setPastry = (value: boolean) => patchSettings({ pastry_enabled: value }).then(load).catch(() => {});
  const changeOptionAsAlt = (value: TerminalOptionAsAlt) => { setTerminalOptionAsAlt(value); setOptionAsAltState(value); };

  const addWatchDir = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newWatchDir.trim()) return;
    addWatchedDirectory(newWatchDir.trim()).then(() => { setNewWatchDir(""); load(); }).catch(() => {});
  };
  const addParentDir = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newParentDir.trim()) return;
    addProjectParent(newParentDir.trim()).then(() => { setNewParentDir(""); load(); }).catch(() => {});
  };

  const githubDirs = settings?.github_dirs ?? [];
  const saveGithubDirs = (dirs: string[]) => {
    setGithubDirError("");
    return patchSettings({ github_dirs: dirs }).then(load).catch(err => setGithubDirError(err instanceof Error ? err.message : "Could not save GitHub directories."));
  };
  const addGithubDir = (event: React.FormEvent) => {
    event.preventDefault();
    const dir = newGithubDir.trim();
    if (!dir) return;
    void saveGithubDirs([...githubDirs, dir]).then(() => setNewGithubDir(""));
  };

  const saveGithub = (event: React.FormEvent) => {
    event.preventDefault();
    const github_ignored_repos = ignoredReposText.split("\n").map(line => line.trim()).filter(Boolean);
    const minutes = Number(pollMinutes);
    setSavingGithub(true);
    patchSettings({ github_ignored_repos, github_poll_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 2 })
      .then(load)
      .catch(() => {})
      .finally(() => setSavingGithub(false));
  };
  const updateViews = (github_pr_views: SettingsType["github_pr_views"]) =>
    patchSettings({ github_pr_views }).then(setSettings).catch(() => {});
  const moveView = (index: number, direction: -1 | 1) => {
    const views = [...settings.github_pr_views];
    const target = index + direction;
    if (target < 0 || target >= views.length) return;
    [views[index], views[target]] = [views[target], views[index]];
    void updateViews(views);
  };
  const visibleViews = settings.github_pr_views
    .filter(view => `${view.label} ${view.query}`.toLowerCase().includes(viewQuery.toLowerCase()))
    .sort((left, right) => viewSort === "label" ? left.label.localeCompare(right.label) : viewSort === "query" ? left.query.localeCompare(right.query) : settings.github_pr_views.indexOf(left) - settings.github_pr_views.indexOf(right));

  return (
    <div>
      <div className="page-header"><h1>Settings</h1></div>

      <section className="settings-section">
        <h2>Homepage</h2>
        <p className="settings-section-description">The portfolio shown when the app opens.</p>
        <label className="settings-field">Portfolio
          <select value={settings.home_portfolio_id ?? ""} onChange={event => setHome(event.target.value)}>
            <option value="">None</option>
            {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h2>External links</h2>
        <p className="settings-section-description">Links open in your system browser, never over the main screen. In a regular browser, they open in a separate tab.</p>
      </section>

      <section className="settings-section">
        <h2>Terminal</h2>
        <label className="settings-field">Option key acts as Alt
          <select value={optionAsAlt} onChange={event => changeOptionAsAlt(event.target.value as TerminalOptionAsAlt)}>
            <option value="false">Off</option>
            <option value="true">On</option>
            <option value="left">Left only</option>
            <option value="right">Right only</option>
          </select>
        </label>
        <p className="settings-section-description">On lets Option+key send Alt sequences (Meta) to shells and editors instead of typing special characters.</p>
      </section>

      <section className="settings-section">
        <h2>Pastry</h2>
        <label className="form-checkbox"><input type="checkbox" checked={settings.pastry_enabled} onChange={event => setPastry(event.target.checked)} /> Enable pastry</label>
      </section>

      <section className="settings-section">
        <h2>GitHub</h2>
        <form className="form-panel" onSubmit={saveGithub}>
          <p className="settings-section-description">Ignored check failures are configured per repository from the Pull requests page.</p>
          <label>Ignored repos (one owner/repo glob per line, e.g. acme/*). Their PRs are hidden and never notify.
            <textarea value={ignoredReposText} onChange={event => setIgnoredReposText(event.target.value)} rows={4} />
          </label>
          <label>Poll every (minutes)<input type="number" min={1} value={pollMinutes} onChange={event => setPollMinutes(event.target.value)} /></label>
          <div className="form-actions">
            <button className="primary" type="submit" disabled={savingGithub}>Save GitHub settings</button>
          </div>
        </form>

        <h3>Pull request views</h3>
        <label className="settings-field">Default view
          <select value={settings.github_pr_default_view} onChange={event => void patchSettings({ github_pr_default_view: event.target.value }).then(setSettings)}>
            {BUILTIN_PR_VIEWS.map(view => <option key={view.id} value={view.id}>{view.label}</option>)}
            {settings.github_pr_views.map(view => <option key={view.id} value={view.id}>{view.label}</option>)}
          </select>
        </label>
        <p className="settings-section-description">Custom shortcut order matches the Pull requests page. Create shortcuts from the current filters there.</p>
        <CollectionToolbar query={viewQuery} onQueryChange={value => updateViewParam("pr_view_q", value)} sort={viewSort} onSortChange={value => updateViewParam("pr_view_sort", value)} sortOptions={[
          { value: "saved", label: "Saved order" }, { value: "label", label: "Name" }, { value: "query", label: "Saved filters" },
        ]} />
        <table className="data-table">
          <thead><tr><th>Shortcut</th><th>Saved filters</th><th>Order</th><th></th></tr></thead>
          <tbody>
            {visibleViews.map(view => {
              const index = settings.github_pr_views.indexOf(view);
              return <tr key={view.id}>
                <td><input aria-label={`Name for ${view.label}`} value={view.label} onChange={event => {
                  const views = settings.github_pr_views.map(item => item.id === view.id ? { ...item, label: event.target.value } : item);
                  setSettings({ ...settings, github_pr_views: views });
                }} onBlur={() => void updateViews(settings.github_pr_views)} /></td>
                <td><code>{view.query || "All PRs"}</code></td>
                <td><button type="button" className="secondary" aria-label={`Move ${view.label} up`} disabled={index === 0} onClick={() => moveView(index, -1)}>↑</button>
                  <button type="button" className="secondary" aria-label={`Move ${view.label} down`} disabled={index === settings.github_pr_views.length - 1} onClick={() => moveView(index, 1)}>↓</button></td>
                <td><button type="button" className="danger" onClick={() => {
                  const views = settings.github_pr_views.filter(item => item.id !== view.id);
                  const github_pr_default_view = settings.github_pr_default_view === view.id ? "all" : settings.github_pr_default_view;
                  void patchSettings({ github_pr_views: views, github_pr_default_view }).then(setSettings);
                }}>Delete</button></td>
              </tr>;
            })}
            {!visibleViews.length ? <tr><td colSpan={4} className="empty-table-cell">{settings.github_pr_views.length ? "No custom views match this search." : "No custom views."}</td></tr> : null}
          </tbody>
        </table>

        <h3>PR check directories</h3>
        <p className="settings-section-description">gh runs from each directory in turn, so each one's git remote decides which host and credentials answer. Empty means the API's own directory.</p>
        <form className="field-row" onSubmit={addGithubDir}>
          <PathField label="Path" kind="dir" value={newGithubDir} onChange={setNewGithubDir} placeholder="~/work/carrot" />
          <button className="secondary" type="submit">Add</button>
        </form>
        {githubDirError ? <p className="operational-error">{githubDirError}</p> : null}
        <table className="data-table">
          <thead><tr><th>Path</th><th></th></tr></thead>
          <tbody>
            {githubDirs.map(dir => (
              <tr key={dir}>
                <td><code>{dir}</code></td>
                <td><button type="button" className="danger" onClick={() => void saveGithubDirs(githubDirs.filter(entry => entry !== dir))}>Remove</button></td>
              </tr>
            ))}
            {!githubDirs.length ? <tr><td colSpan={2} className="empty-table-cell">None. gh runs from the API's own directory.</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section className="settings-section">
        <h2>Watched directories</h2>
        <form className="field-row" onSubmit={addWatchDir}>
          <PathField label="Path" kind="dir" value={newWatchDir} onChange={setNewWatchDir} placeholder="~/proj" />
          <button className="secondary" type="submit">Add</button>
        </form>
        <table className="data-table">
          <thead><tr><th>Path</th><th>Recursive</th><th></th></tr></thead>
          <tbody>
            {settings.watched_directories.map(dir => (
              <tr key={dir.id}>
                <td><code>{dir.path}</code></td>
                <td>{dir.recursive ? "yes" : "no"}</td>
                <td><button type="button" className="danger" onClick={() => removeWatchedDirectory(dir.id).then(load)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="settings-section">
        <h2>Project parents</h2>
        <form className="field-row" onSubmit={addParentDir}>
          <PathField label="Path" kind="dir" value={newParentDir} onChange={setNewParentDir} placeholder="~/proj" />
          <button className="secondary" type="submit">Add</button>
        </form>
        <table className="data-table">
          <thead><tr><th>Path</th><th>Projects</th><th></th></tr></thead>
          <tbody>
            {settings.project_parents.map(parent => (
              <tr key={parent.id}>
                <td><code>{parent.path}</code></td>
                <td>{parent.count}</td>
                <td><button type="button" className="danger" onClick={() => removeProjectParent(parent.id).then(load)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="settings-section">
        <h2>Sidecar</h2>
        <div className="sidecar-status">
          <span className={`sidecar-dot ${status === "ok" ? "ok" : status === "down" ? "down" : ""}`} />
          <span>{status === "ok" ? "Connected" : status === "down" ? "Offline" : "Checking…"}</span>
        </div>
      </section>
    </div>
  );
}
