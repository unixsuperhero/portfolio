import { useSearchParams } from "react-router";
import type { KeyboardEvent } from "react";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import { dismissNotifications, useNotifications } from "../lib/notifications.ts";
import { NotificationActions } from "../components/ToastStack.tsx";

export default function Notifications() {
  const { items, storageError, pollingError } = useNotifications();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "dismissed" ? "dismissed" : "new";
  const query = params.get("q") ?? "";
  const source = params.get("source") ?? "";
  const sort = params.get("sort") ?? "newest";
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === "tab" && value === "new" && next.get("sort") === "dismissed") next.delete("sort");
    setParams(next, { replace: true, flushSync: true });
  };
  const newCount = items.filter(item => item.dismissed_at === null).length;
  const visible = items.filter(item => (item.dismissed_at !== null) === (tab === "dismissed")
    && (!source || item.kind === source) && (!query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => sort === "oldest" ? a.received_at - b.received_at : sort === "title" ? a.title.localeCompare(b.title)
      : sort === "source" ? a.kind.localeCompare(b.kind) || b.received_at - a.received_at
      : sort === "dismissed" ? (b.dismissed_at ?? 0) - (a.dismissed_at ?? 0) : b.received_at - a.received_at);
  const selection = useSelection(visible.map(item => item.id));
  const switchTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "new" : event.key === "End" ? "dismissed" : tab === "new" ? "dismissed" : "new";
    setParam("tab", next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };

  return <section className="notifications-page">
    <div className="page-header"><h1>Notifications</h1></div>
    <p className="notification-hint">Popups close after 8 seconds. New notifications stay here until dismissed.</p>
    {storageError ? <p className="notification-error" role="alert">{storageError}</p> : null}
    {pollingError ? <p className="notification-error" role="alert">{pollingError} Updates retry every minute.</p> : null}
    <div className="notification-tabs" role="tablist" aria-label="Notification status">
      <button type="button" role="tab" id="notifications-tab-new" aria-controls="notifications-panel" aria-selected={tab === "new"} tabIndex={tab === "new" ? 0 : -1} data-tab="new" onKeyDown={switchTab} onClick={() => setParam("tab", "new")}>New ({newCount})</button>
      <button type="button" role="tab" id="notifications-tab-dismissed" aria-controls="notifications-panel" aria-selected={tab === "dismissed"} tabIndex={tab === "dismissed" ? 0 : -1} data-tab="dismissed" onKeyDown={switchTab} onClick={() => setParam("tab", "dismissed")}>Dismissed ({items.length - newCount})</button>
    </div>
    <div role="tabpanel" id="notifications-panel" aria-labelledby={`notifications-tab-${tab}`}>
      <CollectionToolbar query={query} onQueryChange={value => setParam("q", value)} sort={sort} onSortChange={value => setParam("sort", value)} sortOptions={[
        { value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "title", label: "Title" }, { value: "source", label: "Source" },
        ...(tab === "dismissed" ? [{ value: "dismissed", label: "Recently dismissed" }] : []),
      ]}>
        <label>Source<select value={source} onChange={event => setParam("source", event.target.value)}><option value="">All sources</option><option value="reminder">Reminders</option><option value="pr">Pull requests</option></select></label>
      </CollectionToolbar>
      <SelectionBar count={selection.selected.size} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear}>
        {tab === "new" ? <button type="button" className="secondary" onClick={() => dismissNotifications([...selection.selected])}>Dismiss selected</button> : null}
      </SelectionBar>
      {!visible.length ? <div className="empty"><strong>{query || source ? "No notifications match these filters." : tab === "new" ? "No new notifications." : "No dismissed notifications."}</strong></div> : null}
      <ul className="notification-list">
        {visible.map(item => <li key={item.id}>
          <input type="checkbox" aria-label={`Select ${item.title}`} checked={selection.selected.has(item.id)} onChange={() => selection.toggle(item.id)} />
          <div className="notification-body"><h2>{item.title}</h2><p>{item.message}</p>
            <p className="notification-meta">{item.kind === "reminder" ? "Reminder" : "Pull request"} · <time dateTime={new Date(item.received_at).toISOString()}>{new Date(item.received_at).toLocaleString()}</time>{item.dismissed_at !== null ? <> · Dismissed <time dateTime={new Date(item.dismissed_at).toISOString()}>{new Date(item.dismissed_at).toLocaleString()}</time></> : null}</p>
            <NotificationActions item={item} />
          </div>
        </li>)}
      </ul>
    </div>
  </section>;
}
