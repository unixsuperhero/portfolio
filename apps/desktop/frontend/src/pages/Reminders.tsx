import { useEffect, useState } from "react";
import type { Completion, Recurrence, TaskView } from "../types.ts";
import { completeTask, createTask, deleteTask, getTask, getTodayReminders, listTasks, patchTask, uncompleteTask } from "../api.ts";

type ReminderRow = { at: string; days: number[] };

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const blankRow = (recurrence: Recurrence): ReminderRow => ({ at: recurrence === "once" ? "" : "08:30", days: [] });

function formatReminder(r: { at: string; days: number[] }, recurrence: Recurrence): string {
  if (recurrence === "once") {
    const [date, time] = r.at.split("T");
    return time ? `${time} · ${date}` : r.at;
  }
  const days = r.days.length ? r.days.map(d => WEEKDAY_NAMES[d]).join(" ") : "every day";
  return `${r.at} · ${days}`;
}

/** Per-row editor: a time + weekday toggles for daily reminders, a datetime-local for once. */
function ReminderRowsEditor({ recurrence, rows, onChange }: { recurrence: Recurrence; rows: ReminderRow[]; onChange: (rows: ReminderRow[]) => void }) {
  const update = (index: number, patch: Partial<ReminderRow>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const toggleDay = (index: number, day: number) => {
    const row = rows[index];
    const days = row.days.includes(day) ? row.days.filter(d => d !== day) : [...row.days, day].sort();
    update(index, { days });
  };

  return (
    <div className="reminder-rows-editor">
      {rows.map((row, index) => (
        <div className="reminder-row-edit" key={index}>
          {recurrence === "once" ? (
            <input type="datetime-local" value={row.at} onChange={event => update(index, { at: event.target.value })} />
          ) : (
            <>
              <input type="time" value={row.at} onChange={event => update(index, { at: event.target.value })} />
              <div className="weekday-toggles">
                {WEEKDAY_LABELS.map((label, day) => (
                  <button
                    type="button"
                    key={day}
                    className={`weekday-toggle ${row.days.includes(day) ? "active" : ""}`}
                    onClick={() => toggleDay(index, day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" className="secondary" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove</button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...rows, blankRow(recurrence)])}>Add reminder</button>
    </div>
  );
}

function TaskHistory({ id }: { id: number }) {
  const [history, setHistory] = useState<Completion[] | null>(null);
  return (
    <details onToggle={event => { if ((event.target as HTMLDetailsElement).open && !history) getTask(id).then(t => setHistory(t.history)).catch(() => setHistory([])); }}>
      <summary>History</summary>
      {history ? (history.length ? <ul>{history.map(c => <li key={c.id}>{c.on}</li>)}</ul> : <p>No completions yet.</p>) : <p>Loading…</p>}
    </details>
  );
}

export default function Reminders() {
  const [today, setToday] = useState<TaskView[]>([]);
  const [all, setAll] = useState<TaskView[]>([]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("daily");
  const [rows, setRows] = useState<ReminderRow[]>([blankRow("daily")]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRecurrence, setEditRecurrence] = useState<Recurrence>("daily");
  const [editRows, setEditRows] = useState<ReminderRow[]>([]);

  const load = () => {
    getTodayReminders().then(({ tasks }) => setToday(tasks)).catch(() => {});
    listTasks(true).then(({ tasks }) => setAll(tasks)).catch(() => {});
  };
  useEffect(load, []);

  const toggle = (task: TaskView) => (task.completed_today ? uncompleteTask(task.id) : completeTask(task.id)).then(load).catch(() => {});

  const changeRecurrence = (value: Recurrence) => { setRecurrence(value); setRows([blankRow(value)]); };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const reminders = recurrence === "once"
      ? rows.map(r => r.at).filter(Boolean)
      : rows.filter(r => r.at).map(r => ({ at: r.at, days: r.days }));
    createTask({ title: title.trim(), notes, recurrence, reminders }).then(() => {
      setTitle("");
      setNotes("");
      setRows([blankRow(recurrence)]);
      load();
    }).catch(() => {});
  };

  const startEdit = (task: TaskView) => {
    setEditingId(task.id);
    setEditRecurrence(task.recurrence);
    setEditRows(task.reminders.length ? task.reminders.map(r => ({ at: r.at, days: r.days })) : [blankRow(task.recurrence)]);
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = (id: number) => {
    const reminders = editRecurrence === "once"
      ? editRows.map(r => r.at).filter(Boolean)
      : editRows.filter(r => r.at).map(r => ({ at: r.at, days: r.days }));
    patchTask(id, { recurrence: editRecurrence, reminders }).then(() => { setEditingId(null); load(); }).catch(() => {});
  };

  return (
    <div>
      <div className="page-header"><h1>Reminders</h1></div>

      <h2>Today</h2>
      {today.length ? today.map(task => (
        <label className="reminder-row" key={task.id}>
          <input type="checkbox" checked={task.completed_today} onChange={() => toggle(task)} />
          <span>{task.title}</span>
          {task.streak > 0 ? <span className="streak">🔥{task.streak}</span> : null}
        </label>
      )) : <p style={{ color: "var(--text2)" }}>Nothing due today.</p>}

      <h2 style={{ marginTop: "1.5rem" }}>Add task</h2>
      <form className="simple-form" onSubmit={submit}>
        <label>Title<input value={title} onChange={event => setTitle(event.target.value)} required /></label>
        <label>Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <label>Recurrence
          <select value={recurrence} onChange={event => changeRecurrence(event.target.value as Recurrence)}>
            <option value="daily">Daily</option>
            <option value="once">Once</option>
          </select>
        </label>
        <ReminderRowsEditor recurrence={recurrence} rows={rows} onChange={setRows} />
        <button className="primary" type="submit">Add task</button>
      </form>

      <h2 style={{ marginTop: "1.5rem" }}>All tasks</h2>
      <table className="data-table">
        <thead><tr><th>Title</th><th>Recurrence</th><th>Reminders</th><th>Streak</th><th></th></tr></thead>
        <tbody>
          {all.map(task => (
            editingId === task.id ? (
              <tr key={task.id}>
                <td colSpan={5}>
                  <div className="simple-form" style={{ maxWidth: "none" }}>
                    <label>Recurrence
                      <select value={editRecurrence} onChange={event => { const v = event.target.value as Recurrence; setEditRecurrence(v); setEditRows([blankRow(v)]); }}>
                        <option value="daily">Daily</option>
                        <option value="once">Once</option>
                      </select>
                    </label>
                    <ReminderRowsEditor recurrence={editRecurrence} rows={editRows} onChange={setEditRows} />
                    <div className="page-actions">
                      <button type="button" className="primary" onClick={() => saveEdit(task.id)}>Save</button>
                      <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={task.id}>
                <td>{task.title}<TaskHistory id={task.id} /></td>
                <td><span className="kind">{task.recurrence.toUpperCase()}</span></td>
                <td>{task.reminders.map(r => formatReminder(r, task.recurrence)).join(", ") || "—"}</td>
                <td>{task.streak}</td>
                <td className="page-actions">
                  <button type="button" className="secondary" onClick={() => startEdit(task)}>Edit</button>
                  <button type="button" className="danger" onClick={() => deleteTask(task.id).then(load)}>Delete</button>
                </td>
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
  );
}
