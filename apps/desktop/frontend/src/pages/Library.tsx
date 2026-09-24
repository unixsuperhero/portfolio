import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { EmptyState, ItemRow } from "@portfolio/ui";
import { ITEM_TYPES, isItemType } from "@portfolio/core";
import type { ItemType, ItemView } from "@portfolio/core";
import { detect, listItems, quickAdd, toggleItem } from "../api.ts";
import { BrowsePicker } from "../components/BrowsePicker.tsx";
import { AddTextarea } from "../components/AddTextarea.tsx";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import { ItemBulkActions } from "../components/CollectionTools.tsx";
import { isWails } from "../lib/wails.ts";
import { home, pickDirectory, pickFile } from "../native.ts";
import type { Detection } from "../types.ts";

type SortKey = "title" | "created_at" | "updated_at" | "type";
type SortValue = `${SortKey}:asc` | `${SortKey}:desc`;
type PickerKind = "file" | "dir";

const SORT_OPTIONS: readonly { value: SortValue; label: string }[] = [
  { value: "updated_at:desc", label: "Updated newest" },
  { value: "updated_at:asc", label: "Updated oldest" },
  { value: "created_at:desc", label: "Created newest" },
  { value: "created_at:asc", label: "Created oldest" },
  { value: "title:asc", label: "Title A-Z" },
  { value: "title:desc", label: "Title Z-A" },
  { value: "type:asc", label: "Type A-Z" },
  { value: "type:desc", label: "Type Z-A" },
];

const DEFAULT_SORT: SortValue = "updated_at:desc";

function isSortValue(value: string): value is SortValue {
  return SORT_OPTIONS.some(option => option.value === value);
}

function itemTypeFromParam(value: string): ItemType | undefined {
  return isItemType(value) ? value : undefined;
}

function compareBy(sort: SortValue) {
  const separator = sort.indexOf(":");
  const key = sort.slice(0, separator);
  const direction = sort.slice(separator + 1);
  const factor = direction === "asc" ? 1 : -1;
  return (left: ItemView, right: ItemView) => {
    const leftValue = key === "title" ? left.title : key === "created_at" ? left.created_at : key === "updated_at" ? left.updated_at : left.type;
    const rightValue = key === "title" ? right.title : key === "created_at" ? right.created_at : key === "updated_at" ? right.updated_at : right.type;
    return leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" }) * factor;
  };
}

/** The UI package renders plain anchors; under the hash router an internal href must carry the
 * hash or the webview navigates away from the app entirely (a white window). */
const hashHref = (item: { href: string }) => (item.href.startsWith("/") ? `#${item.href}` : item.href);

