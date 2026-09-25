import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { ItemRow } from "@portfolio/ui";
import { ITEM_TYPES } from "@portfolio/core/constants";
import type { Category as CategoryType, ItemView } from "@portfolio/core";
import { getCategory, toggleItem } from "../api.ts";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";
import { ItemBulkActions } from "../components/CollectionTools.tsx";
import "../forms.css";

type SortKey = "title" | "created" | "updated" | "type";

export default function Category() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState<(CategoryType & { members: ItemView[] }) | null>(null);
  const [error, setError] = useState("");

  const query = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const tag = params.get("tag") ?? "";
  const pinned = params.get("pinned") === "1";
  const starred = params.get("starred") === "1";
  const sort = (params.get("sort") ?? "title") as SortKey;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const load = () => {
    if (id) getCategory(Number(id)).then(setCategory).catch(error => { setCategory(null); setError((error as Error).message); });
  };
  useEffect(load, [id]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(category?.members ?? [])]
      .filter(item => {
        if (needle) {
          const haystack = [item.title, item.description, item.path, item.source_path, item.url, ...item.tags].filter(Boolean).join(" ").toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        if (type && item.type !== type) return false;
        if (tag && !item.tags.includes(tag)) return false;
        if (pinned && !item.pinned) return false;
        if (starred && !item.starred) return false;
        return true;
      })
      .sort((a, b) => {
        switch (sort) {
          case "created": return Date.parse(b.created_at) - Date.parse(a.created_at);
          case "updated": return Date.parse(b.updated_at) - Date.parse(a.updated_at);
          case "type": return a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
          default: return a.title.localeCompare(b.title);
        }
      });
  }, [category, query, type, tag, pinned, starred, sort]);

  const allTags = useMemo(() => Array.from(new Set((category?.members ?? []).flatMap(item => item.tags))).sort(), [category]);
  const selection = useSelection(visible.map(item => item.id));
  const selectedIds = Array.from(selection.selected);

  if (!category) return <p>{error || "Loading…"}</p>;
  return (
    <div>
      <div className="page-header"><h1>{category.name}</h1></div>
      <p className="category-kind">Kind: {category.kind}</p>
      {category.slots.length ? (
        <ul className="slot-list">{category.slots.map(slot => <li key={slot.name}><code>{slot.name}</code><span>({slot.kind}) — {slot.path}</span></li>)}</ul>
      ) : null}
      <CollectionToolbar
        query={query}
        onQueryChange={value => setParam("q", value)}
        sort={sort}
        onSortChange={value => setParam("sort", value)}
        sortOptions={[
          { value: "title", label: "Title" },
          { value: "created", label: "Newest" },
          { value: "updated", label: "Recently updated" },
          { value: "type", label: "Type" },
        ]}
      >
        <label>Type
          <select value={type} onChange={event => setParam("type", event.target.value)}>
            <option value="">Any</option>
            {ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>Tag
          <select value={tag} onChange={event => setParam("tag", event.target.value)}>
            <option value="">Any</option>
            {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={pinned} onChange={event => setParam("pinned", event.target.checked ? "1" : "")} /> Pinned</label>
        <label><input type="checkbox" checked={starred} onChange={event => setParam("starred", event.target.checked ? "1" : "")} /> Starred</label>
      </CollectionToolbar>
      <SelectionBar count={selectedIds.length} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear}>
        <ItemBulkActions ids={selectedIds} onChanged={load} />
      </SelectionBar>
      {!category.members.length ? <div className="empty"><strong>No items in this category.</strong><p>Add matching files, links, or notes from the library.</p></div> : null}
      {category.members.length && !visible.length ? <div className="empty"><strong>No matching items.</strong><p>Adjust search or filters.</p></div> : null}
      {visible.length ? (
        <div className="items">
          {visible.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              leading={<input type="checkbox" checked={selection.selected.has(item.id)} onChange={() => selection.toggle(item.id)} aria-label={`Select ${item.title}`} />}
              onToggle={(item, field) => toggleItem(item.id, field).then(load).catch(error => setError((error as Error).message))}
              hrefFor={item => (item.href.startsWith("/") ? `#${item.href}` : item.href)}
              editHref={item => `#/items/${item.id}`}
            />
          ))}
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
