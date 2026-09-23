import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { DueToast } from "../hooks/useReminderPolling.ts";

const keyOf = (toast: DueToast) => `${toast.reminder.id}:${toast.due_at}`;

export function ToastStack({ toasts, onDismiss, onComplete }: { toasts: DueToast[]; onDismiss: (reminderId: number, dueAt?: string) => void; onComplete: (toast: DueToast) => void }) {
  // Done fires the completion at once; the card settles out while the request is in flight.
  // If the request fails the card is still in the list, so it is shown again after a moment.
  const [settled, setSettled] = useState<Set<string>>(() => new Set());
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!toasts.length) return null;

  const complete = (toast: DueToast) => {
    const key = keyOf(toast);
    setSettled(current => new Set(current).add(key));
    onComplete(toast);
    timers.current.push(window.setTimeout(() => setSettled(current => { const next = new Set(current); next.delete(key); return next; }), 1500));
  };

  return (
    <div className="toast-stack">
      {toasts.map(toast => (
        <div className={`toast-card${settled.has(keyOf(toast)) ? " settled" : ""}`} key={keyOf(toast)}>
          <strong>{toast.reminder.title}</strong>
          {toast.reminder.notes ? <p>{toast.reminder.notes}</p> : null}
          {toast.reminder.task_id !== null ? <p className="toast-meta"><Link to={`/tasks/${toast.reminder.task_id}`}>Linked task</Link></p> : null}
          <div className="page-actions">
            <button type="button" className="primary" onClick={() => complete(toast)}>Done</button>
            <button type="button" className="secondary" onClick={() => onDismiss(toast.reminder.id, toast.due_at)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
