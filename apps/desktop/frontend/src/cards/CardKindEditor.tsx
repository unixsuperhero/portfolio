import { useState } from "react";
import { CARD_KINDS } from "@portfolio/core";
import type { CardKind } from "@portfolio/core";
import type { PortfolioCardResult } from "../types.ts";
import type { PrList } from "../types.ts";

// "prs" isn't in @portfolio/core's CARD_KINDS yet (the backend agent is adding it); extend the
// dropdown locally so the kind is selectable ahead of that landing.
const ALL_CARD_KINDS: readonly CardKind[] = [...CARD_KINDS, "prs" as CardKind];

/** Small form for non-query card kinds: title, kind, and either a raw JSON config textarea or,
 * for the "prs" kind, a friendly "which list" select. */
export function CardKindEditor({ card, onSubmit, onMove, onDelete }: { card: PortfolioCardResult; onSubmit: (patch: { title: string; kind: CardKind; config: Record<string, unknown> }) => void; onMove?: (direction: "left" | "right") => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [kind, setKind] = useState<CardKind>(card.kind);
  const [configText, setConfigText] = useState(JSON.stringify(card.config ?? {}, null, 2));
  const [prList, setPrList] = useState<PrList>((card.config?.list as PrList) ?? "mine");
  const [error, setError] = useState<string | null>(null);
  const isPrs = (kind as CardKind | "prs") === "prs";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isPrs) {
      setError(null);
      onSubmit({ title, kind, config: { list: prList } });
      return;
    }
    try {
      const config = configText.trim() ? JSON.parse(configText) : {};
      setError(null);
      onSubmit({ title, kind, config });
    } catch {
      setError("Config must be valid JSON.");
    }
  };

  return (
    <details className="card-edit">
      <summary>Edit card</summary>
      <form className="card-form" onSubmit={submit}>
        <label>Title<input value={title} onChange={event => setTitle(event.target.value)} required /></label>
        <label>Kind
          <select value={kind} onChange={event => setKind(event.target.value as CardKind)}>
            {ALL_CARD_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        {isPrs ? (
          <label>List
            <select value={prList} onChange={event => setPrList(event.target.value as PrList)}>
              <option value="mine">Mine</option>
              <option value="review_requested">Review requested</option>
              <option value="watched">Watched</option>
            </select>
          </label>
        ) : (
          <label>Config (JSON)<textarea value={configText} onChange={event => setConfigText(event.target.value)} rows={4} /></label>
        )}
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        <button className="primary" type="submit">Save card</button>
        {(onMove || onDelete) ? (
          <div className="card-actions">
            <div>{onMove ? <><button type="button" onClick={() => onMove("left")}>←</button><button type="button" onClick={() => onMove("right")}>→</button></> : null}</div>
            <div>{onDelete ? <button type="button" className="danger" onClick={onDelete}>Delete card</button> : null}</div>
          </div>
        ) : null}
      </form>
    </details>
  );
}
