import { useState } from "react";
import { Link } from "react-router";
import { PortfolioApiError } from "@portfolio/client";
import type { Pr } from "../types.ts";
import { getSettings, patchPr, patchSettings, watchPr } from "../api.ts";
import { PrChecks, PrCheckStats } from "./PrChecks.tsx";
import type { ConfirmOptions } from "./ConfirmDialog.tsx";
import { lifecycle, REVIEW_LABELS } from "../lib/pr-collection.ts";
import { PrStatus } from "./PrStatus.tsx";
import "./pr.css";

export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

export const prLabel = (pr: Pick<Pr, "owner" | "repo" | "number">) => `${pr.owner}/${pr.repo}#${pr.number}`;

export const confirmIgnorePr = (confirm: Confirm, pr: Pick<Pr, "owner" | "repo" | "number">) =>
  confirm({ title: `Ignore ${prLabel(pr)}?`, body: "It leaves visible lists and stops notifying. Restore it by choosing the Ignored collection on the PRs page.", confirmLabel: "Ignore" });

export const confirmIgnoreRepo = (confirm: Confirm, repos: string[]) =>
  confirm({ title: repos.length === 1 ? `Ignore every PR in ${repos[0]}?` : `Ignore every PR in ${repos.length} repos?`, body: `${repos.join(", ")}. Their PRs leave visible lists and stop notifying. Restore a repo from Ignored repositories on the PRs page or in Settings.`, confirmLabel: repos.length === 1 ? "Ignore repo" : "Ignore repos" });

export const dirLabel = (dir: string) => dir.replace(/\/+$/, "").split("/").pop() || dir;


/** Appends owner/repo to settings.github_ignored_repos. */
export const ignoreRepo = (pr: Pick<Pr, "owner" | "repo">) =>
  getSettings().then(settings => patchSettings({ github_ignored_repos: [...(settings.github_ignored_repos ?? []), `${pr.owner}/${pr.repo}`] }));

/** Shared by the PR page and dashboard cards. */
export function PrRow({ pr, onChanged, confirm, repoIgnored = false }: { pr: Pr; onChanged: () => void; confirm: Confirm; repoIgnored?: boolean }) {
  const [watching, setWatching] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState("");
  const state = lifecycle(pr);

  const run = (label: string, action: () => Promise<unknown>) => {
    setHiding(true);
    setError("");
    action()
      .then(onChanged)
      .catch(err => setError(err instanceof PortfolioApiError ? err.message : `Could not ${label}.`))
      .finally(() => setHiding(false));
  };


  const toggleWatch = () => {
    setWatching(true);
    setError("");
    watchPr(pr.url, !pr.watched)
      .then(onChanged)
      .catch(err => setError(err instanceof PortfolioApiError ? err.message : "Could not update watch status."))
      .finally(() => setWatching(false));
  };


  return (
    <article className="pr-row" data-state={state}>
      <div className="pr-row-heading">
        <PrStatus kind={state} label={state[0].toUpperCase() + state.slice(1)} />
        {pr.watched ? <PrStatus kind="watched" label="Watching" /> : null}
        <a className="pr-title" href={pr.url} data-url={pr.url}>{pr.title}</a>
      </div>
      <div className="pr-row-meta">
        <a className="pr-repo" href={pr.url} data-url={pr.url}>{pr.owner}/{pr.repo}#{pr.number}</a>
        <span>by @{pr.author}</span>
        <span>{pr.comments} {pr.comments === 1 ? "comment" : "comments"}</span>
        <time dateTime={pr.updated_at} title={new Date(pr.updated_at).toLocaleString()}>Updated {new Date(pr.updated_at).toLocaleDateString()}</time>
        <span title={pr.source_dir ?? "API directory"}>{pr.source_dir ? dirLabel(pr.source_dir) : "API directory"}</span>
      </div>
      <PrCheckStats checks={pr.checks} />
      <div className="pr-row-signals">
        <PrStatus kind={pr.review_decision ?? "none"} label={REVIEW_LABELS[pr.review_decision ?? "none"]} />
        {pr.is_draft && state !== "draft" ? <PrStatus kind="draft" label="Draft flag" /> : null}
        {pr.ignored || repoIgnored ? <PrStatus kind="ignored" label={repoIgnored ? "Repository ignored" : "Ignored"} /> : null}
        <PrChecks pr={pr} />
      </div>
      <div className="pr-row-actions">
        <button type="button" className="secondary" onClick={toggleWatch} disabled={watching}>{watching ? "Saving…" : pr.watched ? "Unwatch" : "Watch"}</button>
        <details className="pr-management"><summary>Manage</summary><div className="page-actions">
          {repoIgnored ? <span className="pr-ignore-hint">Restore this repository in Ignored repositories below.</span> : <>
            <button type="button" className="secondary" onClick={async () => { if (pr.ignored || await confirmIgnorePr(confirm, pr)) run(pr.ignored ? "unignore" : "ignore", () => patchPr(pr.id, { ignored: !pr.ignored })); }} disabled={hiding}>{pr.ignored ? "Unignore" : "Ignore"}</button>
            {pr.ignored ? null : <button type="button" className="secondary" onClick={async () => { if (await confirmIgnoreRepo(confirm, [`${pr.owner}/${pr.repo}`])) run("ignore repo", () => ignoreRepo(pr)); }} disabled={hiding}>Ignore repo</button>}
          </>}
        </div></details>
        <details className="pr-metadata"><summary>Details</summary><dl>
          <dt>Record ID</dt><dd>{pr.id}</dd>
          <dt>GitHub state</dt><dd>{pr.state}</dd>
          <dt>Draft flag</dt><dd>{pr.is_draft ? "Yes" : "No"}</dd>
          <dt>List memberships</dt><dd>{pr.lists.map(list => list.replaceAll("_", " ")).join(", ") || "None"}</dd>
          <dt>Source directory</dt><dd>{pr.source_dir ?? "API directory"}</dd>
          <dt>Updated</dt><dd>{new Date(pr.updated_at).toLocaleString()}</dd>
          <dt>Fetched</dt><dd>{new Date(pr.fetched_at).toLocaleString()}</dd>
          <dt>Library item</dt><dd>{pr.item_id === null ? "Not linked" : <Link to={`/items/${pr.item_id}`}>Item #{pr.item_id}</Link>}</dd>
          <dt>Repository ignored-check rules</dt><dd>{pr.ignored_checks.join(", ") || "None"}</dd>
        </dl></details>
      </div>
      {error ? <p className="pr-status pr-status-error">{error}</p> : null}
    </article>
  );
}
