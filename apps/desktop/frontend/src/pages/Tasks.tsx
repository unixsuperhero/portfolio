import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { TaskView } from "@portfolio/core";
import { completeTask, createTask, deleteTask, listTasks, patchTask, uncompleteTask } from "../api.ts";

type Draft = { id: number | null; title: string; notes: string; parent_id: number | null };
const blank = (parent_id: number | null = null): Draft => ({ id: null, title: "", notes: "", parent_id });

export default function Tasks({ taskId, onChange }: { taskId?: number; onChange?: () => void }) {
  const params = useParams();
  const selectedId = taskId ?? (params.taskId ? Number(params.taskId) : undefined);
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blank(selectedId ?? null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => { const result = await listTasks(true); setTasks(result.tasks); };
  useEffect(() => {
    let live = true;
    listTasks(true).then(result => { if (live) setTasks(result.tasks); }).catch(err => { if (live) setError(String(err)); });
    setDraft(blank(selectedId ?? null));
    return () => { live = false; };
  }, [selectedId]);

  const mutate = async (action: () => Promise<unknown>, reset = false) => {
    setBusy(true);
    setError("");
    try {
      await action();
      if (reset) setDraft(blank(selectedId ?? null));
      await load();
      onChange?.();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const byId = new Map(tasks?.map(task => [task.id, task]));
  const children = new Map<number | null, TaskView[]>();
  for (const task of tasks ?? []) {
    const parent = task.parent_id !== null && byId.has(task.parent_id) ? task.parent_id : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(task);
    children.set(parent, siblings);
  }
  const selected = selectedId === undefined ? undefined : byId.get(selectedId);
  const excludedParents = new Set<number>();
  const pending = draft.id === null ? [] : [draft.id];
  while (pending.length) {
    const id = pending.pop()!;
    excludedParents.add(id);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }

  const renderTasks = (rows: TaskView[]) => (
    <ul className="task-tree">
      {rows.map(task => (
        <li key={task.id}>
          <div className="task-row">
            <input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.completed_today} disabled={busy}
              onChange={() => void mutate(() => task.completed_today ? uncompleteTask(task.id) : completeTask(task.id))} />
            <div className="task-copy">
              <Link to={`/tasks/${task.id}`} className={task.completed_today ? "task-completed" : ""}>{task.title}</Link>
              {task.notes ? <p>{task.notes}</p> : null}
              {task.recurrence === "daily" ? <small>Repeats daily</small> : null}
              {!task.active ? <small>Inactive</small> : null}
            </div>
            <div className="page-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => setDraft(blank(task.id))}>Add subtask</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setDraft({ id: task.id, title: task.title, notes: task.notes, parent_id: task.parent_id })}>Edit</button>
              <button type="button" className="danger" disabled={busy} onClick={() => {
                if (confirm(`Delete "${task.title}"? Its subtasks will become top-level tasks.`)) void mutate(async () => {
                  await deleteTask(task.id);
                  if (task.id === selectedId) navigate("/tasks");
                }, draft.id === task.id || draft.parent_id === task.id);
              }}>Delete</button>
            </div>
          </div>
          {children.has(task.id) ? renderTasks(children.get(task.id)!) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <section>
      {!taskId ? <div className="page-header"><h1>{selected?.title ?? "Tasks"}</h1><Link to="/library?type=task">View in library</Link></div> : null}
      {selectedId !== undefined ? <p><Link to="/tasks">All tasks</Link>{selected?.parent_id !== null && selected?.parent_id !== undefined ? <> / <Link to={`/tasks/${selected.parent_id}`}>{byId.get(selected.parent_id)?.title ?? "Parent task"}</Link></> : null}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <form className="simple-form field-row task-form" onSubmit={event => {
        event.preventDefault();
        const input = { title: draft.title.trim(), notes: draft.notes, parent_id: draft.parent_id };
        if (!input.title || busy) return;
        void mutate(() => draft.id === null ? createTask(input) : patchTask(draft.id, input), true);
      }}>
        <h2>{draft.id !== null ? "Edit task" : draft.parent_id !== null ? "Add subtask" : "Add task"}</h2>
        <label>Title<input required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} disabled={busy} /></label>
        <label>Notes<textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} disabled={busy} /></label>
        <label>Parent task<select value={draft.parent_id ?? ""} disabled={busy} onChange={event => setDraft({ ...draft, parent_id: event.target.value ? Number(event.target.value) : null })}>
          <option value="">None, top-level task</option>
          {(tasks ?? []).filter(task => !excludedParents.has(task.id)).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
        </select></label>
        <div className="page-actions">
          <button type="submit" className="primary" disabled={busy || !draft.title.trim()}>{busy ? "Saving…" : draft.id !== null ? "Save task" : draft.parent_id !== null ? "Add subtask" : "Add task"}</button>
          {draft.id !== null || draft.parent_id !== null ? <button type="button" className="secondary" disabled={busy} onClick={() => setDraft(blank())}>Cancel</button> : null}
        </div>
      </form>
      <h2 style={{ marginTop: "1.5rem" }}>{selected ? "Task and subtasks" : "All tasks"}</h2>
      {tasks === null ? <p>Loading tasks…</p> : selectedId !== undefined && !selected ? <p>Task not found. <Link to="/tasks">View all tasks</Link></p> : tasks.length ? renderTasks(selected ? [selected] : children.get(null) ?? []) : <p>No tasks yet. Add your first task above.</p>}
    </section>
  );
}
