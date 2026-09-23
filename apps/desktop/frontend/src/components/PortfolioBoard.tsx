import { useState } from "react";
import { CardEditor } from "@portfolio/ui";
import { CARD_KINDS } from "@portfolio/core";
import type { CardKind, CardSpec } from "@portfolio/core";
import type { PortfolioView } from "../types.ts";
import { createCard, deleteCard, moveCard, updateCard } from "../api.ts";
import { DashboardCard } from "../cards/DashboardCard.tsx";
import { CardKindEditor } from "../cards/CardKindEditor.tsx";

/** The grid of cards for a portfolio (used by both the Home page and /portfolios/:id), plus
 * the "+ Add card" panel and per-card edit/move/delete. */
export function PortfolioBoard({ portfolio, reload }: { portfolio: PortfolioView; reload: () => void }) {
  const [addKind, setAddKind] = useState<CardKind>("query");

  const saveCard = (id: number, patch: { title: string; kind?: CardKind; config?: Record<string, unknown> } & Partial<CardSpec>) =>
    updateCard(id, patch as any).then(reload).catch(() => {});

  const move = (id: number, direction: "left" | "right") => moveCard(id, direction).then(reload).catch(() => {});
  const remove = (id: number) => deleteCard(id).then(reload).catch(() => {});

  const addQueryCard = (spec: CardSpec) => createCard(portfolio.id, spec).then(reload).catch(() => {});
  const addKindCard = () => createCard(portfolio.id, { title: "New card", kind: addKind, config: {} } as any).then(reload).catch(() => {});

  return (
    <div className="portfolio-grid">
      {portfolio.cards.map(card => (
        <DashboardCard
          key={card.id}
          card={card}
          onChanged={reload}
          footer={
            card.kind === "query" ? (
              <CardEditor value={card} onSubmit={spec => saveCard(card.id, spec)} onMove={direction => move(card.id, direction)} onDelete={() => remove(card.id)} />
            ) : (
              <CardKindEditor card={card} onSubmit={patch => saveCard(card.id, patch)} onMove={direction => move(card.id, direction)} onDelete={() => remove(card.id)} />
            )
          }
        />
      ))}
      <section className="rail-section portfolio-card">
        <header><h2>+ Add card</h2></header>
        <div className="card-body field-row">
          <label>Kind
            <select value={addKind} onChange={event => setAddKind(event.target.value as CardKind)}>
              {CARD_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </label>
          <button type="button" className="primary" onClick={addKindCard}>Add card</button>
        </div>
        {addKind === "query" ? <CardEditor open summary="Query details" onSubmit={addQueryCard} submitLabel="Add query card" /> : null}
      </section>
    </div>
  );
}
