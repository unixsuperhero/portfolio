import { useCallback, useEffect, useRef, useState } from "react";
import type { DueReminder } from "../types.ts";
import { completeTask, getDueReminders } from "../api.ts";
import { notify } from "../native.ts";

export interface DueToast extends DueReminder {}

/**
 * Polls GET /api/reminders/due every 60s and notifies (native notification + in-app toast)
 * for each due reminder not yet notified this session. Never navigates, resets a form, or
 * scrolls — it only ever appends to its own toast list.
 */
export function useReminderPolling() {
  const [toasts, setToasts] = useState<DueToast[]>([]);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    let live = true;
    const check = () => {
      getDueReminders(1)
        .then(({ due }) => {
          if (!live) return;
          const fresh = due.filter(item => !seen.current.has(item.reminder.id));
          if (!fresh.length) return;
          fresh.forEach(item => {
            seen.current.add(item.reminder.id);
            void notify(item.task.title, item.task.notes || "Reminder");
          });
          setToasts(current => [...current, ...fresh]);
        })
        .catch(() => {});
    };
    check();
    const id = setInterval(check, 60_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const dismiss = useCallback((reminderId: number) => {
    setToasts(current => current.filter(item => item.reminder.id !== reminderId));
  }, []);

  const complete = useCallback((toast: DueToast) => {
    completeTask(toast.task.id).catch(() => {}).finally(() => dismiss(toast.reminder.id));
  }, [dismiss]);

  return { toasts, dismiss, complete };
}
