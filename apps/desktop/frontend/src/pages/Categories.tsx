import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ITEM_TYPES } from "@portfolio/core";
import type { ItemType } from "@portfolio/core";
import type { CategorySummary } from "../types.ts";
import { createCategory, deleteCategory, listCategories } from "../api.ts";
import { isWails } from "../lib/wails.ts";
import { home, pickDirectory, pickFile } from "../native.ts";
import { BrowsePicker } from "../components/BrowsePicker.tsx";

export default function Categories() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ItemType>("dir");
  const [slots, setSlots] = useState("");
  const [browsing, setBrowsing] = useState(false);

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

  const load = () => listCategories().then(({ categories }) => setCategories(categories)).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createCategory(name.trim(), kind, slots).then(() => { setName(""); setSlots(""); load(); }).catch(() => {});
  };

  return (
    <div>
      <div className="page-header"><h1>Categories</h1></div>
      <form className="simple-form" onSubmit={submit}>
        <label>Name<input value={name} onChange={event => setName(event.target.value)} required /></label>
        <label>Kind
          <select value={kind} onChange={event => setKind(event.target.value as ItemType)}>
            {ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>Slots (one per line: name | kind | path)<textarea value={slots} onChange={event => setSlots(event.target.value)} placeholder={"tasks | file | TASKS.md\nlogs | dir | ~/Library/Logs/thing"} /></label>
        <div className="page-actions">
          <button type="button" className="secondary" onClick={() => insertSlotPath("dir")}>Insert directory…</button>
          <button type="button" className="secondary" onClick={() => insertSlotPath("file")}>Insert file…</button>
        </div>
        <button className="primary" type="submit">Create category</button>
      </form>
      {browsing ? (
        <BrowsePicker kind="dir" onClose={() => setBrowsing(false)} onPick={path => { insertSlotLine("dir", path); setBrowsing(false); }} />
      ) : null}
      <table className="data-table">
        <thead><tr><th>Name</th><th>Kind</th><th>Members</th><th></th></tr></thead>
        <tbody>
          {categories.map(category => (
            <tr key={category.id}>
              <td><Link to={`/categories/${category.id}`}>{category.name}</Link></td>
              <td>{category.kind}</td>
              <td>{category.member_count}</td>
              <td><button type="button" className="danger" onClick={() => deleteCategory(category.id).then(load)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
