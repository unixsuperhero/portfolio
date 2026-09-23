import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { TaskView } from "@portfolio/core";
import { completeTask, listTasks, uncompleteTask } from "../api.ts";

export function TasksCard() {
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    listTasks().then(result => { if (live) setTasks(result.tasks); })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, []);

  const toggle = async (task: TaskView) => {
    setPending(task.id);
    setError("");
    try {
      const updated = await (task.completed_today ? uncompleteTask(task.id) : completeTask(task.id));
      setTasks(current => current?.map(item => item.id === updated.id ? updated : item) ?? null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(null); }
  };

  const ids = new Set(tasks?.map(task => task.id));
  const children = new Map<number | null, TaskView[]>();
  for (const task of tasks ?? []) {
    const parent = task.parent_id !== null && ids.has(task.parent_id) ? task.parent_id : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(task);
    children.set(parent, siblings);
  }
  const rows = (parent: number | null) => (
    <ul className="tasks-card-list">
      {(children.get(parent) ?? []).map(task => (
        <li key={task.id}>
          <div className="reminder-row">
            <input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.completed_today} disabled={pending !== null} onChange={() => void toggle(task)} />
            <Link to={`/tasks/${task.id}`} className={task.completed_today ? "task-completed" : ""}>{task.title}</Link>
          </div>
          {children.has(task.id) ? rows(task.id) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      {tasks === null ? (!error ? <p>Loading tasks…</p> : null) : tasks.length ? rows(null) : <p>No tasks yet.</p>}
      <Link to="/tasks">Manage tasks</Link>
    </div>
  );
}
