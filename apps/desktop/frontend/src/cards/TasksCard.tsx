import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { TagList } from "@portfolio/ui";
import type { ItemView, TaskView } from "@portfolio/core";
import { completeTask, listItems, listTasks, uncompleteTask } from "../api.ts";
import { MarkdownContent } from "../components/MarkdownContent.tsx";
import { AllDone, StreakBadge } from "../components/Completion.tsx";
import "../pages/Tasks.css";

export function TasksCard({ scopeActive, scopeItemIds }: { scopeActive: boolean; scopeItemIds: number[] }) {
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [items, setItems] = useState<ItemView[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    listTasks().then(async taskResult => {
      const itemResult = await listItems({ type: "task", limit: Math.max(taskResult.tasks.length, 1) });
      if (!live) return;
      setTasks(scopeActive ? taskResult.tasks.filter(task => task.item_id !== null && scopeItemIds.includes(task.item_id)) : taskResult.tasks);
      setItems(itemResult.items);
    }).catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [scopeActive, scopeItemIds]);

  const toggle = async (task: TaskView) => {
    setPending(task.id);
    setError("");
    try {
      const updated = await (task.completed_today ? uncompleteTask(task.id) : completeTask(task.id));
      setTasks(current => current?.map(item => item.id === updated.id ? updated : item) ?? null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(null); }
  };

  const itemById = useMemo(() => new Map(items.map(item => [item.task_id, item])), [items]);
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
      {(children.get(parent) ?? []).map(task => {
        const tags = itemById.get(task.id)?.tags ?? [];
        return (
          <li key={task.id}>
            <div className="reminder-row tasks-card-row">
              <input type="checkbox" className="done-check" aria-label={`${task.completed_today ? "Reopen" : "Complete"} ${task.title}`} checked={task.completed_today} disabled={pending !== null} onChange={() => void toggle(task)} />
              <div className="task-copy">
                <Link to={`/tasks/${task.id}`} className={task.completed_today ? "task-completed" : ""}>{task.title}</Link>
                <StreakBadge streak={task.streak} recurrence={task.recurrence} compact />
                {task.notes ? <MarkdownContent text={task.notes} /> : null}
                <TagList tags={tags} hrefFor={name => `#/tasks?tag=${encodeURIComponent(name)}`} />
              </div>
            </div>
            {children.has(task.id) ? rows(task.id) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      {tasks === null ? (!error ? <p>Loading tasks…</p> : null) : tasks.length ? rows(null) : <p>No tasks yet.</p>}
      {tasks?.length && tasks.every(task => task.completed_today) ? <AllDone /> : null}
      <Link to="/tasks">Manage tasks</Link>
    </div>
  );
}
