import { useState } from "react";
import { CardEditor } from "@portfolio/ui";
import { CARD_KINDS, isCardKind } from "@portfolio/core/constants";
import type { CardSpec } from "@portfolio/core";
import type { PortfolioView } from "../types.ts";
import type { CardInput } from "../api.ts";
import { createCard, deleteCard, moveCard, updateCard } from "../api.ts";
import { DashboardCard } from "../cards/DashboardCard.tsx";
import { CardKindEditor } from "../cards/CardKindEditor.tsx";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import { useConfirm } from "./ConfirmDialog.tsx";

export function PortfolioBoard({ portfolio, reload }: { portfolio: PortfolioView; reload: () => void }) {
  const [addKind, setAddKind] = useState<CardSpec["kind"]>("query");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState("position");
  const [action, setAction] = useState("query_tags");
  const [tags, setTags] = useState("");
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog } = useConfirm();
  const cards = portfolio.cards.filter(card => (!kind || card.kind === kind) && `${card.title} ${card.kind}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "kind" ? a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title) : a.position - b.position);
  const selection = useSelection(cards.map(card => card.id));
  const selected = cards.filter(card => selection.selected.has(card.id));
  const queriesOnly = selected.every(card => card.kind === "query");

  const mutate = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await work(); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const saveCard = (id: number, patch: CardInput) => mutate(() => updateCard(id, patch));
  const remove = async (id: number) => { if (await confirm({ title: "Delete this card?", body: "Its items will be kept." })) void mutate(() => deleteCard(id)); };
  const applyBulk = async () => {
    if (!selected.length || (action !== "delete" && !queriesOnly)) return;
    if (action === "delete" && !(await confirm({ title: `Delete ${selected.length} selected cards?`, body: "Their items will be kept." }))) return;
    void mutate(async () => {
      const results = await Promise.allSettled(selected.map(card => action === "delete" ? deleteCard(card.id) : updateCard(card.id, {
        title: card.title,
        ...(action === "query_tags" ? { tags: tags.split(",").map(tag => tag.trim()).filter(Boolean) } : { max_items: limit }),
      })));
      const failures = results.filter(result => result.status === "rejected");
      reload();
      if (failures.length) throw new Error(`${failures.length} cards could not be updated. ${String(failures[0]?.reason ?? "")}`);
      selection.clear();
    });
  };

  return <div>
    <CollectionToolbar query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} sortOptions={[{ value: "position", label: "Card order" }, { value: "title", label: "Title" }, { value: "kind", label: "Kind" }]}>
      <label>Kind<select value={kind} onChange={event => setKind(event.target.value)}><option value="">All kinds</option>{CARD_KINDS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </CollectionToolbar>
    <SelectionBar count={selection.selected.size} total={cards.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={busy}>
      <div className="field-row bulk-action-fields">
        <label>Card action<select value={action} onChange={event => setAction(event.target.value)} disabled={busy}><option value="query_tags">Set query tags</option><option value="query_limit">Set query item limit</option><option value="delete">Delete cards</option></select></label>
        {action === "query_tags" ? <label>Tags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="Empty matches any tag" disabled={busy} /></label> : null}
        {action === "query_limit" ? <label>Max items<input type="number" min={1} max={1000} value={limit} onChange={event => setLimit(Number(event.target.value))} disabled={busy} /></label> : null}
        <button type="button" className="secondary" disabled={busy || (action !== "delete" && !queriesOnly) || (action === "query_limit" && (!Number.isInteger(limit) || limit < 1 || limit > 1000))} onClick={applyBulk}>Apply to selected cards</button>
        {action !== "delete" && !queriesOnly ? <span>Choose only query cards to change their filters.</span> : null}
      </div>
    </SelectionBar>
    {error ? <p role="alert" className="collection-error">{error}</p> : null}
    {!cards.length && portfolio.cards.length ? <p>No cards match these filters.</p> : null}
    <div className="portfolio-grid">
      {cards.map(card => <div key={card.id} className="selectable-card">
        <label className="card-selection"><input type="checkbox" aria-label={`Select ${card.title}`} checked={selection.selected.has(card.id)} onChange={() => selection.toggle(card.id)} disabled={busy} /> Select card</label>
        <DashboardCard card={card} onChanged={reload} footer={card.kind === "query" ? (
          <CardEditor value={card} onSubmit={spec => saveCard(card.id, spec)} onMove={direction => void mutate(() => moveCard(card.id, direction))} onDelete={() => remove(card.id)} />
        ) : (
          <CardKindEditor card={card} onSubmit={patch => saveCard(card.id, patch)} onMove={direction => void mutate(() => moveCard(card.id, direction))} onDelete={() => remove(card.id)} />
        )} />
      </div>)}
      <section className="rail-section portfolio-card">
        <header><h2>Add card</h2></header>
        <div className="card-body field-row">
          <label>Kind<select value={addKind} onChange={event => { if (isCardKind(event.target.value)) setAddKind(event.target.value); }}>{CARD_KINDS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          {addKind !== "query" ? <button type="button" className="primary" disabled={busy} onClick={() => void mutate(() => createCard(portfolio.id, { title: "New card", kind: addKind, config: {} }))}>Add card</button> : null}
        </div>
        {addKind === "query" ? <CardEditor summary="Query details" onSubmit={spec => mutate(() => createCard(portfolio.id, spec))} submitLabel="Add query card" /> : null}
      </section>
    </div>
    {dialog}
  </div>;
}
