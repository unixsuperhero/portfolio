import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { PortfolioSummary } from "../types.ts";
import { createPortfolio, deletePortfolio, listPortfolios, patchPortfolio, patchSettings } from "../api.ts";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import { AddTextarea } from "../components/AddTextarea.tsx";
import { useConfirm } from "../components/ConfirmDialog.tsx";

type SortKey = "name" | "created" | "cards";
type FillFilter = "" | "empty" | "nonempty";

const cardCount = (portfolio: PortfolioSummary): number => {
  const value = portfolio as PortfolioSummary & { card_count?: number; cards?: unknown[] };
  return value.card_count ?? value.cards?.length ?? 0;
};

export default function Portfolios() {
  const [params, setParams] = useSearchParams();
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bulkDescription, setBulkDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog } = useConfirm();

  const query = params.get("q") ?? "";
  const sort = (params.get("sort") ?? "name") as SortKey;
  const fill = (params.get("fill") ?? "") as FillFilter;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const load = () => { setLoading(true); return listPortfolios().then(({ portfolios }) => setPortfolios(portfolios)).catch(error => setError((error as Error).message)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return portfolios
      .filter(portfolio => {
        if (needle && !`${portfolio.name} ${portfolio.description}`.toLowerCase().includes(needle)) return false;
        if (fill === "empty" && cardCount(portfolio) !== 0) return false;
        if (fill === "nonempty" && cardCount(portfolio) === 0) return false;
        return true;
      })
      .sort((a, b) => {
        switch (sort) {
          case "created": return Date.parse(b.created_at) - Date.parse(a.created_at);
          case "cards": return cardCount(b) - cardCount(a);
          default: return a.name.localeCompare(b.name);
        }
      });
  }, [portfolios, query, sort, fill]);

  const selection = useSelection(visible.map(portfolio => portfolio.id));
  const selectedIds = Array.from(selection.selected);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    createPortfolio(name.trim(), description.trim())
      .then(() => { setName(""); setDescription(""); load(); })
      .catch(error => setError((error as Error).message))
      .finally(() => setBusy(false));
  };

  const updateDescriptions = () => {
    if (!selectedIds.length) return;
    setBusy(true);
    setError("");
    Promise.allSettled(selectedIds.map(id => patchPortfolio(id, { description: bulkDescription })))
      .then(results => {
        const failed = results.filter(result => result.status === "rejected").length;
        if (failed) setError(`${failed} portfolio${failed === 1 ? "" : "s"} failed to update.`);
        setBulkDescription("");
        selection.clear();
        load();
      })
      .finally(() => setBusy(false));
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    if (!(await confirm({ title: `Delete ${selectedIds.length} portfolio record${selectedIds.length === 1 ? "" : "s"}?`, body: "Items and files are preserved." }))) return;
    setBusy(true);
    setError("");
    Promise.allSettled(selectedIds.map(deletePortfolio))
      .then(results => {
        const failed = results.filter(result => result.status === "rejected").length;
        if (failed) setError(`${failed} portfolio${failed === 1 ? "" : "s"} failed to delete.`);
        selection.clear();
        load();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <div className="page-header"><h1>Portfolios</h1></div>
      <form className="field-row" onSubmit={submit}>
        <label>Name<AddTextarea value={name} onChange={setName} required /></label>
        <label>Description<AddTextarea value={description} onChange={setDescription} /></label>
        <button className="primary" type="submit" disabled={busy}>Create</button>
      </form>
      <CollectionToolbar
        query={query}
        onQueryChange={value => setParam("q", value)}
        sort={sort}
        onSortChange={value => setParam("sort", value)}
        sortOptions={[
          { value: "name", label: "Name" },
          { value: "created", label: "Newest" },
          { value: "cards", label: "Card count" },
        ]}
      >
        <label>Cards
          <select value={fill} onChange={event => setParam("fill", event.target.value)}>
            <option value="">Any</option>
            <option value="empty">Empty</option>
            <option value="nonempty">Nonempty</option>
          </select>
        </label>
      </CollectionToolbar>
      <SelectionBar count={selectedIds.length} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={busy}>
        <input value={bulkDescription} onChange={event => setBulkDescription(event.target.value)} placeholder="New description" disabled={busy} />
        <button type="button" className="secondary" onClick={updateDescriptions} disabled={busy || !selectedIds.length}>Set description</button>
        <button type="button" className="danger" onClick={deleteSelected} disabled={busy || !selectedIds.length}>Delete records</button>
      </SelectionBar>
      {error ? <p className="error">{error}</p> : null}
      {loading && !portfolios.length ? <div className="empty"><strong>Loading…</strong></div> : null}
      {!loading && !portfolios.length ? <div className="empty"><strong>No portfolios yet.</strong></div> : null}
      {portfolios.length && !visible.length ? <div className="empty"><strong>No matching portfolios.</strong><p>Adjust search or filters.</p></div> : null}
      {visible.length ? (
        <table className="data-table">
          <thead><tr><th>Select</th><th>Name</th><th>Description</th><th>Cards</th><th></th></tr></thead>
          <tbody>
            {visible.map(portfolio => (
              <tr key={portfolio.id}>
                <td><input type="checkbox" checked={selection.selected.has(portfolio.id)} onChange={() => selection.toggle(portfolio.id)} aria-label={`Select ${portfolio.name}`} /></td>
                <td><Link to={`/portfolios/${portfolio.id}`}>{portfolio.name}</Link></td>
                <td>{portfolio.description}</td>
                <td>{cardCount(portfolio)}</td>
                <td><button type="button" className="secondary" onClick={() => patchSettings({ home_portfolio_id: portfolio.id })}>Set as homepage</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {dialog}
    </div>
  );
}
