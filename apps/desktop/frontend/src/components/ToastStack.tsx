import { useEffect, useState } from "react";
import { Link } from "react-router";
import { completeReminder } from "../api.ts";
import { openSystem } from "../native.ts";
import { dismissNotifications, NOTIFICATION_POPUP_MS, useNotifications, visibleNotifications } from "../lib/notifications.ts";
import type { AppNotification } from "../lib/notifications.ts";

export function NotificationActions({ item }: { item: AppNotification }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prUrl = item.kind === "pr" ? item.url : null;
  const complete = async () => {
    if (item.kind !== "reminder" || busy) return;
    setBusy(true); setError("");
    try {
      await completeReminder(item.reminder_id, item.due_at.slice(0, 10));
      dismissNotifications([item.id]);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <>
    <div className="page-actions">
      {item.kind === "pr" ? prUrl ? <button type="button" className="primary" onClick={() => { void openSystem(prUrl).catch(error => setError(String(error))); }}>Open PR</button> : <Link to="/prs">View pull requests</Link> : <>
        <Link to={`/reminders?q=${encodeURIComponent(item.title)}`}>Open reminder</Link>
        {item.task_id !== null ? <Link to={`/tasks/${item.task_id}`}>Linked task</Link> : null}
        {item.dismissed_at === null ? <button type="button" className="primary" disabled={busy} onClick={() => void complete()}>{busy ? "Completing…" : "Done"}</button> : null}
      </>}
      {item.dismissed_at === null ? <button type="button" className="secondary" onClick={() => dismissNotifications([item.id])}>Dismiss</button> : null}
    </div>
    {error ? <p className="notification-error" role="alert">{error}</p> : null}
  </>;
}

export function ToastStack() {
  const { items } = useNotifications();
  const [now, setNow] = useState(Date.now);
  const toasts = visibleNotifications(items, Math.max(now, Date.now()));
  useEffect(() => {
    const current = Date.now();
    const next = items.filter(item => item.dismissed_at === null && item.received_at + NOTIFICATION_POPUP_MS > current)
      .reduce((earliest, item) => Math.min(earliest, item.received_at + NOTIFICATION_POPUP_MS), Infinity);
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, next - current));
    return () => clearTimeout(timer);
  }, [items, now]);

  if (!toasts.length) return null;
  return <div className="toast-stack" aria-label="Recent notifications">
    {toasts.map(item => <div className="toast-card" key={item.id}>
      <div role="status"><strong>{item.title}</strong><p>{item.message}</p></div>
      <NotificationActions item={item} />
    </div>)}
  </div>;
}
