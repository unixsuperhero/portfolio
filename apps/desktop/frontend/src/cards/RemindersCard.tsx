import { useEffect, useRef, useState } from "react";
import type { ReminderView } from "../types.ts";
import { completeReminder, getTodayReminders, listReminders, listTasks, uncompleteReminder } from "../api.ts";
import { AllDone, StreakBadge } from "../components/Completion.tsx";

export function RemindersCard({ scope = "today", scopeActive, scopeItemIds }: { scope?: "today" | "all"; scopeActive: boolean; scopeItemIds: number[] }) {
  const [reminders, setReminders] = useState<ReminderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = () => {
    const currentRequest = ++requestId.current;
    setError(null);
    Promise.all([scope === "all" ? listReminders() : getTodayReminders(), listTasks(true)])
      .then(([reminderResult, taskResult]) => {
        if (currentRequest !== requestId.current) return;
        const taskItemIds = new Map(taskResult.tasks.map(task => [task.id, task.item_id]));
        setReminders(scopeActive
          ? reminderResult.reminders.filter(reminder => reminder.task_id !== null && scopeItemIds.includes(taskItemIds.get(reminder.task_id) ?? -1))
          : reminderResult.reminders);
      })
      .catch(err => {
        if (currentRequest !== requestId.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setReminders([]);
      });
  };

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [scope, scopeActive, scopeItemIds]);

  const toggle = (reminder: ReminderView) => {
    const call = reminder.completed_today ? uncompleteReminder(reminder.id) : completeReminder(reminder.id);
    call.then(load).catch(err => setError(err instanceof Error ? err.message : String(err)));
  };

  if (reminders === null) return <div className="empty"><strong>Loading…</strong></div>;
  if (error) return <div className="empty"><strong>{error}</strong></div>;
  if (!reminders.length) return <div className="empty"><strong>Nothing due.</strong></div>;
  return (
    <div>
      {reminders.map(reminder => (
        <label className="reminder-row" key={reminder.id}>
          <input type="checkbox" className="done-check" checked={reminder.completed_today} onChange={() => toggle(reminder)} />
          <span>{reminder.title}</span>
          <StreakBadge streak={reminder.streak} recurrence={reminder.recurrence} compact />
        </label>
      ))}
      {reminders.every(reminder => reminder.completed_today) ? <AllDone /> : null}
    </div>
  );
}
