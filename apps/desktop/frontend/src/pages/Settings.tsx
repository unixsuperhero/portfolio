import { useEffect, useState } from "react";
import type { PortfolioSummary, SettingsView as SettingsType } from "../types.ts";
import { addProjectParent, addWatchedDirectory, getSettings, listPortfolios, patchSettings, removeProjectParent, removeWatchedDirectory } from "../api.ts";
import { getLinksOpenIn, setLinksOpenIn, type LinksOpenIn } from "../context-menu/ContextMenu.tsx";
import { useSidecarStatus } from "../hooks/useSidecarStatus.ts";
import { DirectoryPicker } from "../components/DirectoryPicker.tsx";

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [linksOpenIn, setLinks] = useState<LinksOpenIn>(getLinksOpenIn());
  const [picking, setPicking] = useState<"watch" | "parent" | null>(null);
  const [ignoredChecksText, setIgnoredChecksText] = useState("");
  const [pollMinutes, setPollMinutes] = useState("2");
  const [savingGithub, setSavingGithub] = useState(false);
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

      <h2>Homepage</h2>
      <select value={settings.home_portfolio_id ?? ""} onChange={event => setHome(event.target.value)}>
        <option value="">None</option>
        {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <h2 style={{ marginTop: "1.5rem" }}>External links</h2>
      <div className="field-row">
        <label><input type="radio" name="links" checked={linksOpenIn === "in-app"} onChange={() => changeLinks("in-app")} /> Open in in-app browser</label>
        <label><input type="radio" name="links" checked={linksOpenIn === "system"} onChange={() => changeLinks("system")} /> Open in system browser</label>
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Pastry</h2>
      <label><input type="checkbox" checked={settings.pastry_enabled} onChange={event => setPastry(event.target.checked)} /> Enable pastry</label>

      <h2 style={{ marginTop: "1.5rem" }}>GitHub</h2>
      <form className="simple-form" onSubmit={saveGithub}>
        <label>Ignored checks (one glob per line, e.g. codecov/*)
          <textarea value={ignoredChecksText} onChange={event => setIgnoredChecksText(event.target.value)} rows={4} />
        </label>
        <label>Poll every (minutes)<input type="number" min={1} value={pollMinutes} onChange={event => setPollMinutes(event.target.value)} /></label>
        <button className="primary" type="submit" disabled={savingGithub}>Save GitHub settings</button>
      </form>

      <h2 style={{ marginTop: "1.5rem" }}>Watched directories</h2>
      <button type="button" className="secondary" onClick={() => setPicking("watch")}>Add directory</button>
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

      <h2 style={{ marginTop: "1.5rem" }}>Project parents</h2>
      <button type="button" className="secondary" onClick={() => setPicking("parent")}>Add parent</button>
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

      <h2 style={{ marginTop: "1.5rem" }}>Sidecar</h2>
      <div className="sidecar-status">
        <span className={`sidecar-dot ${status === "ok" ? "ok" : status === "down" ? "down" : ""}`} />
        <span>{status === "ok" ? "Connected" : status === "down" ? "Offline" : "Checking…"}</span>
      </div>

      {picking ? (
        <DirectoryPicker
          onClose={() => setPicking(null)}
          onPick={path => {
            const call = picking === "watch" ? addWatchedDirectory(path) : addProjectParent(path);
            call.then(load).finally(() => setPicking(null));
          }}
        />
      ) : null}
    </div>
  );
}
