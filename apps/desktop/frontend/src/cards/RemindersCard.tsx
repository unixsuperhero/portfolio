import { useEffect, useState } from "react";
import type { ReminderView } from "../types.ts";
import { completeReminder, getTodayReminders, listReminders, uncompleteReminder } from "../api.ts";

export function RemindersCard({ scope = "today" }: { scope?: "today" | "all" }) {
  const [reminders, setReminders] = useState<ReminderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    (scope === "all" ? listReminders() : getTodayReminders())
      .then(result => setReminders(result.reminders))
      .catch(err => { setError(err instanceof Error ? err.message : String(err)); setReminders([]); });
  };

  useEffect(() => { load(); }, [scope]);

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
          <input type="checkbox" checked={reminder.completed_today} onChange={() => toggle(reminder)} />
          <span>{reminder.title}</span>
          {reminder.recurrence === "daily" && reminder.streak > 0 ? <span className="streak">🔥{reminder.streak}</span> : null}
        </label>
      ))}
    </div>
  );
}
