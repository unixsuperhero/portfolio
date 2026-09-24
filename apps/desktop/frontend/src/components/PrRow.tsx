import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PortfolioApiError } from "@portfolio/client";
import type { Pr, PrReviewDecision } from "../types.ts";
import { getSettings, patchPr, patchSettings, watchPr } from "../api.ts";
import { PrChecks } from "./PrChecks.tsx";
import type { ConfirmOptions } from "./ConfirmDialog.tsx";

export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

export const prLabel = (pr: Pick<Pr, "owner" | "repo" | "number">) => `${pr.owner}/${pr.repo}#${pr.number}`;

export const confirmIgnorePr = (confirm: Confirm, pr: Pick<Pr, "owner" | "repo" | "number">) =>
  confirm({ title: `Ignore ${prLabel(pr)}?`, body: "It leaves every list and stops notifying. Restore it from the Ignored section on the PRs page.", confirmLabel: "Ignore" });

export const confirmIgnoreRepo = (confirm: Confirm, repos: string[]) =>
  confirm({ title: repos.length === 1 ? `Ignore every PR in ${repos[0]}?` : `Ignore every PR in ${repos.length} repos?`, body: `${repos.join(", ")}. Their PRs leave every list and stop notifying. Restore a repo from the Ignored section on the PRs page or in Settings.`, confirmLabel: repos.length === 1 ? "Ignore repo" : "Ignore repos" });

export const dirLabel = (dir: string) => dir.replace(/\/+$/, "").split("/").pop() || dir;

function reviewLabel(decision: PrReviewDecision): string {
  if (decision === "approved") return "Approved";
  if (decision === "changes_requested") return "Changes requested";
  if (decision === "review_required") return "Review required";
  return "";
}

/** Appends owner/repo to settings.github_ignored_repos. */
export const ignoreRepo = (pr: Pick<Pr, "owner" | "repo">) =>
  getSettings().then(settings => patchSettings({ github_ignored_repos: [...(settings.github_ignored_repos ?? []), `${pr.owner}/${pr.repo}`] }));

/** One PR: state badge, owner/repo#n link, title, review decision, checks pill, comment count,
 * Watch/Unwatch and Ignore/Unignore toggles, "Ignore repo", and an inline "Ignore checks…" editor (PATCH /api/prs/:id).
 * Ignoring asks through `confirm` (useConfirm from the page that renders the rows).
 * `repoIgnored` marks a PR hidden by settings.github_ignored_repos rather than its own flag. */
export function PrRow({ pr, onChanged, confirm, repoIgnored = false }: { pr: Pr; onChanged: () => void; confirm: Confirm; repoIgnored?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [ignoredText, setIgnoredText] = useState(pr.ignored_checks.join("\n"));
  const [saving, setSaving] = useState(false);
  const [watching, setWatching] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState("");

  const run = (label: string, action: () => Promise<unknown>) => {
    setHiding(true);
    setError("");
    action()
      .then(onChanged)
      .catch(err => setError(err instanceof PortfolioApiError ? err.message : `Could not ${label}.`))
      .finally(() => setHiding(false));
  };

  useEffect(() => { setIgnoredText(pr.ignored_checks.join("\n")); }, [pr.id, pr.ignored_checks]);

  const toggleWatch = () => {
    setWatching(true);
    setError("");
    watchPr(pr.url, !pr.watched)
      .then(onChanged)
      .catch(err => setError(err instanceof PortfolioApiError ? err.message : "Could not update watch status."))
      .finally(() => setWatching(false));
  };

  const saveIgnored = (event: React.FormEvent) => {
    event.preventDefault();
    const ignored_checks = ignoredText.split("\n").map(line => line.trim()).filter(Boolean);
    setSaving(true);
    setError("");
    patchPr(pr.id, { ignored_checks })
      .then(() => { setEditing(false); onChanged(); })
      .catch(err => setError(err instanceof PortfolioApiError ? err.message : "Could not save ignored checks."))
      .finally(() => setSaving(false));
  };

  return (
    <div className="pr-row">
      <div className="pr-row-main">
        <span className={`kind pr-state-${pr.state}`}>{pr.is_draft ? "DRAFT" : pr.state.toUpperCase()}</span>
        <a className="pr-repo" href={pr.url} data-url={pr.url}>{pr.owner}/{pr.repo}#{pr.number}</a>
        <span className="pr-title" title={pr.title}>{pr.title}</span>
        {pr.source_dir ? <span className="kind pr-dir" title={pr.source_dir}>{dirLabel(pr.source_dir)}</span> : null}
        {pr.review_decision ? <span className={`pr-review pr-review-${pr.review_decision}`}>{reviewLabel(pr.review_decision)}</span> : null}
        <PrChecks pr={pr} />
        <span className="pr-comments" title="Comments">💬 {pr.comments}</span>
        <button type="button" className="secondary" onClick={toggleWatch} disabled={watching}>{pr.watched ? "Unwatch" : "Watch"}</button>
        {repoIgnored ? (
          <span className="pr-ignore-hint">Repo ignored</span>
        ) : (
          <>
            <button type="button" className="secondary" onClick={async () => { if (pr.ignored || await confirmIgnorePr(confirm, pr)) run(pr.ignored ? "unignore" : "ignore", () => patchPr(pr.id, { ignored: !pr.ignored })); }} disabled={hiding}>{pr.ignored ? "Unignore" : "Ignore"}</button>
            {pr.ignored ? null : <button type="button" className="secondary" onClick={async () => { if (await confirmIgnoreRepo(confirm, [`${pr.owner}/${pr.repo}`])) run("ignore repo", () => ignoreRepo(pr)); }} disabled={hiding} title={`Hide every PR in ${pr.owner}/${pr.repo}`}>Ignore repo</button>}
          </>
        )}
        <button type="button" className="secondary" onClick={() => setEditing(value => !value)}>Ignore checks…</button>
      </div>
      {error ? <p className="pr-status pr-status-error">{error}</p> : null}
      {editing ? (
        <form className="pr-ignore-form" onSubmit={saveIgnored}>
          <textarea
            value={ignoredText}
            onChange={event => setIgnoredText(event.target.value)}
            rows={3}
            placeholder="one glob per line, e.g. codecov/*"
          />
          <div className="page-actions">
            <button type="submit" className="primary" disabled={saving}>Save</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <p className="pr-ignore-hint">Global patterns live in <Link to="/settings">Settings</Link>.</p>
        </form>
      ) : null}
    </div>
  );
}
