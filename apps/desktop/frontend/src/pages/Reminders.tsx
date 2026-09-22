import { useEffect, useState } from "react";
import type { Completion, Recurrence, TaskView } from "../types.ts";
import { completeTask, createTask, deleteTask, getTask, getTodayReminders, listTasks, uncompleteTask } from "../api.ts";

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
  const [times, setTimes] = useState("08:30");

  const load = () => {
    getTodayReminders().then(({ tasks }) => setToday(tasks)).catch(() => {});
    listTasks(true).then(({ tasks }) => setAll(tasks)).catch(() => {});
  };
  useEffect(load, []);

  const toggle = (task: TaskView) => (task.completed_today ? uncompleteTask(task.id) : completeTask(task.id)).then(load).catch(() => {});

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const reminders = times.split(",").map(t => t.trim()).filter(Boolean);
    createTask({ title: title.trim(), notes, recurrence, reminders }).then(() => { setTitle(""); setNotes(""); setTimes("08:30"); load(); }).catch(() => {});
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
          <select value={recurrence} onChange={event => setRecurrence(event.target.value as Recurrence)}>
            <option value="daily">Daily</option>
            <option value="once">Once</option>
          </select>
        </label>
        <label>Reminder times (comma-separated, {recurrence === "daily" ? "HH:MM" : "YYYY-MM-DDTHH:MM"})<input value={times} onChange={event => setTimes(event.target.value)} /></label>
        <button className="primary" type="submit">Add task</button>
      </form>

      <h2 style={{ marginTop: "1.5rem" }}>All tasks</h2>
      <table className="data-table">
        <thead><tr><th>Title</th><th>Recurrence</th><th>Reminders</th><th>Streak</th><th></th></tr></thead>
        <tbody>
          {all.map(task => (
            <tr key={task.id}>
              <td>{task.title}<TaskHistory id={task.id} /></td>
              <td><span className="kind">{task.recurrence.toUpperCase()}</span></td>
              <td>{task.reminders.map(r => r.at).join(", ")}</td>
              <td>{task.streak}</td>
              <td><button type="button" className="danger" onClick={() => deleteTask(task.id).then(load)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
