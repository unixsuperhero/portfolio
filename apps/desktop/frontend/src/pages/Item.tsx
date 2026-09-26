import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { TagList } from "@portfolio/ui";
import type { ItemDetail } from "../types.ts";
import { addItemTags, deleteItem, getItem, itemHtmlUrl, pathAction, removeItemTag, saveItemMarkdown, setSlotPath, toggleItem } from "../api.ts";
import { copyText, openPath, reveal } from "../native.ts";
import { openTerminal } from "../terminal/store.ts";
import { ServicesCard } from "../cards/ServicesCard.tsx";
import { PortsCard } from "../cards/PortsCard.tsx";
import { PathField } from "../components/PathField.tsx";
import { useConfirm } from "../components/ConfirmDialog.tsx";
import Tasks from "./Tasks.tsx";
import { markdownTasks, setMarkdownTask, taskLabel } from "../lib/markdown-tasks.ts";
import "../document.css";

function sanitizeDocument(html: string): string {
  const source = new DOMParser().parseFromString(html, "text/html");
  source.querySelectorAll("input").forEach(input => {
    if (input.type !== "checkbox" || !input.matches("li > label > input, li > p:first-child > label > input")) input.remove();
    else input.disabled = true;
  });
  const content = source.querySelector(".page-wrap")?.outerHTML
    ?? source.querySelector("article")?.outerHTML
    ?? `<article>${source.body.innerHTML}</article>`;
  return DOMPurify.sanitize(content, {
    USE_PROFILES: { html: true },
    SANITIZE_NAMED_PROPS: true,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "button", "textarea", "select"],
    FORBID_ATTR: ["style"],
  });
}

function DocumentContent({ html, markdown, disabled, onToggle }: {
  html: string;
  markdown: string | null;
  disabled: boolean;
  onToggle: (offset: number, checked: boolean) => Promise<void>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const safeHtml = useMemo(() => sanitizeDocument(html), [html]);
  const tasks = useMemo(() => markdown === null ? [] : markdownTasks(markdown), [markdown]);
  const focusTask = useRef<number | null>(null);
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    const inputs = [...(rootRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];
    const matches = inputs.length === tasks.length && inputs.every((input, index) => {
      const label = input.parentElement;
      return input.defaultChecked === tasks[index]?.checked && taskLabel(label?.textContent ?? "") === tasks[index]?.label;
    });
    setMismatch(markdown !== null && inputs.length > 0 && !matches);
    const removeListeners: (() => void)[] = [];
    inputs.forEach((input, index) => {
      input.disabled = disabled || markdown === null || !matches;
      const task = tasks[index];
      if (!matches || !task) return;
      input.setAttribute("aria-label", task.label || "Checklist item");
      const change = async () => {
        const checked = input.checked;
        focusTask.current = task.offset;
        try {
          await onToggle(task.offset, checked);
        } catch {
          input.checked = task.checked;
        }
      };
      input.addEventListener("change", change);
      removeListeners.push(() => input.removeEventListener("change", change));
      if (!input.disabled && focusTask.current === task.offset) {
        input.focus({ preventScroll: true });
        focusTask.current = null;
      }
    });
    return () => removeListeners.forEach(remove => remove());
  }, [safeHtml, tasks, markdown, disabled, onToggle]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const removeListeners: (() => void)[] = [];
    root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(anchor => {
      const href = anchor.getAttribute("href");
      if (href === "/") anchor.setAttribute("href", "#/");
      else if (href?.startsWith("/items/")) anchor.setAttribute("href", `#${href}`);
      anchor.tabIndex = 0;
      const localHash = anchor.getAttribute("href");
      if (!localHash?.startsWith("#") || localHash.startsWith("#/")) return;
      let targetId: string;
      try {
        targetId = decodeURIComponent(localHash.slice(1));
      } catch {
        return;
      }
      const target = [...root.querySelectorAll<HTMLElement>("[id]")].find(element =>
        element.id === `user-content-${targetId}` || element.id === targetId,
      );
      if (!target) return;
      anchor.setAttribute("href", `#${target.id}`);
      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        target.tabIndex = -1;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.focus({ preventScroll: true });
      };
      anchor.addEventListener("click", onClick);
      removeListeners.push(() => anchor.removeEventListener("click", onClick));
    });
    root.querySelectorAll<HTMLElement>("div.sourceCode").forEach(block => {
      const language = [...(block.querySelector("pre code")?.classList ?? [])].find(name => name.startsWith("language-"));
      if (language) block.dataset.lang = language.slice("language-".length);
    });
    root.querySelectorAll<HTMLElement>("article pre > code").forEach(code => {
      const pre = code.closest("pre");
      const host = pre?.parentElement?.matches("div.sourceCode") ? pre.parentElement : pre;
      if (!host || host.querySelector(":scope > .copy-code-button")) return;

      host.classList.add("copy-code-host");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-code-button";
      button.setAttribute("aria-label", "Copy code to clipboard");
      button.textContent = "Copy";
      const onClick = async () => {
        try {
          const copied = await copyText((code.textContent ?? "").replace(/\n$/, ""));
          button.textContent = copied ? "Copied" : "Failed";
          button.classList.toggle("copied", copied);
        } catch {
          button.textContent = "Failed";
          button.classList.remove("copied");
        }
        window.setTimeout(() => {
          button.textContent = "Copy";
          button.classList.remove("copied");
        }, 1400);
      };
      button.addEventListener("click", onClick);
      host.appendChild(button);
      removeListeners.push(() => { button.removeEventListener("click", onClick); button.remove(); });
    });
    return () => removeListeners.forEach(remove => remove());
  }, [safeHtml]);

  return <>
    {mismatch ? <p role="alert" className="markdown-error">This checklist does not match the Markdown source. Use Edit Markdown to update it safely.</p> : null}
    <div ref={rootRef} className="document-render" dangerouslySetInnerHTML={{ __html: safeHtml }} />
  </>;
}

