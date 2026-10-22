import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { PortfolioApiError } from "@portfolio/client";
import { CollectionToolbar } from "@portfolio/ui/collections";
import { copyText } from "../native.ts";
import { openTerminal } from "../terminal/store.ts";
import { listOncallPromptRuns, runOncallPrompt } from "../api.ts";
import { groupOncallItems, ONCALL_STATUSES, oncallStatusLabel } from "../lib/oncall.ts";
import { useOncall } from "../hooks/useOncall.ts";
import { MarkdownContent } from "../components/MarkdownContent.tsx";
import type { OncallItem, OncallPrompt, OncallPromptRun, OncallStatus } from "../types.ts";
import "../operational.css";
import "../components/oncall.css";
import "./Oncall.css";

/** Sentinel for the select: clear the manual override and fall back to the poller's suggestion. */
const CLEAR_STATUS = "__suggested";
const MAX_RUNS = 25;

const formatTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "Never");
const errorMessage = (error: unknown) => (error instanceof PortfolioApiError ? error.message : "Request failed.");

export default function Oncall() {
  const [params, setParams] = useSearchParams();
  const { items, prompts, lastPolledAt, pollingPaused, pollingError, loading, offline, lastError, reload, setStatus, setPollingPaused } = useOncall();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [runs, setRuns] = useState<OncallPromptRun[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [running, setRunning] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pollingBusy, setPollingBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const autoSelected = useRef(false);

  const query = params.get("q") ?? "";
  const kind = params.get("kind") ?? "";
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "newest";
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, flushSync: true });
  };

  const loadRuns = useCallback(async () => {
    try {
      const result = await listOncallPromptRuns();
      setRuns(result.runs);
      setRunsError(null);
      return result.runs;
    } catch (error) {
      setRunsError(errorMessage(error));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => void loadRuns(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadRuns]);

  // While something is running, watch it closely so its captured output appears promptly.
  const runInFlight = running.length > 0 || runs.some(run => run.status === "running");
  useEffect(() => {
    if (!runInFlight) return;
    const timer = window.setInterval(() => void loadRuns(), 3_000);
    return () => window.clearInterval(timer);
  }, [runInFlight, loadRuns]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter(item => !kind || item.kind === kind)
      .filter(item => !status || item.status === status)
      .filter(item => !needle || [item.title, item.body, item.author, item.slack_channel, item.pr_url, item.thread_context]
        .some(value => (value ?? "").toLowerCase().includes(needle)))
      .sort((left, right) => {
        const leftAt = new Date(left.created_at).getTime();
        const rightAt = new Date(right.created_at).getTime();
        if (sort === "oldest") return leftAt - rightAt;
        if (sort === "title") return left.title.localeCompare(right.title);
        if (sort === "status") return oncallStatusLabel(left.status).localeCompare(oncallStatusLabel(right.status)) || left.title.localeCompare(right.title);
        if (sort === "kind") return left.kind.localeCompare(right.kind) || rightAt - leftAt;
        return rightAt - leftAt;
      });
  }, [items, kind, query, sort, status]);
  const groupedItems = useMemo(() => groupOncallItems(visibleItems), [visibleItems]);

  // Select the first item once, on the first payload that has one. Polls never move it.
  useEffect(() => {
    if (autoSelected.current || !visibleItems.length) return;
    autoSelected.current = true;
    setSelectedId(visibleItems[0].id);
  }, [visibleItems]);

  // An item the backend dropped (dismissed upstream) releases the selection; an empty list
  // while the API is unreachable does not.
  useEffect(() => {
    if (selectedId === null || offline || !items.length) return;
    if (!items.some(item => item.id === selectedId)) setSelectedId(null);
  }, [items, offline, selectedId]);

  const selected = items.find(item => item.id === selectedId) ?? null;

  const changeStatus = (item: OncallItem, value: string) => {
    setActionError(null);
    setSavingId(item.id);
    setStatus(item.id, value === CLEAR_STATUS ? null : (value as OncallStatus))
      .catch(error => setActionError(`${item.title}: ${errorMessage(error)}`))
      .finally(() => setSavingId(null));
  };

  const refresh = () => {
    setRefreshing(true);
    setActionError(null);
    Promise.all([reload().catch(error => { setActionError(errorMessage(error)); return null; }), loadRuns()])
      .finally(() => setRefreshing(false));
  };

  const togglePolling = async () => {
    if (pollingBusy) return;
    setPollingBusy(true);
    setActionError(null);
    try {
      await setPollingPaused(!pollingPaused);
    } catch (error) {
      setActionError(`Polling: ${errorMessage(error)}`);
    } finally {
      setPollingBusy(false);
    }
  };

  const runPrompt = (prompt: OncallPrompt) => {
    if (running.includes(prompt.id)) return;
    setActionError(null);
    setRunning(current => [...current, prompt.id]);
    runOncallPrompt(prompt.id)
      .then(result => {
        setRuns(current => [result.run, ...current.filter(run => run.id !== result.run.id)]);
        if (result.run.status === "running") void loadRuns();
      })
      .catch(error => setActionError(`${prompt.title}: ${errorMessage(error)}`))
      .finally(() => setRunning(current => current.filter(id => id !== prompt.id)));
  };

  const copyOutput = (key: string, output: string) => {
    void copyText(output).then(ok => {
      if (!ok) return;
      setCopied(key);
      window.setTimeout(() => setCopied(current => (current === key ? null : current)), 2_000);
    });
  };

  return <div className="oncall-page">
    <div className="page-header">
      <div>
        <h1>Oncall</h1>
        <p className="oncall-intro">Slack channels and pull requests that need a human, plus the prompts you run for them.</p>
      </div>
      <button type="button" className="primary" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
    </div>
    <div className="oncall-polling-controls">
      {offline
        ? <p className="operational-error" role="alert">Couldn't reach the API{lastError ? `: ${lastError}` : ""}. Check the desktop sidecar, then Refresh.</p>
        : <p className="operational-status">Last poll {formatTime(lastPolledAt)} · Slack every 6 minutes · Page every 30 seconds</p>}
      <span className={`oncall-badge ${loading || offline ? "" : pollingPaused ? "oncall-tone-dismissed" : "oncall-tone-done"}`} role="status">{loading ? "Polling status loading" : offline ? "Polling status unavailable" : `Polling ${pollingPaused ? "paused" : "active"}`}</span>
      <button type="button" className="secondary" onClick={() => void togglePolling()} disabled={loading || offline || pollingBusy}>
        {pollingBusy ? (pollingPaused ? "Resuming…" : "Pausing…") : pollingPaused ? "Resume polling" : "Pause polling"}
      </button>
    </div>
    <p className="oncall-poll-hint oncall-muted">An in-flight poll may finish after pausing. Resuming waits for the next scheduled six-minute check.</p>
    {pollingError ? <p className="operational-error" role="alert">Slack polling: {pollingError}</p> : null}
    {actionError ? <p className="operational-error" role="alert">{actionError}</p> : null}

    <CollectionToolbar
      query={query}
      onQueryChange={value => update("q", value)}
      sort={sort}
      onSortChange={value => update("sort", value)}
      sortOptions={[
        { value: "newest", label: "Newest first" },
        { value: "oldest", label: "Oldest first" },
        { value: "title", label: "Title" },
        { value: "status", label: "Status" },
        { value: "kind", label: "Source" },
      ]}
    >
      <label>Source<select name="kind" value={kind} onChange={event => update("kind", event.target.value)}>
        <option value="">Everything</option><option value="slack">Slack</option><option value="pr">Pull requests</option>
      </select></label>
      <label>Status<select name="status" value={status} onChange={event => update("status", event.target.value)}>
        <option value="">Any status</option>
        {ONCALL_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
    </CollectionToolbar>
    <p className="oncall-summary operational-status" role="status">{visibleItems.length} of {items.length} items · {prompts.length} prompt{prompts.length === 1 ? "" : "s"}</p>

    {loading
      ? <p className="operational-status" role="status">Loading oncall items…</p>
      : <div className="oncall-layout">
        <ul className="oncall-items" aria-label="Oncall items">
          {groupedItems.map(group => <li key={group.key} className="oncall-group">
            <div className="oncall-group-heading">
              <h2>{group.thread
                ? <><a href={group.thread.url}>{group.thread.channel ? `#${group.thread.channel}` : "Slack thread"}</a><span className="oncall-group-time"> · {group.thread.startedAt}</span></>
                : "Other actions"}</h2>
              <span>{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
            </div>
            <ul>
              {group.items.map(item => <li
                key={item.id}
                className={`oncall-item${item.id === selectedId ? " is-selected" : ""}`}
                data-nav-item={item.id}
                data-nav-label={item.title}
              >
                <button
                  type="button"
                  className="oncall-item-button"
                  data-nav-primary
                  data-nav-label={item.title}
                  aria-current={item.id === selectedId}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="oncall-item-top">
                    <span className={`oncall-badge oncall-tone-${item.kind}`}>{item.kind === "slack" ? "Slack" : "PR"}</span>
                    <span className={`oncall-badge oncall-tone-${item.status}`}>{oncallStatusLabel(item.status)}</span>
                    {item.slack_channel ? <span className="oncall-muted">#{item.slack_channel}</span> : null}
                  </span>
                  <span className="oncall-item-title">{item.title}</span>
                  <span className="oncall-muted">{formatTime(item.created_at)}{item.author ? ` · ${item.author}` : ""}</span>
                </button>
              </li>)}
            </ul>
          </li>)}
          {!visibleItems.length ? <li className="oncall-empty">
            <div className="empty"><strong>{items.length ? "No items match these filters." : "Nothing on the oncall list."}</strong>
              <p>{items.length ? "Clear the search or filters to see the rest." : "Slack channels are polled every 6 minutes; new requests appear here."}</p></div>
          </li> : null}
        </ul>

        {selected ? <article className="oncall-detail" aria-label="Selected oncall item">
          <header className="oncall-detail-head">
            <h2>{selected.title}</h2>
            <p className="oncall-detail-meta">
              <span className={`oncall-badge oncall-tone-${selected.kind}`}>{selected.kind === "slack" ? "Slack" : "Pull request"}</span>
              <span className={`oncall-badge oncall-tone-${selected.status}`}>{oncallStatusLabel(selected.status)}</span>
              {selected.author ? <span className="oncall-muted">by {selected.author}</span> : null}
              <span className="oncall-muted">{formatTime(selected.created_at)}</span>
            </p>
          </header>

          <div className="oncall-status-editor">
            <label htmlFor={`oncall-status-${selected.id}`}>Status</label>
            <select
              id={`oncall-status-${selected.id}`}
              value={selected.manual_status ?? selected.status}
              disabled={savingId === selected.id}
              onChange={event => changeStatus(selected, event.target.value)}
            >
              {ONCALL_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              {selected.manual_status ? <option value={CLEAR_STATUS}>Clear override — suggested: {oncallStatusLabel(selected.suggested_status)}</option> : null}
            </select>
            {savingId === selected.id ? <span className="oncall-muted" role="status">Saving…</span> : null}
            {selected.manual_status ? <span className="oncall-muted">Manual override</span> : null}
            {selected.manual_status && selected.manual_status !== selected.suggested_status
              ? <button type="button" className="secondary" onClick={() => changeStatus(selected, CLEAR_STATUS)}>Use suggestion: {oncallStatusLabel(selected.suggested_status)}</button>
              : null}
          </div>

          <div className="oncall-links">
            {selected.slack_channel
              ? selected.slack_channel_url
                ? <a href={selected.slack_channel_url}>#{selected.slack_channel}</a>
                : <span className="oncall-muted">#{selected.slack_channel}</span>
              : null}
            {selected.slack_message_url ? <a href={selected.slack_message_url}>Slack message</a> : null}
            {selected.slack_thread_url ? <a href={selected.slack_thread_url}>Slack thread</a> : null}
            {selected.pr_url ? <a href={selected.pr_url}>Pull request</a> : null}
            {!selected.slack_message_url && !selected.slack_thread_url && !selected.pr_url && !selected.slack_channel_url
              ? <span className="oncall-muted">No links captured for this item.</span>
              : null}
          </div>

          {selected.body ? <MarkdownContent text={selected.body} /> : null}
          {selected.thread_context.trim()
            ? <details className="oncall-thread">
              <summary>Slack thread context</summary>
              <pre>{selected.thread_context}</pre>
            </details>
            : null}
        </article> : <article className="oncall-detail">
          <p className="oncall-muted">Select an item to see its status, links, and collected thread.</p>
        </article>}
      </div>}

    <section className="oncall-prompts" aria-labelledby="oncall-prompts-heading">
      <div className="oncall-section-head">
        <h2 id="oncall-prompts-heading">Prompts</h2>
        <p className="oncall-muted">Each prompt runs in its own directory; its output is captured here.</p>
      </div>
      {!prompts.length
        ? <p className="oncall-muted">No prompts are configured.</p>
        : <ul className="oncall-prompt-list">
          {prompts.map(prompt => {
            const latest = runs
              .filter(run => run.prompt_id === prompt.id)
              .reduce<OncallPromptRun | null>((best, run) => (!best || run.id > best.id ? run : best), null);
            const busy = running.includes(prompt.id) || latest?.status === "running";
            return <li key={prompt.id} className="oncall-prompt" data-nav-item={prompt.id} data-nav-label={prompt.title}>
              <div className="oncall-prompt-head">
                <h3>{prompt.title}</h3>
                <div className="page-actions">
                  <button type="button" className="secondary" onClick={() => openTerminal({ cwd: prompt.directory, title: prompt.title })}>Terminal</button>
                  <button
                    type="button"
                    className="primary"
                    data-nav-primary
                    data-nav-label={`Run ${prompt.title}`}
                    disabled={busy}
                    onClick={() => runPrompt(prompt)}
                  >{busy ? "Running…" : "Run"}</button>
                </div>
              </div>
              <p className="oncall-muted oncall-prompt-dir" data-path={prompt.directory} data-kind="dir">{prompt.directory}</p>
              {prompt.body ? <pre className="oncall-prompt-body">{prompt.body}</pre> : null}
              {latest ? <div className="oncall-run">
                <p className="oncall-run-meta">
                  <span className={`oncall-badge oncall-tone-${latest.status}`}>{latest.status}</span>
                  <span className="oncall-muted">Started {formatTime(latest.started_at)}{latest.finished_at ? ` · Finished ${formatTime(latest.finished_at)}` : ""}</span>
                  {latest.output
                    ? <button type="button" className="secondary" onClick={() => copyOutput(`run-${latest.id}`, latest.output)}>{copied === `run-${latest.id}` ? "Copied" : "Copy output"}</button>
                    : null}
                </p>
                <pre className="oncall-output" aria-label={`Output from ${prompt.title}`}>{latest.output || (latest.status === "running" ? "Waiting for output…" : "(no output)")}</pre>
              </div> : <p className="oncall-muted">Not run yet.</p>}
            </li>;
          })}
        </ul>}
    </section>

    <section className="oncall-runs">
      <details>
        <summary>Recent runs ({runs.length})</summary>
        {runsError ? <p className="operational-error" role="alert">{runsError}</p> : null}
        {!runs.length
          ? <p className="oncall-muted">No prompt has been run yet.</p>
          : <ul className="oncall-run-list">
            {runs.slice(0, MAX_RUNS).map(run => <li key={run.id}>
              <p className="oncall-run-meta">
                <strong>{prompts.find(prompt => prompt.id === run.prompt_id)?.title ?? run.prompt_id}</strong>
                <span className={`oncall-badge oncall-tone-${run.status}`}>{run.status}</span>
                <span className="oncall-muted">{formatTime(run.started_at)}{run.finished_at ? ` → ${formatTime(run.finished_at)}` : ""}</span>
                {run.output
                  ? <button type="button" className="secondary" onClick={() => copyOutput(`run-${run.id}`, run.output)}>{copied === `run-${run.id}` ? "Copied" : "Copy output"}</button>
                  : null}
              </p>
              <details className="oncall-thread"><summary>Output</summary><pre className="oncall-output">{run.output || "(no output)"}</pre></details>
            </li>)}
            {runs.length > MAX_RUNS ? <li className="oncall-muted">Showing the newest {MAX_RUNS} of {runs.length} runs.</li> : null}
          </ul>}
      </details>
    </section>
  </div>;
}
