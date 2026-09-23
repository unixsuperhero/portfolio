import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Recurrence, ReminderCreateInput, ReminderView, TaskView } from "../types.ts";
import { completeReminder, createReminder, deleteReminder, getTodayReminders, listReminders, listTasks, patchReminder, uncompleteReminder } from "../api.ts";
import { CollectionToolbar, SelectionBar, useSelection } from "../components/CollectionTools.tsx";
import { MarkdownContent } from "../components/MarkdownContent.tsx";
import { AllDone, StreakBadge } from "../components/Completion.tsx";
import "../operational.css";

type ReminderSort = "time" | "title";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SORT_OPTIONS = [
  { value: "time", label: "Time" },
  { value: "title", label: "Title" },
] as const;

type Draft = { title: string; notes: string; recurrence: Recurrence; at: string; days: number[]; task_id: number | null; active: boolean };

const blankDraft = (): Draft => ({ title: "", notes: "", recurrence: "daily", at: "08:30", days: [], task_id: null, active: true });
const fromReminder = (reminder: ReminderView): Draft => ({
  title: reminder.title,
  notes: reminder.notes,
  recurrence: reminder.recurrence,
  at: reminder.at,
  days: reminder.days,
  task_id: reminder.task_id,
  active: reminder.active,
});
const toInput = (draft: Draft): ReminderCreateInput => ({
  title: draft.title.trim(),
  notes: draft.notes,
  recurrence: draft.recurrence,
  at: draft.at,
  days: draft.recurrence === "daily" ? draft.days : [],
  task_id: draft.task_id,
  active: draft.active,
});

function formatReminder(reminder: ReminderView): string {
  if (reminder.recurrence === "once") {
    const [date, time] = reminder.at.split("T");
    return time ? `${time} · ${date}` : reminder.at;
  }
  const days = reminder.days.length ? reminder.days.map(d => WEEKDAY_NAMES[d]).join(" ") : "every day";
  return `${reminder.at} · ${days}`;
}

