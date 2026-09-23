import { useState } from "react";
import { MarkdownContent } from "../components/MarkdownContent.tsx";
import { updateCard } from "../api.ts";

export function NoteCard({ cardId, text, title, onSaved }: { cardId: number; text: string; title: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = () => {
    setSaving(true);
    setError("");
    updateCard(cardId, { title, kind: "note", config: { text: draft } })
      .then(() => { setEditing(false); onSaved(); })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  if (editing) {
    return (
      <div className="note-edit">
        <label>Markdown<textarea value={draft} onChange={event => setDraft(event.target.value)} disabled={saving} /></label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="page-actions" style={{ marginTop: "0.4rem" }}>
          <button type="button" className="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" className="secondary" disabled={saving} onClick={() => { setDraft(text); setEditing(false); }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <MarkdownContent text={text} />
      <button type="button" className="secondary" onClick={() => { setDraft(text); setError(""); setEditing(true); }}>Edit</button>
    </div>
  );
}
