import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { ItemList } from "@portfolio/ui";
import type { Category as CategoryType, ItemView } from "@portfolio/core";
import { getCategory, toggleItem } from "../api.ts";

export default function Category() {
  const { id } = useParams();
  const [category, setCategory] = useState<(CategoryType & { members: ItemView[] }) | null>(null);

  const load = () => { if (id) getCategory(Number(id)).then(setCategory).catch(() => setCategory(null)); };
  useEffect(load, [id]);

  if (!category) return <p>Loading…</p>;
  return (
    <div>
      <div className="page-header"><h1>{category.name}</h1></div>
      <p style={{ color: "var(--text2)" }}>Kind: {category.kind}</p>
      {category.slots.length ? (
        <ul>{category.slots.map(slot => <li key={slot.name}><code>{slot.name}</code> ({slot.kind}) — {slot.path}</li>)}</ul>
      ) : null}
      <ItemList items={category.members} onToggle={(item, field) => toggleItem(item.id, field).then(load).catch(() => {})} editHref={item => `/items/${item.id}`} />
    </div>
  );
}