export default function Item() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const routeItemId = Number(id);
  const itemRequest = useRef(0);
  const activeItemId = useRef(routeItemId);
  activeItemId.current = routeItemId;
  const saveInFlight = useRef(false);
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [htmlError, setHtmlError] = useState("");
  const [newTag, setNewTag] = useState("");
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [slotOverride, setSlotOverride] = useState("");
  const [markdownDraft, setMarkdownDraft] = useState<{ itemId: number; original: string; content: string } | null>(null);
  const [savingMarkdown, setSavingMarkdown] = useState(false);
  const [markdownError, setMarkdownError] = useState("");
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async (clear = false) => {
    const request = ++itemRequest.current;
    if (clear) setItem(null);
    try {
      const loaded = await getItem(routeItemId);
      if (request === itemRequest.current) setItem(loaded);
    } catch {
      if (request === itemRequest.current) setItem(null);
    }
  }, [routeItemId]);

  useEffect(() => {
    void load(true);
    return () => { itemRequest.current++; };
  }, [load, location.key]);

  useEffect(() => {
    if (!item || (item.type !== "document" && item.type !== "note")) {
      setHtml(null);
      setHtmlError("");
      return;
    }
    const controller = new AbortController();
    let live = true;
    setHtml(null);
    setHtmlError("");
    fetch(itemHtmlUrl(item.id), { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(`Document render failed (${response.status})`);
      return response.text();
    }).then(rendered => {
      if (live) setHtml(rendered);
    }).catch(error => {
      if (live && error instanceof Error && error.name !== "AbortError") setHtmlError(error.message);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [item?.id, item?.type]);

  const editRequested = searchParams.get("edit") === "1";
  useEffect(() => {
    if (!item?.editable_markdown || !editRequested) return;
    setMarkdownDraft(current => current?.itemId === item.id ? current : { itemId: item.id, original: item.content, content: item.content });
    setMarkdownError("");
  }, [editRequested, item?.editable_markdown, item?.id]);

  if (!item) return <p>Loading…</p>;

  const editingMarkdown = markdownDraft?.itemId === item.id;
  const draftMarkdown = editingMarkdown ? markdownDraft.content : "";
  const toggle = (field: "pinned" | "starred") => toggleItem(item.id, field).then(() => load()).catch(() => {});
  const remove = async () => { if (await confirm({ title: `Delete "${item.title}"?` })) deleteItem(item.id).then(() => navigate("/library")).catch(() => {}); };
  const addTag = (event: React.FormEvent) => { event.preventDefault(); if (!newTag.trim()) return; addItemTags(item.id, [newTag.trim()]).then(() => { setNewTag(""); void load(); }).catch(() => {}); };
  const startMarkdownEdit = () => {
    setMarkdownDraft({ itemId: item.id, original: item.content, content: item.content });
    setMarkdownError("");
  };
  const cancelMarkdownEdit = async () => {
    if (!markdownDraft || markdownDraft.itemId !== item.id || savingMarkdown) return;
    if (markdownDraft.content !== markdownDraft.original && !await confirm({ title: "Discard unsaved Markdown changes?" })) return;
    setMarkdownDraft(null);
    setMarkdownError("");
  };
  const saveMarkdown = async () => {
    if (!markdownDraft || markdownDraft.itemId !== item.id || saveInFlight.current) return;
    const saving = markdownDraft;
    saveInFlight.current = true;
    setSavingMarkdown(true);
    setMarkdownError("");
    try {
      const saved = await saveItemMarkdown(saving.itemId, saving.content, saving.original);
      setItem(current => current?.id === saving.itemId ? { ...current, content: saving.content } : current);
      if (activeItemId.current === saving.itemId) {
        setHtml(saved.rendered_html);
        setHtmlError("");
      }
      setMarkdownDraft(current => current?.itemId === saving.itemId ? null : current);
    } catch (error) {
      if (activeItemId.current === saving.itemId) setMarkdownError(error instanceof Error ? error.message : "Could not save Markdown.");
    } finally {
      saveInFlight.current = false;
      setSavingMarkdown(false);
    }
  };

  const toggleChecklist = async (offset: number, checked: boolean) => {
    if (!item.editable_markdown || editingMarkdown || saveInFlight.current) throw new Error("Markdown is not available for editing.");
    saveInFlight.current = true;
    setSavingMarkdown(true);
    setMarkdownError("");
    try {
      const content = setMarkdownTask(item.content, offset, checked);
      const saved = await saveItemMarkdown(item.id, content, item.content);
      setItem(current => current?.id === item.id ? { ...current, content } : current);
      if (activeItemId.current === item.id) {
        setHtml(saved.rendered_html);
        setHtmlError("");
      }
    } catch (error) {
      if (activeItemId.current === item.id) setMarkdownError(error instanceof Error ? error.message : "Could not save checklist.");
      throw error;
    } finally {
      saveInFlight.current = false;
      setSavingMarkdown(false);
    }
  };

  const startSlotEdit = (slotName: string, current: string) => { setEditingSlot(slotName); setSlotOverride(current); };
  const saveSlotOverride = (slotName: string) => setSlotPath(item.id, slotName, slotOverride.trim()).then(() => { setEditingSlot(null); void load(); }).catch(() => {});
  const clearSlotOverride = (slotName: string) => setSlotPath(item.id, slotName, "").then(() => { setEditingSlot(null); void load(); }).catch(() => {});

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{item.title}</h1>
          <TagList tags={item.tags} onClick={name => void removeItemTag(item.id, name).then(() => load())} />
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
      {item.type === "task" && item.task_id !== null ? <Tasks taskId={item.task_id} onChange={load} /> : null}

      {(item.type === "document" || item.type === "note") ? (
        <section>
          {item.editable_markdown && !editingMarkdown ? <button type="button" className="secondary" disabled={savingMarkdown} onClick={startMarkdownEdit}>Edit Markdown</button> : null}
          {item.source_error ? <p role="alert" className="markdown-error">{item.source_error}; showing saved content only.</p> : null}
          {editingMarkdown ? (
            <div className="markdown-editor">
              <label htmlFor="markdown-source">Markdown source</label>
              <textarea
                id="markdown-source"
                autoFocus
                readOnly={savingMarkdown}
                value={draftMarkdown}
                onChange={event => setMarkdownDraft(current => current?.itemId === item.id ? { ...current, content: event.target.value } : current)}
                onKeyDown={event => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    if (!savingMarkdown) void saveMarkdown();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    if (!savingMarkdown) void cancelMarkdownEdit();
                  }
                }}
              />
              <div className="page-actions">
                <button type="button" className="primary" disabled={savingMarkdown} onClick={() => void saveMarkdown()}>{savingMarkdown ? "Saving…" : "Save (⌘/Ctrl+S)"}</button>
                <button type="button" className="secondary" disabled={savingMarkdown} onClick={() => void cancelMarkdownEdit()}>Cancel</button>
              </div>
              {markdownError ? <p role="alert" className="markdown-error">{markdownError}</p> : null}
            </div>
          ) : null}
          {!editingMarkdown && markdownError ? <p role="alert" className="markdown-error">{markdownError}</p> : null}
          {html !== null ? <DocumentContent html={html} markdown={item.editable_markdown ? item.content : null} disabled={savingMarkdown || editingMarkdown} onToggle={toggleChecklist} /> : htmlError ? <p role="alert" className="markdown-error">{htmlError}</p> : <p role="status">Loading document…</p>}
        </section>
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
                          {!slot.exists ? <button type="button" className="secondary" onClick={() => pathAction(item.id, "create", slot.name).then(() => load())}>Create</button> : null}
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
      {dialog}
    </div>
  );
}
