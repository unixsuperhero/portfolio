import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { TagList } from "@portfolio/ui";
import type { ItemDetail } from "../types.ts";
import { addItemTags, deleteItem, getItem, itemHtmlUrl, pathAction, removeItemTag, setSlotPath, toggleItem } from "../api.ts";
import { copyText, openPath, reveal } from "../native.ts";
import { openTerminal } from "../terminal/store.ts";
import { ServicesCard } from "../cards/ServicesCard.tsx";
import { PortsCard } from "../cards/PortsCard.tsx";
import { PathField } from "../components/PathField.tsx";

export default function Item() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [slotOverride, setSlotOverride] = useState("");

  const load = () => { if (id) getItem(Number(id)).then(setItem).catch(() => setItem(null)); };
  useEffect(load, [id]);

  useEffect(() => {
    if (item && (item.type === "document" || item.type === "note")) {
      fetch(itemHtmlUrl(item.id)).then(response => response.text()).then(setHtml).catch(() => setHtml(null));
    } else {
      setHtml(null);
    }
  }, [item?.id, item?.type]);

  if (!item) return <p>Loading…</p>;

  const toggle = (field: "pinned" | "starred") => toggleItem(item.id, field).then(load).catch(() => {});
  const remove = () => { if (confirm(`Delete "${item.title}"?`)) deleteItem(item.id).then(() => navigate("/library")).catch(() => {}); };
  const addTag = (event: React.FormEvent) => { event.preventDefault(); if (!newTag.trim()) return; addItemTags(item.id, [newTag.trim()]).then(() => { setNewTag(""); load(); }).catch(() => {}); };

  const startSlotEdit = (slotName: string, current: string) => { setEditingSlot(slotName); setSlotOverride(current); };
  const saveSlotOverride = (slotName: string) => setSlotPath(item.id, slotName, slotOverride.trim()).then(() => { setEditingSlot(null); load(); }).catch(() => {});
  const clearSlotOverride = (slotName: string) => setSlotPath(item.id, slotName, "").then(() => { setEditingSlot(null); load(); }).catch(() => {});

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{item.title}</h1>
          <TagList tags={item.tags} onClick={name => void removeItemTag(item.id, name).then(load)} />
        </div>
        <div className="page-actions">
          <button type="button" className="secondary" onClick={() => toggle("pinned")}>{item.pinned ? "Unpin" : "Pin"}</button>
          <button type="button" className="secondary" onClick={() => toggle("starred")}>{item.starred ? "Unstar" : "Star"}</button>
          <button type="button" className="danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <form className="field-row" onSubmit={addTag}>
        <label>Add tag<input value={newTag} onChange={event => setNewTag(event.target.value)} /></label>
        <button className="secondary" type="submit">Add</button>
      </form>

      {(item.type === "document" || item.type === "note") ? (
        <iframe title={item.title} sandbox="allow-same-origin" srcDoc={html ?? ""} style={{ width: "100%", height: "70vh", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "#fff" }} />
      ) : null}

      {(item.type === "file" || item.type === "dir") ? (
        <div>
          <p data-path={item.path ?? ""} data-kind={item.type} data-item={item.id}>
            <code>{item.path}</code>
          </p>
          <div className="page-actions" style={{ marginBottom: "1rem" }}>
            <button type="button" className="secondary" onClick={() => item.path && void copyText(item.path)}>Copy path</button>
            <button type="button" className="secondary" onClick={() => item.path && void reveal(item.path)}>Reveal</button>
            <button type="button" className="secondary" onClick={() => item.path && void openPath(item.path)}>Open</button>
            {item.type === "dir" ? <button type="button" className="secondary" onClick={() => item.path && openTerminal({ cwd: item.path, title: item.title })}>Open terminal here</button> : null}
          </div>
          {item.slots.length ? (
            <table className="data-table">
              <thead><tr><th>Slot</th><th>Path</th><th>Exists</th><th></th></tr></thead>
              <tbody>
                {item.slots.map(slot => (
                  <tr key={slot.name} data-path={slot.path} data-kind={slot.kind} data-item={item.id} data-slot={slot.name}>
                    <td>{slot.name}</td>
                    <td>
                      {editingSlot === slot.name ? (
                        <PathField kind={slot.kind} value={slotOverride} onChange={setSlotOverride} />
                      ) : (
                        <code>{slot.path}</code>
                      )}
                      {slot.overridden ? <span style={{ marginLeft: "0.4rem", color: "var(--text3)", fontSize: "0.75rem" }}>(overridden)</span> : null}
                    </td>
                    <td>{slot.exists ? "yes" : "no"}</td>
                    <td className="page-actions">
                      {editingSlot === slot.name ? (
                        <>
                          <button type="button" className="secondary" onClick={() => saveSlotOverride(slot.name)}>Save</button>
                          <button type="button" className="secondary" onClick={() => setEditingSlot(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="secondary" onClick={() => void copyText(slot.path)}>Copy</button>
                          <button type="button" className="secondary" onClick={() => void reveal(slot.path)}>Reveal</button>
                          <button type="button" className="secondary" onClick={() => void openPath(slot.path)}>Open</button>
                          {!slot.exists ? <button type="button" className="secondary" onClick={() => pathAction(item.id, "create", slot.name).then(load)}>Create</button> : null}
                          {slot.kind === "dir" ? <button type="button" className="secondary" onClick={() => openTerminal({ cwd: slot.path, title: slot.name })}>Terminal</button> : null}
                          <button type="button" className="secondary" onClick={() => startSlotEdit(slot.name, slot.overridden ? slot.path : "")}>Override…</button>
                          {slot.overridden ? <button type="button" className="secondary" onClick={() => clearSlotOverride(slot.name)}>Clear override</button> : null}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}

      {item.project ? (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>Services</h2>
          <ServicesCard projectId={item.project.id} />
          <h2>Ports</h2>
          <PortsCard projectId={item.project.id} />
        </div>
      ) : null}
    </div>
  );
}
