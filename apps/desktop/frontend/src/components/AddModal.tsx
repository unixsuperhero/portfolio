import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ITEM_TYPES } from "@portfolio/core/constants";
import type { Detection, ItemType } from "@portfolio/core";
import { AddTextarea } from "./AddTextarea.tsx";
import { BrowsePicker } from "./BrowsePicker.tsx";
import { createTask, detect, quickAdd } from "../api.ts";
import { home, pickDirectory, pickFile } from "../native.ts";
import { isWails } from "../lib/wails.ts";

const TYPE_LABEL: Record<ItemType, string> = { document: "Document", note: "Note", link: "Link", pr: "PR", file: "File", dir: "Directory", task: "Task" };
type PickerKind = "file" | "dir";

const URL_SCHEME_RE = /^https?:\/\//i;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(\/\S*)?$/i;

/** True when the whole trimmed text is a link: it has an http(s) scheme, or looks like a bare
 * domain (example.com, github.com/foo/bar). */
function isLinkish(text: string): boolean {
  return URL_SCHEME_RE.test(text) || DOMAIN_RE.test(text);
}

/** Prefixes a bare domain with https:// so detect()/quickAdd() see a real URL — detect() only
 * recognizes URLs that already carry a scheme (see packages/core/src/detect.ts). */
function linkContent(text: string): string {
  return URL_SCHEME_RE.test(text) ? text : `https://${text}`;
}

type AddModalProps = {
  open: boolean;
  /** What was typed in the palette before it opened this modal, pre-filled into the textarea. */
  initialContent: string;
  onClose: () => void;
};

/**
 * The "Add…" command's dialog: free-form content, live detection (same debounce as the
 * palette), a kind override, and file/directory pickers that fill the textarea. Mirrors
 * ConfirmDialog's <dialog>/showModal() pattern so it works in the Wails webview.
 */
export function AddModal({ open, initialContent, onClose }: AddModalProps) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState(initialContent);
  const [kind, setKind] = useState<ItemType | "">("");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [browseKind, setBrowseKind] = useState<PickerKind | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setContent(initialContent);
    setKind("");
    setError("");
    setBrowseKind(null);
  }, [open, initialContent]);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  // Same live detection as the command palette, debounced the same way.
  useEffect(() => {
    const trimmed = content.trim();
    if (!trimmed) { setDetection(null); return; }
    let live = true;
    const id = setTimeout(() => {
      const probe = isLinkish(trimmed) ? linkContent(trimmed) : trimmed;
      detect(probe).then(result => { if (live) setDetection(result); }).catch(() => { if (live) setDetection(null); });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [content]);

  const submit = async () => {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "task") {
        const result = await createTask({ title: trimmed });
        onClose();
        navigate(`/tasks/${result.id}`);
        return;
      }
      const type = kind || undefined;
      const value = (type === "link" || type === "pr" || (!type && isLinkish(trimmed))) && isLinkish(trimmed) ? linkContent(trimmed) : trimmed;
      const result = await quickAdd(value, type ? { type } : {});
      onClose();
      navigate(`/items/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add.");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (pickerKind: PickerKind) => {
    if (isWails()) {
      const picked = pickerKind === "dir" ? await pickDirectory("Choose a directory", await home()) : await pickFile("Choose a file", await home());
      if (picked) setContent(picked);
      return;
    }
    setBrowseKind(pickerKind);
  };

  const detectionLine = detection ? `Detected: ${TYPE_LABEL[detection.type]} · ${detection.title}` : "";

  return (
    <dialog
      ref={ref}
      className="modal-panel add-modal"
      aria-labelledby="add-modal-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
    >
      {open ? (
        <form onSubmit={event => { event.preventDefault(); void submit(); }}>
          <h2 id="add-modal-title">Add…</h2>
          <AddTextarea value={content} onChange={setContent} autoFocus placeholder="Paste or type…" />
          <p className="add-modal-detection">{detectionLine || " "}</p>
          <label className="add-modal-kind">
            Kind
            <select value={kind} onChange={event => setKind(event.target.value as ItemType | "")}>
              <option value="">Auto</option>
              {ITEM_TYPES.map(type => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
            </select>
          </label>
          {error ? <p className="topbar-error" role="alert">{error}</p> : null}
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => void pick("file")}>Choose file…</button>
            <button type="button" className="secondary" onClick={() => void pick("dir")}>Choose directory…</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || !content.trim()}>Add</button>
          </div>
        </form>
      ) : null}
      {browseKind ? (
        <BrowsePicker kind={browseKind} onClose={() => setBrowseKind(null)} onPick={path => { setContent(path); setBrowseKind(null); }} />
      ) : null}
    </dialog>
  );
}
