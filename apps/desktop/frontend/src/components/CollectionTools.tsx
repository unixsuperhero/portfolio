import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { addItemTags, deleteItem, listCategories, patchItem, removeItemTag } from "../api.ts";
import type { CategorySummary } from "../types.ts";
import { useConfirm } from "./ConfirmDialog.tsx";

export function CollectionToolbar({ query, onQueryChange, sort, onSortChange, sortOptions, children }: {
  query: string;
  onQueryChange: (value: string) => void;
  sort: string;
  onSortChange: (value: string) => void;
  sortOptions: readonly { value: string; label: string }[];
  children?: ReactNode;
}) {
  return <div className="collection-toolbar field-row" role="search">
    <label className="collection-search">Search<input type="search" value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Search this collection…" /></label>
    {children}
    <label>Sort<select value={sort} onChange={event => onSortChange(event.target.value)}>{sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  </div>;
}

export function useSelection(ids: readonly number[]) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const visible = new Set(ids);
  const selected = new Set([...checked].filter(id => visible.has(id)));
  const allSelected = ids.length > 0 && selected.size === visible.size;
  return {
    selected,
    allSelected,
    toggle: (id: number) => setChecked(current => {
      const next = new Set([...current].filter(value => visible.has(value)));
      if (next.has(id)) next.delete(id); else if (visible.has(id)) next.add(id);
      return next;
    }),
    toggleAll: () => setChecked(allSelected ? new Set() : visible),
    clear: () => setChecked(new Set()),
  };
}

export function SelectionBar({ count, total, allSelected, onToggleAll, onClear, children, busy = false }: {
  count: number;
  total: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  children?: ReactNode;
  busy?: boolean;
}) {
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = count > 0 && !allSelected; }, [count, allSelected]);
  return <div className="selection-bar">
    <label className="selection-toggle"><input ref={checkbox} type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={busy || total === 0} /> Select all visible</label>
    <span role="status">{count ? `${count} selected` : `${total} results`}</span>
    {count > 0 ? <button type="button" className="secondary" onClick={onClear} disabled={busy}>Clear selection</button> : null}
    {count > 0 ? <fieldset className="selection-actions" disabled={busy}>{children}</fieldset> : null}
  </div>;
}

export function ItemBulkActions({ ids, onChanged }: { ids: readonly number[]; onChanged: () => void | Promise<void> }) {
  const [action, setAction] = useState("add_tags");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tagId = useId();
  const needsTags = action === "add_tags" || action === "remove_tags";
  const { confirm, dialog } = useConfirm();
  useEffect(() => {
    if (action !== "category" || categories !== null) return;
    let live = true;
    listCategories().then(result => { if (live) setCategories(result.categories); })
      .catch(err => { if (live) setError(String(err)); });
    return () => { live = false; };
  }, [action, categories]);

  const apply = async () => {
    if (busy || !ids.length) return;
    const names = [...new Set(tags.split(",").map(name => name.trim()).filter(Boolean))];
    if (needsTags && !names.length) { setError("Enter at least one tag."); return; }
    if (action === "delete" && !(await confirm({ title: `Remove ${ids.length} selected items from the database?`, body: "Files on disk will be kept. Selected tasks will also be removed; their subtasks become top-level tasks." }))) return;
    setBusy(true);
    setError("");
    try {
      const results = await Promise.allSettled(ids.map(async id => {
        switch (action) {
          case "add_tags": return addItemTags(id, names);
          case "remove_tags": for (const name of names) await removeItemTag(id, name); return;
          case "pin": return patchItem(id, { pinned: true });
          case "unpin": return patchItem(id, { pinned: false });
          case "star": return patchItem(id, { starred: true });
          case "unstar": return patchItem(id, { starred: false });
          case "category": return patchItem(id, { category_id: category ? Number(category) : null });
          case "delete": return deleteItem(id);
          default: throw new Error("Choose a bulk action.");
        }
      }));
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) setError(`${failures.length} of ${ids.length} items could not be updated. ${String(failures[0]?.reason ?? "")}`);
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  return <div className="item-bulk-actions">
    <fieldset className="field-row bulk-action-fields" disabled={busy || !ids.length}>
      <label>Bulk action<select value={action} onChange={event => { setAction(event.target.value); setError(""); }}>
        <option value="add_tags">Add tags</option><option value="remove_tags">Remove tags</option>
        <option value="pin">Pin</option><option value="unpin">Unpin</option>
        <option value="star">Star</option><option value="unstar">Unstar</option>
        <option value="category">Set category</option><option value="delete">Remove from database</option>
      </select></label>
      {needsTags ? <label htmlFor={tagId}>Tags<input id={tagId} value={tags} onChange={event => setTags(event.target.value)} placeholder="work, research" /></label> : null}
      {action === "category" ? <label>Category<select value={category} onChange={event => setCategory(event.target.value)} disabled={categories === null}>
        <option value="">None</option>{categories?.map(value => <option key={value.id} value={value.id}>{value.name} ({value.kind})</option>)}
      </select></label> : null}
      <button type="button" className={action === "delete" ? "secondary danger" : "primary"} disabled={action === "category" && categories === null} onClick={() => void apply()}>{busy ? "Applying…" : "Apply to selected"}</button>
    </fieldset>
    {error ? <p role="alert" className="collection-error">{error}</p> : null}
    {dialog}
  </div>;
}
