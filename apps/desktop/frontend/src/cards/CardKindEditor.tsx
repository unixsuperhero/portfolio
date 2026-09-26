import { useState } from "react";
import { CARD_KINDS, isCardKind } from "@portfolio/core/constants";
import type { CardKind } from "@portfolio/core";
import type { PortfolioCardResult } from "../types.ts";
import { PrCardFilterEditor } from "./PrCardFilterEditor.tsx";

export function CardKindEditor({ card, onSubmit, onMove, onDelete }: { card: PortfolioCardResult; onSubmit: (patch: { title: string; kind: CardKind; config: Record<string, unknown> }) => void; onMove?: (direction: "left" | "right") => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [kind, setKind] = useState<CardKind>(card.kind);
  const [configText, setConfigText] = useState(JSON.stringify(card.config ?? {}, null, 2));
  const [prQuery, setPrQuery] = useState(typeof card.config.query === "string" ? card.config.query : "");
  const [noteText, setNoteText] = useState(typeof card.config.text === "string" ? card.config.text : "");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (kind === "note" || kind === "tasks" || kind === "prs") {
      setError(null);
      const config = kind === "note" ? { ...card.config, text: noteText } : kind === "prs" ? { query: prQuery } : {};
      onSubmit({ title, kind, config });
      return;
    }
    try {
      const config: unknown = configText.trim() ? JSON.parse(configText) : {};
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error();
      setError(null);
      onSubmit({ title, kind, config: config as Record<string, unknown> });
    } catch {
      setError("Config must be a JSON object.");
    }
  };

  return (
    <details className="card-edit" onToggle={event => {
      if (!event.currentTarget.open) return;
      setTitle(card.title);
      setKind(card.kind);
      setConfigText(JSON.stringify(card.config ?? {}, null, 2));
      setPrQuery(typeof card.config.query === "string" ? card.config.query : "");
      setNoteText(typeof card.config.text === "string" ? card.config.text : "");
      setError(null);
    }}>
      <summary>Edit card</summary>
      <form className="card-form" onSubmit={submit}>
        <label>Title<input value={title} onChange={event => setTitle(event.target.value)} required /></label>
        <label>Kind
          <select value={kind} onChange={event => { if (isCardKind(event.target.value)) setKind(event.target.value); }}>
            {CARD_KINDS.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        {kind === "prs" ? <PrCardFilterEditor query={prQuery} onChange={setPrQuery} />
          : kind === "note" ? <label>Markdown<textarea value={noteText} onChange={event => setNoteText(event.target.value)} rows={8} /></label>
          : kind === "tasks" ? <p>Active tasks and subtasks, with completion checkboxes.</p>
          : <label>Config (JSON)<textarea value={configText} onChange={event => setConfigText(event.target.value)} rows={4} /></label>}
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        <button className="primary" type="submit">Save card</button>
        {(onMove || onDelete) ? <div className="card-actions">
          <div>{onMove ? <><button type="button" onClick={() => onMove("left")}>←</button><button type="button" onClick={() => onMove("right")}>→</button></> : null}</div>
          <div>{onDelete ? <button type="button" className="danger" onClick={onDelete}>Delete card</button> : null}</div>
        </div> : null}
      </form>
    </details>
  );
}
