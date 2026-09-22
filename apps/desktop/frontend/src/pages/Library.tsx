import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ItemList } from "@portfolio/ui";
import type { ItemView } from "@portfolio/core";
import { listItems, quickAdd, toggleItem } from "../api.ts";

export default function Library() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<ItemView[]>([]);
  const [quick, setQuick] = useState("");
  const [detected, setDetected] = useState<{ id: number; href: string; type: string; title: string } | null>(null);

  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const tag = params.get("tag") ?? "";
  const pinned = params.get("pinned") === "1";
  const starred = params.get("starred") === "1";

  const load = () => {
    listItems({ q: q || undefined, type: (type || undefined) as any, tagName: tag || undefined, pinned: pinned || undefined, starred: starred || undefined })
      .then(({ items }) => setItems(items))
      .catch(() => setItems([]));
  };

  useEffect(load, [q, type, tag, pinned, starred]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const submitQuick = (event: React.FormEvent) => {
    event.preventDefault();
    if (!quick.trim()) return;
    quickAdd(quick.trim()).then(result => { setDetected(result); setQuick(""); load(); }).catch(() => {});
  };

  const onToggle = (item: ItemView, field: "pinned" | "starred") => toggleItem(item.id, field).then(load).catch(() => {});

  return (
    <div>
      <div className="page-header"><h1>Library</h1></div>
      <form className="field-row" onSubmit={submitQuick}>
        <label style={{ flex: 1 }}>Quick add<input style={{ width: "100%" }} value={quick} onChange={event => setQuick(event.target.value)} placeholder="Paste a URL, path, or text…" /></label>
        <button className="primary" type="submit">Add</button>
      </form>
      {detected ? <p style={{ color: "var(--text2)" }}>Added as <strong>{detected.type}</strong>: {detected.title}</p> : null}
      <div className="field-row">
        <label>Search<input value={q} onChange={event => setParam("q", event.target.value)} /></label>
        <label>Type
          <select value={type} onChange={event => setParam("type", event.target.value)}>
            <option value="">Any</option>
            {["document", "note", "link", "pr", "file", "dir"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Tag<input value={tag} onChange={event => setParam("tag", event.target.value)} /></label>
        <label><input type="checkbox" checked={pinned} onChange={event => setParam("pinned", event.target.checked ? "1" : "")} /> Pinned</label>
        <label><input type="checkbox" checked={starred} onChange={event => setParam("starred", event.target.checked ? "1" : "")} /> Starred</label>
      </div>
      <ItemList items={items} tagHrefFor={t => `/library?tag=${encodeURIComponent(t)}`} onToggle={onToggle} editHref={item => `/items/${item.id}`} />
    </div>
  );
}
