import { useEffect, useState } from "react";
import { PortfolioApiError } from "@portfolio/client";
import type { Pr, PrsResponse } from "../types.ts";
import { getPrs, refreshPrs } from "../api.ts";
import { PrRow } from "../components/PrRow.tsx";

const EMPTY: PrsResponse = { mine: [], review_requested: [], watched: [], status: { last_poll_at: null, next_poll_at: null, rate: null, polling: false, error: null, gh_ok: true, login: null } };

function formatTime(value: string | null): string {
  if (!value) return "–";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

function PrListCard({ title, prs, onChanged }: { title: string; prs: Pr[]; onChanged: () => void }) {
  return (
    <section className="rail-section portfolio-card">
      <header>
        <h2>{title}</h2>
        <div className="rail-heading-actions"><span>{prs.length}</span></div>
      </header>
      {prs.length ? (
        <div className="pr-list">
          {prs.map(pr => <PrRow key={pr.id} pr={pr} onChanged={onChanged} />)}
        </div>
      ) : (
        <div className="empty"><strong>No pull requests.</strong></div>
      )}
    </section>
  );
}

export default function PullRequests() {
  const [data, setData] = useState<PrsResponse>(EMPTY);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const load = () => {
    getPrs()
      .then(result => { setData(result); setOffline(false); })
      .catch(() => setOffline(true));
  };
  useEffect(load, []);

  const refresh = () => {
    setRefreshing(true);
    setRefreshError(null);
    refreshPrs()
      .then(result => { setData(result); setOffline(false); })
      .catch(error => setRefreshError(error instanceof PortfolioApiError ? error.message : "Refresh failed."))
      .finally(() => setRefreshing(false));
  };

  const status = data.status;

  return (
    <div>
      <div className="page-header">
        <h1>Pull requests</h1>
        <div className="page-actions">
          <button type="button" className="primary" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>

      {offline ? (
        <p className="pr-status pr-status-error">Couldn't reach the API. Make sure the desktop sidecar is running.</p>
      ) : !status.gh_ok ? (
        <p className="pr-status pr-status-error">
          gh not authenticated. Run <code>gh auth login</code> in a terminal, then hit Refresh.
        </p>
      ) : (
        <p className="pr-status">
          {status.login ? `Signed in as ${status.login} · ` : ""}
          Last poll {formatTime(status.last_poll_at)} · Next {formatTime(status.next_poll_at)}
          {status.rate ? ` · Rate remaining ${status.rate.remaining}` : ""}
          {status.error ? ` · ${status.error}` : ""}
        </p>
      )}
      {refreshError ? <p className="pr-status pr-status-error">{refreshError}</p> : null}

      <div className="portfolio-grid">
        <PrListCard title="Mine" prs={data.mine} onChanged={load} />
        <PrListCard title="Review requested" prs={data.review_requested} onChanged={load} />
        <PrListCard title="Watched" prs={data.watched} onChanged={load} />
      </div>
    </div>
  );
}
