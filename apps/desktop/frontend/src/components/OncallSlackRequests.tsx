import { Link } from "react-router";
import { prIdentity } from "../lib/pr-collection.ts";
import { oncallStatusLabel } from "../lib/oncall.ts";
import { useOncall } from "../hooks/useOncall.ts";
import { MarkdownContent } from "./MarkdownContent.tsx";
import "./oncall.css";

/**
 * Reviews asked for directly on Slack. They live on the oncall list, not in the GitHub
 * `review_requested` query, so they get their own area instead of joining the PR lists.
 * Renders nothing until the oncall API actually returns a Slack-sourced PR request.
 */
export function OncallSlackRequests({ trackedUrls }: { trackedUrls: ReadonlySet<string> }) {
  const { items } = useOncall();
  const slackRequests = items.filter(item => item.kind === "pr" && item.slack_message_url && item.status !== "done" && item.status !== "dismissed");
  if (!slackRequests.length) return null;

  return <section className="oncall-slack-requests" aria-labelledby="oncall-slack-requests-heading">
    <h2 id="oncall-slack-requests-heading">Direct Slack requests ({slackRequests.length})</h2>
    <p className="oncall-slack-hint">Addressed to you or oncall in Slack. Manage status on the <Link to="/oncall">Oncall</Link> page.</p>
    <ul className="oncall-slack-list">
      {slackRequests.map(item => <li key={item.id}>
        <div className="oncall-slack-head">
          <h3>{item.title}</h3>
          <span className={`oncall-badge oncall-tone-${item.status}`}>{oncallStatusLabel(item.status)}</span>
          <span className="oncall-muted">{item.pr_url && trackedUrls.has(prIdentity(item.pr_url)) ? "Already in your PR lists" : "Not in GitHub review requests"}</span>
          {item.author ? <span className="oncall-muted">by {item.author}</span> : null}
          <span className="oncall-muted">{new Date(item.created_at).toLocaleString()}</span>
        </div>
        <div className="oncall-links">
          {item.slack_message_url ? <a href={item.slack_message_url}>Slack message</a> : null}
          {item.slack_thread_url ? <a href={item.slack_thread_url}>Slack thread</a> : null}
          {item.slack_channel_url && item.slack_channel ? <a href={item.slack_channel_url}>#{item.slack_channel}</a> : null}
          {item.pr_url ? <a href={item.pr_url}>Pull request</a> : <span className="oncall-muted">No PR link captured</span>}
        </div>
        {item.body ? <MarkdownContent text={item.body} /> : null}
        {item.thread_context.trim()
          ? <details className="oncall-thread"><summary>Slack thread context</summary><pre>{item.thread_context}</pre></details>
          : null}
      </li>)}
    </ul>
  </section>;
}