export default function Library() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<ItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [quick, setQuick] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [detected, setDetected] = useState<{ id: number; href: string; type: string; title: string } | null>(null);
  const [quickDetection, setQuickDetection] = useState<Detection | null>(null);
  const [quickType, setQuickType] = useState<ItemType | "">("");
  const [browseKind, setBrowseKind] = useState<PickerKind | null>(null);

  const q = params.get("q") ?? "";
  const type = itemTypeFromParam(params.get("type") ?? "");
  const tag = params.get("tag") ?? "";
  const pinned = params.get("pinned") === "1";
  const starred = params.get("starred") === "1";
  const sortParam = params.get("sort") ?? "";
  const sort = isSortValue(sortParam) ? sortParam : DEFAULT_SORT;

  const load = async () => {
    const current = ++requestId.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await listItems({ q: q || undefined, type, tagName: tag || undefined, pinned: pinned || undefined, starred: starred || undefined });
      if (current === requestId.current) setItems(result.items);
    } catch (error) {
      if (current === requestId.current) { setItems([]); setLoadError(error instanceof Error ? error.message : "Could not load library."); }
    } finally { if (current === requestId.current) setLoading(false); }
  };

  useEffect(() => { void load(); return () => { requestId.current++; }; }, [q, type, tag, pinned, starred]);

  useEffect(() => {
    if (!quick.trim()) { setQuickDetection(null); return; }
    let live = true;
    const id = setTimeout(() => {
      detect(quick.trim())
        .then(result => { if (live) setQuickDetection(result); })
        .catch(() => { if (live) setQuickDetection(null); });
    }, 300);
    return () => { live = false; clearTimeout(id); };
  }, [quick]);

  const visibleItems = useMemo(() => [...items].sort(compareBy(sort)), [items, sort]);
  const visibleIds = useMemo(() => visibleItems.map(item => item.id), [visibleItems]);
  const selection = useSelection(visibleIds);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const choosePath = async (kind: PickerKind) => {
    setQuickError("");
    if (isWails()) {
      const detectedPath = quickDetection?.shape === "path" ? quick.trim() : "";
      const start = detectedPath || await home();
      const title = kind === "dir" ? "Choose a folder" : "Choose a file";
      const picked = kind === "dir" ? await pickDirectory(title, start) : await pickFile(title, start);
      if (picked) setQuick(picked);
      return;
    }
    setBrowseKind(kind);
  };

  const submitQuick = (event: React.FormEvent) => {
    event.preventDefault();
    const content = quick.trim();
    if (!content || quickBusy) return;
    setQuickBusy(true);
    setQuickError("");
    quickAdd(content, quickType ? { type: quickType } : {})
      .then(result => { setDetected(result); setQuick(""); setQuickDetection(null); load(); })
      .catch(error => setQuickError(error instanceof Error ? error.message : "Could not add item."))
      .finally(() => setQuickBusy(false));
  };

  const onToggle = (item: ItemView, field: "pinned" | "starred") => toggleItem(item.id, field).then(load).catch(error => setLoadError(error instanceof Error ? error.message : "Could not update item."));

  return (
    <div>
      <div className="page-header"><h1>Library</h1></div>
      <form className="field-row" onSubmit={submitQuick}>
        <label style={{ flex: 1 }}>Quick add
          <div className="path-field">
            <AddTextarea
              value={quick}
              onChange={setQuick}
              placeholder="Paste a URL, path, or text…"
              disabled={quickBusy}
            />
            <button type="button" className="secondary" onClick={() => choosePath("file")} disabled={quickBusy}>File…</button>
            <button type="button" className="secondary" onClick={() => choosePath("dir")} disabled={quickBusy}>Folder…</button>
          </div>
        </label>
        <details>
          <summary>Options</summary>
          <div className="field-row" style={{ margin: "0.5rem 0 0" }}>
            <label>Add as<select value={quickType} onChange={event => setQuickType(itemTypeFromParam(event.target.value) ?? "")} disabled={quickBusy}>
              <option value="">Detect automatically</option>
              {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select></label>
            {quickDetection ? <span className="tag">Detected {quickDetection.type}</span> : null}
          </div>
        </details>
        <button className="primary" type="submit" disabled={!quick.trim() || quickBusy}>{quickBusy ? "Adding…" : "Add"}</button>
      </form>
      {browseKind ? (
        <BrowsePicker
          kind={browseKind}
          start={quickDetection?.shape === "path" ? quick : undefined}
          onClose={() => setBrowseKind(null)}
          onPick={path => { setQuick(path); setBrowseKind(null); }}
        />
      ) : null}
      {quickError ? <p role="alert">{quickError}</p> : null}
      {detected ? <p style={{ color: "var(--text2)" }}>Added as <strong>{detected.type}</strong>: {detected.title}</p> : null}
      <CollectionToolbar
        query={q}
        onQueryChange={value => setParam("q", value)}
        sort={sort}
        onSortChange={value => setParam("sort", isSortValue(value) ? value : DEFAULT_SORT)}
        sortOptions={SORT_OPTIONS}
      >
        <label>Type
          <select value={type ?? ""} onChange={event => setParam("type", event.target.value)}>
            <option value="">Any</option>
            {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Tag<input value={tag} onChange={event => setParam("tag", event.target.value)} /></label>
        <label><input type="checkbox" checked={pinned} onChange={event => setParam("pinned", event.target.checked ? "1" : "")} /> Pinned</label>
        <label><input type="checkbox" checked={starred} onChange={event => setParam("starred", event.target.checked ? "1" : "")} /> Starred</label>
      </CollectionToolbar>
      <SelectionBar
        count={selection.selected.size}
        total={visibleIds.length}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clear}
        busy={loading}
      >
        <ItemBulkActions ids={[...selection.selected]} onChanged={load} />
      </SelectionBar>
      {loadError ? <p role="alert">{loadError}</p> : null}
      {loading ? <p>Loading library…</p> : (
        visibleItems.length ? (
          <div className="items">
            {visibleItems.map(item => (
              <ItemRow
                key={item.id}
                item={item}
                hrefFor={hashHref}
                tagHrefFor={t => `#/library?tag=${encodeURIComponent(t)}`}
                onToggle={onToggle}
                editHref={() => `#/items/${item.id}`}
                leading={(
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title}`}
                    checked={selection.selected.has(item.id)}
                    onChange={() => selection.toggle(item.id)}
                  />
                )}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={q || type || tag || pinned || starred ? "No matching library items." : "No library items yet."}
            hint={q || type || tag || pinned || starred ? "Change the filters or search." : "Add a URL, path, file, folder, or note above."}
          />
        )
      )}
    </div>
  );
}
