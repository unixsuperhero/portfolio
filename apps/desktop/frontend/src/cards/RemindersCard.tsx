import { useEffect, useState } from "react";
import type { TaskView } from "../types.ts";
import { completeTask, getTodayReminders, listTasks, uncompleteTask } from "../api.ts";

export function RemindersCard({ scope = "today" }: { scope?: "today" | "all" }) {
  const [tasks, setTasks] = useState<TaskView[] | null>(null);

  const load = () => {
    (scope === "all" ? listTasks() : getTodayReminders())
      .then(result => setTasks("tasks" in result ? result.tasks : []))
      .catch(() => setTasks([]));
  };

  useEffect(() => { load(); }, [scope]);

  const toggle = (task: TaskView) => {
    const call = task.completed_today ? uncompleteTask(task.id) : completeTask(task.id);
    call.then(load).catch(() => {});
  };

  if (tasks === null) return <div className="empty"><strong>Loading…</strong></div>;
  if (!tasks.length) return <div className="empty"><strong>Nothing due.</strong></div>;
  return (
    <div>
      {tasks.map(task => (
        <label className="reminder-row" key={task.id}>
          <input type="checkbox" checked={task.completed_today} onChange={() => toggle(task)} />
          <span>{task.title}</span>
          {task.recurrence === "daily" && task.streak > 0 ? <span className="streak">🔥{task.streak}</span> : null}
        </label>
      ))}
    </div>
  );
}
