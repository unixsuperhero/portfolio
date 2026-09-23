import { useCallback, useEffect, useRef, useState } from "react";
import type { DueReminder } from "../types.ts";
import { completeReminder, getDueReminders } from "../api.ts";
import { notify } from "../native.ts";

export interface DueToast extends DueReminder {}

const seenKey = (item: DueReminder) => `${item.reminder.id}:${item.due_at}`;

/**
 * Polls GET /api/reminders/due every 60s and notifies (native notification + in-app toast)
 * for each due reminder not yet notified this session. Never navigates, resets a form, or
 * scrolls — it only ever appends to its own toast list.
 */
export function useReminderPolling() {
  const [toasts, setToasts] = useState<DueToast[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const check = () => {
      getDueReminders(1)
        .then(({ due }) => {
          if (!live) return;
          setError(null);
          const fresh = due.filter(item => !seen.current.has(seenKey(item)));
          if (!fresh.length) return;
          fresh.forEach(item => {
            seen.current.add(seenKey(item));
            void notify(item.reminder.title, item.reminder.notes || "Reminder");
          });
          setToasts(current => [...current, ...fresh]);
        })
        .catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    };
    check();
    const id = setInterval(check, 60_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const dismiss = useCallback((reminderId: number, dueAt?: string) => {
    setToasts(current => current.filter(item => item.reminder.id !== reminderId || (dueAt !== undefined && item.due_at !== dueAt)));
  }, []);

  const complete = useCallback((toast: DueToast) => {
    completeReminder(toast.reminder.id, toast.due_at.slice(0, 10)).then(() => dismiss(toast.reminder.id, toast.due_at)).catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [dismiss]);

  return { toasts, dismiss, complete, error };
}
