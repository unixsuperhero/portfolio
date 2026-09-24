import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { ITEM_TYPES } from "@portfolio/core";
import type { ItemType } from "@portfolio/core";
import type { CategorySummary } from "../types.ts";
import { createCategory, deleteCategory, listCategories, patchCategory } from "../api.ts";
import { isWails } from "../lib/wails.ts";
import { home, pickDirectory, pickFile } from "../native.ts";
import { BrowsePicker } from "../components/BrowsePicker.tsx";
import { CollectionToolbar, SelectionBar, useSelection } from "../components/CollectionTools.tsx";
import { AddTextarea } from "../components/AddTextarea.tsx";
import { useConfirm } from "../components/ConfirmDialog.tsx";
import "../forms.css";

type SortKey = "name" | "members";

export default function Categories() {
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ItemType>("dir");
  const [slots, setSlots] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [bulkKind, setBulkKind] = useState<ItemType>("dir");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog } = useConfirm();

  const query = params.get("q") ?? "";
  const kindFilter = params.get("kind") ?? "";
  const sort = (params.get("sort") ?? "name") as SortKey;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const insertSlotLine = (slotKind: "dir" | "file", picked: string) => {
    const line = `slot | ${slotKind} | ${picked}`;
    setSlots(current => (current && !current.endsWith("\n") ? `${current}\n${line}` : `${current}${line}`));
  };

  const insertSlotPath = async (slotKind: "dir" | "file") => {
    if (isWails()) {
      const start = await home();
      const picked = slotKind === "dir"
        ? await pickDirectory("Choose a directory", start)
        : await pickFile("Choose a file", start);
      if (picked) insertSlotLine(slotKind, picked);
      return;
    }
    if (slotKind === "dir") setBrowsing(true);
  };

  const load = () => { setLoading(true); return listCategories().then(({ categories }) => setCategories(categories)).catch(error => setError((error as Error).message)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return categories
      .filter(category => {
        if (needle && !category.name.toLowerCase().includes(needle)) return false;
        if (kindFilter && category.kind !== kindFilter) return false;
        return true;
      })
      .sort((a, b) => (sort === "members" ? b.member_count - a.member_count : a.name.localeCompare(b.name)));
  }, [categories, query, kindFilter, sort]);

  const selection = useSelection(visible.map(category => category.id));
  const selectedIds = Array.from(selection.selected);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    createCategory(name.trim(), kind, slots)
      .then(() => { setName(""); setSlots(""); load(); })
      .catch(error => setError((error as Error).message))
      .finally(() => setBusy(false));
  };

  const changeSelectedKind = () => {
    if (!selectedIds.length) return;
    setBusy(true);
    setError("");
    Promise.allSettled(selectedIds.map(id => patchCategory(id, { kind: bulkKind })))
      .then(results => {
        const failed = results.filter(result => result.status === "rejected").length;
        if (failed) setError(`${failed} categor${failed === 1 ? "y" : "ies"} failed to update.`);
        selection.clear();
        load();
      })
      .finally(() => setBusy(false));
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    if (!(await confirm({ title: `Delete ${selectedIds.length} categor${selectedIds.length === 1 ? "y" : "ies"}?`, body: "Items and disk files are preserved." }))) return;
    setBusy(true);
    setError("");
    Promise.allSettled(selectedIds.map(deleteCategory))
      .then(results => {
        const failed = results.filter(result => result.status === "rejected").length;
        if (failed) setError(`${failed} categor${failed === 1 ? "y" : "ies"} failed to delete.`);
        selection.clear();
        load();
      })
      .finally(() => setBusy(false));
  };

  const deleteOne = async (category: CategorySummary) => {
    if (!(await confirm({ title: `Delete ${category.name}?`, body: "Items and disk files are preserved." }))) return;
    deleteCategory(category.id).then(load).catch(error => setError((error as Error).message));
  };

  return (
    <div>
      <div className="page-header"><h1>Categories</h1></div>
      {dialog}
      <form className="form-panel" onSubmit={submit}>
        <div className="form-row">
          <label>Name<AddTextarea value={name} onChange={setName} required /></label>
          <label>Kind
            <select value={kind} onChange={event => setKind(event.target.value as ItemType)}>
              {ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
        </div>
        <label>Slots (one per line: name | kind | path)<textarea value={slots} onChange={event => setSlots(event.target.value)} placeholder={"tasks | file | TASKS.md\nlogs | dir | ~/Library/Logs/thing"} /></label>
        <div className="form-actions">
          <button className="primary" type="submit" disabled={busy}>Create category</button>
          <button type="button" className="secondary" onClick={() => insertSlotPath("dir")}>Insert directory…</button>
          <button type="button" className="secondary" onClick={() => insertSlotPath("file")}>Insert file…</button>
        </div>
      </form>
      {browsing ? (
        <BrowsePicker kind="dir" onClose={() => setBrowsing(false)} onPick={path => { insertSlotLine("dir", path); setBrowsing(false); }} />
      ) : null}
      <CollectionToolbar
        query={query}
        onQueryChange={value => setParam("q", value)}
        sort={sort}
        onSortChange={value => setParam("sort", value)}
        sortOptions={[
          { value: "name", label: "Name" },
          { value: "members", label: "Member count" },
        ]}
      >
        <label>Kind
          <select value={kindFilter} onChange={event => setParam("kind", event.target.value)}>
            <option value="">Any</option>
            {ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
      </CollectionToolbar>
      <SelectionBar count={selectedIds.length} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={busy}>
        <label>Set kind
          <select value={bulkKind} onChange={event => setBulkKind(event.target.value as ItemType)} disabled={busy}>
            {ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={changeSelectedKind} disabled={busy || !selectedIds.length}>Apply</button>
        <button type="button" className="danger" onClick={deleteSelected} disabled={busy || !selectedIds.length}>Delete records</button>
      </SelectionBar>
      {error ? <p className="error">{error}</p> : null}
      {loading && !categories.length ? <div className="empty"><strong>Loading…</strong></div> : null}
      {!loading && !categories.length ? <div className="empty"><strong>No categories yet.</strong></div> : null}
      {categories.length && !visible.length ? <div className="empty"><strong>No matching categories.</strong><p>Adjust search or filters.</p></div> : null}
      {visible.length ? (
        <table className="data-table">
          <thead><tr><th>Select</th><th>Name</th><th>Kind</th><th>Members</th><th></th></tr></thead>
          <tbody>
            {visible.map(category => (
              <tr key={category.id}>
                <td><input type="checkbox" checked={selection.selected.has(category.id)} onChange={() => selection.toggle(category.id)} aria-label={`Select ${category.name}`} /></td>
                <td><Link to={`/categories/${category.id}`}>{category.name}</Link></td>
                <td>{category.kind}</td>
                <td>{category.member_count}</td>
                <td><button type="button" className="danger" onClick={() => void deleteOne(category)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
