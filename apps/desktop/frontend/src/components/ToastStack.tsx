import type { DueToast } from "../hooks/useReminderPolling.ts";

export function ToastStack({ toasts, onDismiss, onComplete }: { toasts: DueToast[]; onDismiss: (reminderId: number) => void; onComplete: (toast: DueToast) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map(toast => (
        <div className="toast-card" key={toast.reminder.id}>
          <strong>{toast.task.title}</strong>
          {toast.task.notes ? <p>{toast.task.notes}</p> : null}
          <div className="page-actions">
            <button type="button" className="primary" onClick={() => onComplete(toast)}>Done</button>
            <button type="button" className="secondary" onClick={() => onDismiss(toast.reminder.id)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