function setParam(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

function taskName(tasks: TaskView[], id: number | null): string {
  if (id === null) return "No task";
  return tasks.find(task => task.id === id)?.title ?? `Task #${id}`;
}
function TaskLink({ tasks, id }: { tasks: TaskView[]; id: number | null }) {
  if (id === null) return <>No task</>;
  return <Link to={`/tasks/${id}`}>{taskName(tasks, id)}</Link>;
}


function ScheduleEditor({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const setRecurrence = (recurrence: Recurrence) => onChange({ ...draft, recurrence, at: recurrence === "once" ? "" : "08:30", days: [] });
  const toggleDay = (day: number) => {
    const days = draft.days.includes(day) ? draft.days.filter(d => d !== day) : [...draft.days, day].sort();
    onChange({ ...draft, days });
  };

  return <>
    <label>Recurrence
      <select value={draft.recurrence} onChange={event => setRecurrence(event.target.value as Recurrence)}>
        <option value="daily">Daily</option>
        <option value="once">Once</option>
      </select>
    </label>
    {draft.recurrence === "once" ? (
      <label>When<input type="datetime-local" value={draft.at} onChange={event => onChange({ ...draft, at: event.target.value })} required /></label>
    ) : (
      <div className="reminder-row-edit">
        <label>Time<input type="time" value={draft.at} onChange={event => onChange({ ...draft, at: event.target.value })} required /></label>
        <div className="weekday-toggles" aria-label="Reminder weekdays">
          {WEEKDAY_LABELS.map((label, day) => (
            <button type="button" key={day} className={`weekday-toggle ${draft.days.includes(day) ? "active" : ""}`} onClick={() => toggleDay(day)}>{label}</button>
          ))}
        </div>
      </div>
    )}
  </>;
}

function ReminderForm({ draft, tasks, submitLabel, onChange, onSubmit, onCancel }: { draft: Draft; tasks: TaskView[]; submitLabel: string; onChange: (draft: Draft) => void; onSubmit: () => void; onCancel?: () => void }) {
  return (
    <div className="simple-form" style={{ maxWidth: "none" }}>
      <label>Title<input value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} required /></label>
      <label>Notes<textarea value={draft.notes} onChange={event => onChange({ ...draft, notes: event.target.value })} /></label>
      <ScheduleEditor draft={draft} onChange={onChange} />
      <label>Task
        <select value={draft.task_id ?? ""} onChange={event => onChange({ ...draft, task_id: event.target.value ? Number(event.target.value) : null })}>
          <option value="">No task</option>
          {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
        </select>
      </label>
      <label><input type="checkbox" checked={draft.active} onChange={event => onChange({ ...draft, active: event.target.checked })} /> Active</label>
      <div className="page-actions">
        <button type="button" className="primary" onClick={onSubmit}>{submitLabel}</button>
        {onCancel ? <button type="button" className="secondary" onClick={onCancel}>Cancel</button> : null}
      </div>
    </div>
  );
}

export default function Reminders() {
  const [params, setParams] = useSearchParams();
  const [today, setToday] = useState<ReminderView[]>([]);
  const [all, setAll] = useState<ReminderView[]>([]);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [error, setError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft);
  const [pendingDelete, setPendingDelete] = useState<ReminderView[]>([]);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (pendingDelete.length) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [pendingDelete]);

  const query = params.get("q") ?? "";
  const activeFilter = params.get("active") ?? "";
  const recurrenceFilter = params.get("recurrence") ?? "";
  const statusFilter = params.get("status") ?? "";
  const sort = (params.get("sort") as ReminderSort | null) ?? "time";

  const load = () => {
    setError(null);
    Promise.all([getTodayReminders(), listReminders(true), listTasks(true)])
      .then(([todayResult, allResult, taskResult]) => {
        setToday(todayResult.reminders);
        setAll(allResult.reminders);
        setTasks(taskResult.tasks);
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  };
  useEffect(load, []);

  const visibleReminders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all
      .filter(reminder => !activeFilter || (activeFilter === "active" ? reminder.active : !reminder.active))
      .filter(reminder => !recurrenceFilter || reminder.recurrence === recurrenceFilter)
      .filter(reminder => !statusFilter || (statusFilter === "complete" ? reminder.completed_today : !reminder.completed_today))
      .filter(reminder => !needle || [reminder.title, reminder.notes, taskName(tasks, reminder.task_id)].some(value => value.toLowerCase().includes(needle)))
      .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : a.at.localeCompare(b.at) || a.title.localeCompare(b.title));
  }, [activeFilter, all, query, recurrenceFilter, sort, statusFilter, tasks]);

  const selection = useSelection(visibleReminders.map(reminder => reminder.id));
  const selectedReminders = visibleReminders.filter(reminder => selection.selected.has(reminder.id));

  const mutate = (action: () => Promise<unknown>) => action().then(() => { load(); }).catch(err => setError(err instanceof Error ? err.message : String(err)));
  const toggle = (reminder: ReminderView) => void mutate(() => reminder.completed_today ? uncompleteReminder(reminder.id) : completeReminder(reminder.id));

  const submit = () => {
    if (!draft.title.trim()) return;
    createReminder(toInput(draft))
      .then(() => { setDraft(blankDraft()); load(); })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  };
  const startEdit = (reminder: ReminderView) => { setEditingId(reminder.id); setEditDraft(fromReminder(reminder)); };
  const saveEdit = (id: number) => {
    if (!editDraft.title.trim()) return;
    patchReminder(id, toInput(editDraft))
      .then(() => { setEditingId(null); load(); })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  };
  const removeReminder = (reminder: ReminderView) => setPendingDelete([reminder]);

  const runBulk = (label: string, action: (reminder: ReminderView) => Promise<unknown>, targets = selectedReminders) => {
    if (!targets.length || bulkBusy) return;
    setBulkBusy(true);
    setBulkMessage(null);
    Promise.allSettled(targets.map(action))
      .then(results => {
        const failed = results.filter(result => result.status === "rejected").length;
        const succeeded = results.length - failed;
        setBulkMessage(failed ? `${label}: ${succeeded} succeeded, ${failed} failed.` : `${label}: updated ${succeeded} reminder${succeeded === 1 ? "" : "s"}.`);
        selection.clear();
        load();
      })
      .finally(() => setBulkBusy(false));
  };
  const deleteSelected = () => setPendingDelete(selectedReminders);

  return (
    <div>
      <div className="page-header"><h1>Reminders</h1></div>
      {error ? <p className="operational-error" role="alert">{error}</p> : null}
      <dialog ref={deleteDialog} className="modal-panel" aria-labelledby="delete-reminders-title" onCancel={() => setPendingDelete([])}>
        <h2 id="delete-reminders-title">Delete {pendingDelete.length === 1 ? "reminder" : "reminders"}?</h2>
        <p>{pendingDelete.length === 1 ? pendingDelete[0]?.title : `${pendingDelete.length} selected reminders`}</p>
        <p>This removes the reminders only. Linked tasks are kept.</p>
        <div className="page-actions">
          <button type="button" className="secondary" autoFocus onClick={() => setPendingDelete([])}>Cancel</button>
          <button type="button" className="danger" disabled={bulkBusy} onClick={() => {
            runBulk("Delete", reminder => deleteReminder(reminder.id), pendingDelete);
            setPendingDelete([]);
          }}>Confirm delete</button>
        </div>
      </dialog>

      <h2>Today</h2>
      {today.length ? today.map(reminder => (
        <label className="reminder-row" key={reminder.id}>
          <input type="checkbox" className="done-check" checked={reminder.completed_today} onChange={() => toggle(reminder)} />
          <span>{reminder.title}</span>
          {reminder.task_id !== null ? <span className="kind"><TaskLink tasks={tasks} id={reminder.task_id} /></span> : null}
          <StreakBadge streak={reminder.streak} recurrence={reminder.recurrence} compact />
        </label>
      )) : <p style={{ color: "var(--text2)" }}>Nothing due today.</p>}
      {today.length && today.every(reminder => reminder.completed_today) ? <AllDone /> : null}
      <h2 style={{ marginTop: "1.5rem" }}>Add reminder</h2>
      <form className="simple-form" onSubmit={event => { event.preventDefault(); submit(); }}>
        <ReminderForm draft={draft} tasks={tasks} submitLabel="Add reminder" onChange={setDraft} onSubmit={submit} />
      </form>

      <h2 style={{ marginTop: "1.5rem" }}>All reminders</h2>
      <CollectionToolbar query={query} onQueryChange={value => setParams(setParam(params, "q", value))} sort={sort} onSortChange={value => setParams(setParam(params, "sort", value))} sortOptions={SORT_OPTIONS}>
        <label>Active<select value={activeFilter} onChange={event => setParams(setParam(params, "active", event.target.value))}><option value="">Active and inactive</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <label>Recurrence<select value={recurrenceFilter} onChange={event => setParams(setParam(params, "recurrence", event.target.value))}><option value="">Daily and once</option><option value="daily">Daily</option><option value="once">Once</option></select></label>
        <label>Status<select value={statusFilter} onChange={event => setParams(setParam(params, "status", event.target.value))}><option value="">Any status</option><option value="open">Open today</option><option value="complete">Complete today</option></select></label>
      </CollectionToolbar>

      <SelectionBar count={selection.selected.size} total={visibleReminders.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={bulkBusy}>
        <button type="button" className="secondary" onClick={() => runBulk("Complete", reminder => completeReminder(reminder.id))} disabled={!selection.selected.size || bulkBusy}>Complete</button>
        <button type="button" className="secondary" onClick={() => runBulk("Reopen", reminder => uncompleteReminder(reminder.id))} disabled={!selection.selected.size || bulkBusy}>Reopen</button>
        <button type="button" className="secondary" onClick={() => runBulk("Activate", reminder => patchReminder(reminder.id, { active: true }))} disabled={!selection.selected.size || bulkBusy}>Activate</button>
        <button type="button" className="secondary" onClick={() => runBulk("Deactivate", reminder => patchReminder(reminder.id, { active: false }))} disabled={!selection.selected.size || bulkBusy}>Deactivate</button>
        <button type="button" className="danger" onClick={deleteSelected} disabled={!selection.selected.size || bulkBusy}>Delete</button>
      </SelectionBar>
      {bulkMessage ? <p className={bulkMessage.includes("failed") ? "operational-error" : "operational-status"}>{bulkMessage}</p> : null}

      <table className="data-table">
        <thead><tr><th><span className="sr-only">Select</span></th><th>Title</th><th>Task</th><th>Recurrence</th><th>Reminder</th><th>Status</th><th>Streak</th><th></th></tr></thead>
        <tbody>
          {visibleReminders.map(reminder => editingId === reminder.id ? (
            <tr key={reminder.id} className={selection.selected.has(reminder.id) ? "is-selected" : ""}>
              <td><input type="checkbox" checked={selection.selected.has(reminder.id)} onChange={() => selection.toggle(reminder.id)} aria-label={`Select ${reminder.title}`} /></td>
              <td colSpan={7}><ReminderForm draft={editDraft} tasks={tasks} submitLabel="Save" onChange={setEditDraft} onSubmit={() => saveEdit(reminder.id)} onCancel={() => setEditingId(null)} /></td>
            </tr>
          ) : (
            <tr key={reminder.id} className={selection.selected.has(reminder.id) ? "is-selected" : ""}>
              <td><input type="checkbox" checked={selection.selected.has(reminder.id)} onChange={() => selection.toggle(reminder.id)} aria-label={`Select ${reminder.title}`} /></td>
              <td><strong>{reminder.title}</strong>{reminder.notes ? <div className="reminder-notes"><MarkdownContent text={reminder.notes} /></div> : null}</td>
              <td><TaskLink tasks={tasks} id={reminder.task_id} /></td>
              <td><span className="kind">{reminder.recurrence.toUpperCase()}</span></td>
              <td>{formatReminder(reminder)}</td>
              <td>{reminder.active ? (reminder.completed_today ? "Complete today" : "Open today") : "Inactive"}</td>
              <td>{reminder.streak}</td>
              <td className="page-actions"><button type="button" className="secondary" onClick={() => startEdit(reminder)}>Edit</button><button type="button" className="danger" onClick={() => removeReminder(reminder)}>Delete</button></td>
            </tr>
          ))}
          {!visibleReminders.length ? <tr><td colSpan={8} className="empty-table-cell">No reminders match the current filters.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
