import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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

export function useSelection<T extends string | number>(ids: readonly T[]) {
  const [checked, setChecked] = useState<Set<T>>(() => new Set());
  const visible = new Set(ids);
  const selected = new Set([...checked].filter(id => visible.has(id)));
  const allSelected = ids.length > 0 && selected.size === visible.size;
  return {
    selected,
    allSelected,
    toggle: (id: T) => setChecked(current => {
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
