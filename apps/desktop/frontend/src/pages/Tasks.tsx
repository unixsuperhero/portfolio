import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { TagList } from "@portfolio/ui";
import type { ItemView, TaskView } from "@portfolio/core";
import { completeTask, createTask, deleteTask, listItems, listTasks, patchItem, patchTask, uncompleteTask } from "../api.ts";
import { CollectionToolbar, ItemBulkActions, SelectionBar, useSelection } from "../components/CollectionTools.tsx";
import { MarkdownContent } from "../components/MarkdownContent.tsx";
import "./Tasks.css";

type Draft = { id: number | null; title: string; notes: string; parent_id: number | null; tags: string };
type SortKey = "title" | "created" | "completed";

const blank = (parent_id: number | null = null): Draft => ({ id: null, title: "", notes: "", parent_id, tags: "" });
const sortOptions = [
  { value: "title", label: "Title" },
  { value: "created", label: "Newest" },
  { value: "completed", label: "Last completed" },
] as const;

const tagText = (tags: readonly string[]) => tags.join(", ");
const parseTags = (value: string) => Array.from(new Set(value.split(",").map(tag => tag.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
const taskSearchText = (task: TaskView, tags: readonly string[]) => [task.title, task.notes, task.recurrence, ...tags].join(" ").toLowerCase();
const recurrenceLabel = (task: TaskView) => task.recurrence === "daily" ? "Repeats daily" : "One-time";

export default function Tasks({ taskId, onChange }: { taskId?: number; onChange?: () => void }) {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = taskId ?? (params.taskId ? Number(params.taskId) : undefined);
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [items, setItems] = useState<ItemView[]>([]);
  const [draft, setDraft] = useState<Draft>(() => blank(selectedId ?? null));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const query = searchParams.get("q") ?? "";
  const sortParam = searchParams.get("sort");
  const sort: SortKey = sortParam === "created" || sortParam === "completed" ? sortParam : "title";
  const active = searchParams.get("active") ?? "";
  const complete = searchParams.get("complete") ?? "";
  const recurrence = searchParams.get("recurrence") ?? "";
  const tag = searchParams.get("tag") ?? "";

  const load = async () => {
    const [taskResult, itemResult] = await Promise.all([listTasks(true), listItems({ type: "task" })]);
    setTasks(taskResult.tasks);
    setItems(itemResult.items);
  };

  useEffect(() => {
    let live = true;
    Promise.all([listTasks(true), listItems({ type: "task" })])
      .then(([taskResult, itemResult]) => {
        if (!live) return;
        setTasks(taskResult.tasks);
        setItems(itemResult.items);
      })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    setDraft(blank(selectedId ?? null));
    setAdvancedOpen(false);
    return () => { live = false; };
  }, [selectedId]);

  const itemById = useMemo(() => new Map(items.map(item => [item.task_id, item])), [items]);
  const byId = useMemo(() => new Map(tasks?.map(task => [task.id, task]) ?? []), [tasks]);
  const tagsFor = (task: TaskView) => itemById.get(task.id)?.tags ?? [];

  const children = useMemo(() => {
    const grouped = new Map<number | null, TaskView[]>();
    for (const task of tasks ?? []) {
      const parent = task.parent_id !== null && byId.has(task.parent_id) ? task.parent_id : null;
      const siblings = grouped.get(parent) ?? [];
      siblings.push(task);
      grouped.set(parent, siblings);
    }
    return grouped;
  }, [byId, tasks]);

  const selected = selectedId === undefined ? undefined : byId.get(selectedId);
  const excludedParents = new Set<number>();
  const pending = draft.id === null ? [] : [draft.id];
  while (pending.length) {
    const id = pending.pop();
    if (id === undefined) break;
    excludedParents.add(id);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  const hasFilters = Boolean(query.trim() || active || complete || recurrence || tag);
  const allTags = useMemo(() => Array.from(new Set(items.flatMap(item => item.tags))).sort((a, b) => a.localeCompare(b)), [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = selected ? [selected, ...descendantsOf(selected.id, children)] : [...(tasks ?? [])];
    list = list.filter(task => {
      const taskTags = itemById.get(task.id)?.tags ?? [];
      if (needle && !taskSearchText(task, taskTags).includes(needle)) return false;
      if (active === "active" && !task.active) return false;
      if (active === "inactive" && task.active) return false;
      if (complete === "complete" && !task.completed_today) return false;
      if (complete === "incomplete" && task.completed_today) return false;
      if (recurrence && task.recurrence !== recurrence) return false;
      if (tag && !taskTags.includes(tag)) return false;
      return true;
    });
    return list.sort((a, b) => {
      switch (sort) {
        case "created": return Date.parse(b.created_at) - Date.parse(a.created_at);
        case "completed": return completedMs(b) - completedMs(a);
        case "title": return a.title.localeCompare(b.title);
      }
    });
  }, [active, children, complete, itemById, query, recurrence, selected, sort, tag, tasks]);

  const selectionIds = visible.map(task => task.id);
  const selection = useSelection(selectionIds);
  const selectedTasks = visible.filter(task => selection.selected.has(task.id));
  const selectedItemIds = selectedTasks.flatMap(task => { const item = itemById.get(task.id); return item ? [item.id] : []; });

  const mutate = async (action: () => Promise<unknown>, reset = false) => {
    setBusy(true);
    setError("");
    try {
      await action();
      if (reset) {
        setDraft(blank(selectedId ?? null));
        setAdvancedOpen(false);
      }
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try { await load(); onChange?.(); } catch { /* Keep the mutation error visible. */ }
    } finally { setBusy(false); }
  };

  const applyTags = async (taskId: number, desired: readonly string[]) => {
    const item = itemById.get(taskId) ?? (await listItems({ type: "task" })).items.find(entry => entry.task_id === taskId);
    if (!item) throw new Error("This task has no library entry.");
    await patchItem(item.id, { tags: desired });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title || busy) return;
    const input = { title, notes: draft.notes, parent_id: draft.parent_id };
    const desiredTags = parseTags(draft.tags);
    void mutate(async () => {
      if (draft.id === null) {
        const created = await createTask(input);
        setDraft(current => ({ ...current, id: created.id }));
        await applyTags(created.id, desiredTags);
      } else {
        await patchTask(draft.id, input);
        await applyTags(draft.id, desiredTags);
      }
    }, true);
  };

  const openDraft = (next: Draft) => {
    setDraft(next);
    setAdvancedOpen(next.id !== null || next.parent_id !== null || Boolean(next.notes || next.tags));
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      titleRef.current?.focus();
    });
  };

  const bulkTasks = (action: (task: TaskView) => Promise<unknown>, targets = selectedTasks) => mutate(async () => {
    const results = await Promise.allSettled(targets.map(action));
    const failures = results.filter(result => result.status === "rejected");
    if (failures.length) throw new Error(`${failures.length} tasks could not be updated. ${String(failures[0]?.reason ?? "")}`);
  });
  const bulkPatch = (patch: { active?: boolean }, ids = selectedTasks.map(task => task.id)) =>
    bulkTasks(task => patchTask(task.id, patch), (tasks ?? []).filter(task => ids.includes(task.id)));
  const bulkComplete = (done: boolean) => bulkTasks(task => done ? completeTask(task.id) : uncompleteTask(task.id));
  const bulkDelete = () => {
    if (!selectedTasks.length) return;
    if (!confirm(`Delete ${selectedTasks.length} selected task${selectedTasks.length === 1 ? "" : "s"}? Subtasks will become top-level tasks.`)) return;
    void bulkTasks(task => deleteTask(task.id));
  };

  const renderRow = (task: TaskView) => {
    const taskTags = tagsFor(task);
    return (
      <div className="task-row">
        <input
          type="checkbox"
          aria-label={`Select ${task.title}`}
          checked={selection.selected.has(task.id)}
          disabled={busy}
          onChange={() => selection.toggle(task.id)}
        />
        <input
          type="checkbox"
          aria-label={`${task.completed_today ? "Reopen" : "Complete"} ${task.title}`}
          checked={task.completed_today}
          disabled={busy}
          onChange={() => void mutate(() => task.completed_today ? uncompleteTask(task.id) : completeTask(task.id))}
        />
        <div className="task-copy">
          <Link to={`/tasks/${task.id}`} className={task.completed_today ? "task-completed" : ""}>{task.title}</Link>
          {task.notes ? <MarkdownContent text={task.notes} /> : null}
          <div className="task-meta">
            <small>{recurrenceLabel(task)}</small>
            {!task.active ? <small>Inactive</small> : null}
            {task.last_completed ? <small>Last done {task.last_completed}</small> : null}
          </div>
          <TagList tags={taskTags} onClick={name => setParam("tag", name)} />
        </div>
        <div className="page-actions task-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => openDraft(blank(task.id))}>Add subtask</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => openDraft({ id: task.id, title: task.title, notes: task.notes, parent_id: task.parent_id, tags: tagText(taskTags) })}>Edit</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void bulkPatch({ active: !task.active }, [task.id])}>{task.active ? "Deactivate" : "Activate"}</button>
          <button type="button" className="danger" disabled={busy} onClick={() => {
            if (confirm(`Delete "${task.title}"? Its subtasks will become top-level tasks.`)) void mutate(async () => {
              await deleteTask(task.id);
              if (task.id === selectedId) navigate("/tasks");
            }, draft.id === task.id || draft.parent_id === task.id);
          }}>Delete</button>
        </div>
      </div>
    );
  };

  const rank = new Map(visible.map((task, index) => [task.id, index]));
  const renderTree = (rows: TaskView[]) => (
    <ul className="task-tree">
      {[...rows].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).map(task => (
        <li key={task.id}>
          {renderRow(task)}
          {children.has(task.id) ? renderTree(children.get(task.id) ?? []) : null}
        </li>
      ))}
    </ul>
  );

  const renderFlat = () => (
    <div className="task-results">
      <p className="task-filter-note">Showing {visible.length} matching task{visible.length === 1 ? "" : "s"}; parent rows are labels only and are not selected by bulk actions.</p>
      {visible.map(task => {
        const parent = task.parent_id === null ? null : byId.get(task.parent_id);
        return (
          <div key={task.id} className="task-flat-row">
            {parent ? <small className="task-parent-context">Parent: <Link to={`/tasks/${parent.id}`}>{parent.title}</Link></small> : null}
            {renderRow(task)}
          </div>
        );
      })}
    </div>
  );

  return (
    <section>
      {!taskId ? <div className="page-header"><h1>{selected?.title ?? "Tasks"}</h1><Link to="/library?type=task">View in library</Link></div> : null}
      {selectedId !== undefined ? <p><Link to="/tasks">All tasks</Link>{selected?.parent_id !== null && selected?.parent_id !== undefined ? <> / <Link to={`/tasks/${selected.parent_id}`}>{byId.get(selected.parent_id)?.title ?? "Parent task"}</Link></> : null}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <form ref={formRef} className="simple-form field-row task-form" onSubmit={submit}>
        <label className="task-title-field">Title<input ref={titleRef} required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} disabled={busy} placeholder="Add a task…" /></label>
        <button type="submit" className="primary" disabled={busy || !draft.title.trim()}>{busy ? "Saving…" : draft.id !== null ? "Save" : "Add"}</button>
        <button type="button" className="secondary" onClick={() => setAdvancedOpen(open => !open)} aria-expanded={advancedOpen}>{advancedOpen ? "Hide details" : "Details"}</button>
        {draft.id !== null || draft.parent_id !== null ? <button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(blank()); setAdvancedOpen(false); }}>Cancel</button> : null}
        <div className="task-form-details" hidden={!advancedOpen}>
          <label>Markdown notes<textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} disabled={busy} /></label>
          <label>Tags<input value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })} disabled={busy} placeholder="comma, separated" /></label>
          <label>Parent task<select value={draft.parent_id ?? ""} disabled={busy} onChange={event => setDraft({ ...draft, parent_id: event.target.value ? Number(event.target.value) : null })}>
            <option value="">None, top-level task</option>
            {(tasks ?? []).filter(task => !excludedParents.has(task.id)).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select></label>
        </div>
      </form>

      <CollectionToolbar query={query} onQueryChange={value => setParam("q", value)} sort={sort} onSortChange={value => setParam("sort", value)} sortOptions={sortOptions}>
        <label>Status<select value={active} onChange={event => setParam("active", event.target.value)}>
          <option value="">Any</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select></label>
        <label>Done<select value={complete} onChange={event => setParam("complete", event.target.value)}>
          <option value="">Any</option><option value="incomplete">Incomplete</option><option value="complete">Complete today</option>
        </select></label>
        <label>Recurrence<select value={recurrence} onChange={event => setParam("recurrence", event.target.value)}>
          <option value="">Any</option><option value="daily">Daily</option><option value="once">One-time</option>
        </select></label>
        <label>Tag<select value={tag} onChange={event => setParam("tag", event.target.value)}>
          <option value="">Any</option>{allTags.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
      </CollectionToolbar>

      <SelectionBar count={selection.selected.size} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={busy}>
        <button type="button" className="secondary" disabled={busy || !selectedTasks.length} onClick={() => void bulkComplete(true)}>Complete</button>
        <button type="button" className="secondary" disabled={busy || !selectedTasks.length} onClick={() => void bulkComplete(false)}>Reopen</button>
        <button type="button" className="secondary" disabled={busy || !selectedTasks.length} onClick={() => void bulkPatch({ active: true })}>Activate</button>
        <button type="button" className="secondary" disabled={busy || !selectedTasks.length} onClick={() => void bulkPatch({ active: false })}>Deactivate</button>
        <ItemBulkActions ids={selectedItemIds} onChanged={async () => { await load(); onChange?.(); }} />
        <button type="button" className="danger" disabled={busy || !selectedTasks.length} onClick={bulkDelete}>Delete</button>
      </SelectionBar>

      <h2>{selected ? "Task and subtasks" : "All tasks"}</h2>
      {tasks === null ? <p>Loading tasks…</p> : selectedId !== undefined && !selected ? <p>Task not found. <Link to="/tasks">View all tasks</Link></p> : tasks.length ? (hasFilters ? renderFlat() : renderTree(selected ? [selected] : children.get(null) ?? [])) : <p>No tasks yet. Add your first task above.</p>}
    </section>
  );
}

function descendantsOf(id: number, children: ReadonlyMap<number | null, TaskView[]>): TaskView[] {
  const result: TaskView[] = [];
  const pending = [...(children.get(id) ?? [])];
  while (pending.length) {
    const task = pending.shift();
    if (!task) continue;
    result.push(task);
    pending.push(...(children.get(task.id) ?? []));
  }
  return result;
}

function completedMs(task: TaskView): number {
  const value = task.last_completed ? Date.parse(task.last_completed) : 0;
  return Number.isFinite(value) ? value : 0;
}
