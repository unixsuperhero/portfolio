import { Link } from "react-router";
import type { DueToast } from "../hooks/useReminderPolling.ts";

export function ToastStack({ toasts, onDismiss, onComplete }: { toasts: DueToast[]; onDismiss: (reminderId: number, dueAt?: string) => void; onComplete: (toast: DueToast) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map(toast => (
        <div className="toast-card" key={`${toast.reminder.id}:${toast.due_at}`}>
          <strong>{toast.reminder.title}</strong>
          {toast.reminder.notes ? <p>{toast.reminder.notes}</p> : null}
          {toast.reminder.task_id !== null ? <p className="toast-meta"><Link to={`/tasks/${toast.reminder.task_id}`}>Linked task</Link></p> : null}
          <div className="page-actions">
            <button type="button" className="primary" onClick={() => onComplete(toast)}>Done</button>
            <button type="button" className="secondary" onClick={() => onDismiss(toast.reminder.id, toast.due_at)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
