import { useEffect, useState } from "react";
import type { PortfolioSummary, SettingsView as SettingsType } from "../types.ts";
import { addProjectParent, addWatchedDirectory, getSettings, listPortfolios, patchSettings, removeProjectParent, removeWatchedDirectory } from "../api.ts";
import { getLinksOpenIn, setLinksOpenIn, type LinksOpenIn } from "../context-menu/ContextMenu.tsx";
import { useSidecarStatus } from "../hooks/useSidecarStatus.ts";
import { PathField } from "../components/PathField.tsx";
import "../operational.css";
import "../forms.css";
import { getTerminalOptionAsAlt, setTerminalOptionAsAlt, type TerminalOptionAsAlt } from "../terminal/GhosttyTerminal.tsx";

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [linksOpenIn, setLinks] = useState<LinksOpenIn>(getLinksOpenIn());
  const [optionAsAlt, setOptionAsAltState] = useState<TerminalOptionAsAlt>(getTerminalOptionAsAlt());
  const [newWatchDir, setNewWatchDir] = useState("");
  const [newParentDir, setNewParentDir] = useState("");
  const [ignoredChecksText, setIgnoredChecksText] = useState("");
  const [pollMinutes, setPollMinutes] = useState("2");
  const [savingGithub, setSavingGithub] = useState(false);
  const [newGithubDir, setNewGithubDir] = useState("");
  const [githubDirError, setGithubDirError] = useState("");
  const status = useSidecarStatus();

  const load = () => getSettings().then(loaded => {
    setSettings(loaded);
    setIgnoredChecksText((loaded.github_ignored_checks ?? []).join("\n"));
    setPollMinutes(String(loaded.github_poll_minutes ?? 2));
  }).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { listPortfolios().then(({ portfolios }) => setPortfolios(portfolios)).catch(() => {}); }, []);

  if (!settings) return <p>Loading…</p>;

  const setHome = (value: string) => patchSettings({ home_portfolio_id: value ? Number(value) : null }).then(load).catch(() => {});
  const setPastry = (value: boolean) => patchSettings({ pastry_enabled: value }).then(load).catch(() => {});
  const changeLinks = (value: LinksOpenIn) => { setLinksOpenIn(value); setLinks(value); };
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
    const github_ignored_checks = ignoredChecksText.split("\n").map(line => line.trim()).filter(Boolean);
    const minutes = Number(pollMinutes);
    setSavingGithub(true);
    patchSettings({ github_ignored_checks, github_poll_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 2 })
      .then(load)
      .catch(() => {})
      .finally(() => setSavingGithub(false));
  };

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
        <div className="settings-choices">
          <label className="form-checkbox"><input type="radio" name="links" checked={linksOpenIn === "in-app"} onChange={() => changeLinks("in-app")} /> Open in in-app browser</label>
          <label className="form-checkbox"><input type="radio" name="links" checked={linksOpenIn === "system"} onChange={() => changeLinks("system")} /> Open in system browser</label>
        </div>
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
          <label>Ignored checks (one glob per line, e.g. codecov/*)
            <textarea value={ignoredChecksText} onChange={event => setIgnoredChecksText(event.target.value)} rows={4} />
          </label>
          <label>Poll every (minutes)<input type="number" min={1} value={pollMinutes} onChange={event => setPollMinutes(event.target.value)} /></label>
          <div className="form-actions">
            <button className="primary" type="submit" disabled={savingGithub}>Save GitHub settings</button>
          </div>
        </form>

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
