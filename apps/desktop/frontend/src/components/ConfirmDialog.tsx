import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  /** The question, e.g. `Delete "Stretch"?` */
  title: string;
  /** What happens and what is kept, e.g. "Its subtasks will become top-level tasks." */
  body?: string;
  /** Defaults to "Delete". */
  confirmLabel?: string;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * An in-app replacement for window.confirm, which the macOS webview never implements (the
 * call returns without showing anything, so every delete guarded by it silently did nothing).
 * Render `dialog` once in the page and await `confirm(...)` where confirm() was used:
 *
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title: `Delete "${task.title}"?`, body: "Its subtasks become top-level tasks." }))) return;
 *   ... {dialog}
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (pending) ref.current?.showModal();
    else ref.current?.close();
  }, [pending]);

  const settle = (ok: boolean) => setPending(current => { current?.resolve(ok); return null; });

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setPending(current => { current?.resolve(false); return { ...options, resolve }; });
  }), []);

  const dialog = (
    <dialog ref={ref} className="modal-panel confirm-dialog" aria-labelledby="confirm-dialog-title" onCancel={event => { event.preventDefault(); settle(false); }}>
      {pending ? (
        <>
          <h2 id="confirm-dialog-title">{pending.title}</h2>
          {pending.body ? <p>{pending.body}</p> : null}
          <div className="page-actions">
            <button type="button" className="secondary" autoFocus onClick={() => settle(false)}>Cancel</button>
            <button type="button" className="danger" onClick={() => settle(true)}>{pending.confirmLabel ?? "Delete"}</button>
          </div>
        </>
      ) : null}
    </dialog>
  );

  return { confirm, dialog };
}
