import { useState } from "react";
import { renderMarkdown } from "../lib/markdown.ts";
import { updateCard } from "../api.ts";

export function NoteCard({ cardId, text, title, onSaved }: { cardId: number; text: string; title: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const save = () => {
    updateCard(cardId, { title, kind: "note", config: { text: draft } } as any)
      .then(() => { setEditing(false); onSaved(); })
      .catch(() => {});
  };

  if (editing) {
    return (
      <div className="note-edit">
        <textarea value={draft} onChange={event => setDraft(event.target.value)} />
        <div className="page-actions" style={{ marginTop: "0.4rem" }}>
          <button type="button" className="primary" onClick={save}>Save</button>
          <button type="button" className="secondary" onClick={() => { setDraft(text); setEditing(false); }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="note-render" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      <button type="button" className="secondary" onClick={() => setEditing(true)}>Edit</button>
    </div>
  );
}
