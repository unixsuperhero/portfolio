import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { entities, isObject, targetParams, text } from "@portfolio/herdr";
import type { HerdrCatalog, HerdrClient, HerdrEntity, HerdrField, HerdrOperation, HerdrOverview, HerdrResult, Json, JsonObject, SessionAction } from "@portfolio/herdr";
import { CollectionToolbar, SelectionBar, useSelection } from "./collections.tsx";

const EMPTY: HerdrOverview = { sessions: [], updated_at: "" };
const columns = ["label", "kind", "session", "workspace", "tab", "status", "agent", "cwd", "focused"] as const;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
type Draft = Record<string, string>;
type Pending = { title: string; description: string; run: () => Promise<unknown> };

function terminalText(value: unknown): string {
  if (Array.isArray(value)) return value.map(terminalText).filter(Boolean).join("\n\n");
  if (!value || typeof value !== "object") return "";
  if ("read" in value && value.read && typeof value.read === "object" && "text" in value.read && typeof value.read.text === "string") return value.read.text;
  return "result" in value ? terminalText(value.result) : "";
}

function parameters(operation: HerdrOperation, draft: Draft, defaults: JsonObject): JsonObject {
  if (draft.$raw !== undefined) {
    const parsed: Json = JSON.parse(draft.$raw);
    if (!isObject(parsed)) throw new Error("Parameters must be a JSON object.");
    return parsed;
  }
  const values: JsonObject = {};
  for (const field of operation.fields) {
    const raw = draft[field.name] ?? (defaults[field.name] === undefined ? undefined : text(defaults[field.name]));
    if (raw === undefined) {
      if (field.required) throw new Error(`${field.name} is required.`);
      continue;
    }
    if (field.kind === "number") {
      if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error(`${field.name} must be a number.`);
      values[field.name] = Number(raw);
    } else if (field.kind === "boolean") values[field.name] = raw === "true";
    else if (field.kind === "json") {
      try { values[field.name] = JSON.parse(raw); } catch { throw new Error(`${field.name} must contain valid JSON.`); }
    } else values[field.name] = raw;
  }
  return values;
}

function ParameterField({ field, value, onChange }: { field: HerdrField; value: string | undefined; onChange: (value: string | undefined) => void }) {
  const id = useId();
  const enabled = field.required || value !== undefined;
  return <div className="herdr-parameter">
    <div className="herdr-field-heading">
      <label htmlFor={id}>{field.name}{field.required ? " *" : ""}</label>
      {!field.required ? <label className="herdr-include"><input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked ? field.kind === "boolean" ? "false" : "" : undefined)} /> Include</label> : null}
    </div>
    {field.choices.length || field.kind === "boolean" ? <select id={id} disabled={!enabled} required={field.required} value={value ?? ""} onChange={event => onChange(event.target.value)}>
      <option value="">Choose…</option>{(field.kind === "boolean" ? ["true", "false"] : field.choices).map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select> : field.kind === "json" || ["text", "prompt", "input", "command"].includes(field.name) ? <textarea id={id} disabled={!enabled} required={field.required} value={value ?? ""} rows={field.kind === "json" ? 4 : 3} spellCheck={false} onChange={event => onChange(event.target.value)} /> :
      <input id={id} disabled={!enabled} required={field.required} type={field.kind === "number" ? "number" : "text"} step="any" value={value ?? ""} onChange={event => onChange(event.target.value)} />}
    {field.description ? <small>{field.description}</small> : null}
    {field.kind === "json" ? <details><summary>{field.name} schema</summary><pre>{pretty(field.schema)}</pre></details> : null}
  </div>;
}

function EntityList({ all, visible, selected, selection, onPick }: {
  all: HerdrEntity[];
  visible: HerdrEntity[];
  selected: HerdrEntity | undefined;
  selection: { selected: Set<string>; toggle: (key: string) => void };
  onPick: (entity: HerdrEntity) => void;
}) {
  const byKey = new Map(all.map(entity => [entity.key, entity]));
  const parents = new Map<string, string>();
  const children = new Map<string, HerdrEntity[]>();
  for (const entity of all) {
    const find = (kind: string, id: string) => id ? byKey.get(JSON.stringify([entity.session, kind, id])) : undefined;
    const parent = entity.kind === "session" ? undefined
      : (entity.kind === "agent" ? find("pane", text(entity.details.pane_id)) : undefined)
        ?? (entity.kind === "pane" || entity.kind === "agent" || entity.kind === "layout" ? find("tab", entity.tab) : undefined)
        ?? (entity.kind !== "workspace" ? find("workspace", entity.workspace) : undefined)
        ?? find("session", entity.session);
    if (parent) parents.set(entity.key, parent.key);
    const parentKey = parent?.key ?? "";
    const siblings = children.get(parentKey) ?? [];
    siblings.push(entity);
    children.set(parentKey, siblings);
  }
  const matches = new Set(visible.map(entity => entity.key));
  const included = new Set(matches);
  for (const entity of visible) {
    let parent = parents.get(entity.key);
    while (parent && !included.has(parent)) {
      included.add(parent);
      parent = parents.get(parent);
    }
  }
  const render = (parentKey: string): ReactNode => {
    const rows = children.get(parentKey)?.filter(entity => included.has(entity.key));
    if (!rows?.length) return null;
    return <ul className="herdr-entity-list" aria-label={parentKey ? undefined : "Session hierarchy"}>
      {rows.map(entity => <li key={entity.key}>
        <div className="herdr-entity-row" data-selected={selected?.key === entity.key}>
          <input type="checkbox" aria-label={`Select ${entity.kind} ${entity.label} in ${entity.session}`} disabled={!matches.has(entity.key)} checked={selection.selected.has(entity.key)} onChange={() => selection.toggle(entity.key)} />
          <div className="herdr-entity-info">
            <button type="button" className="herdr-entity-link" aria-current={selected?.key === entity.key ? "true" : undefined} onClick={() => onPick(entity)}>{entity.label}</button>
            <small>{entity.kind} · {entity.id}{entity.focused ? " · focused" : ""}{!matches.has(entity.key) ? " · parent context" : ""}</small>
            {entity.agent ? <small>{entity.agent}</small> : null}
            {entity.cwd ? <small title={entity.cwd}>{entity.cwd}</small> : null}
          </div>
          <span className={`herdr-status herdr-status-${entity.status}`}>{entity.status || "—"}</span>
        </div>
        {render(entity.key)}
      </li>)}
    </ul>;
  };
  return render("");
}

export function HerdrPage({ client, params, onParamsChange }: {
  client: HerdrClient;
  params: URLSearchParams;
  onParamsChange: (params: URLSearchParams) => void;
}) {
  const [overview, setOverview] = useState<HerdrOverview>(EMPTY);
  const [catalog, setCatalog] = useState<HerdrCatalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<unknown>();
  const terminalOutput = useMemo(() => terminalText(output), [output]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newSession, setNewSession] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const commandRef = useRef<AbortController | null>(null);
  const autoRefresh = params.get("refresh") !== "off";
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    onParamsChange(next);
  };

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const result = await client.overview(controller.signal);
      if (!controller.signal.aborted) { setOverview(result); setLoadError(""); }
    } catch (error) { if (!controller.signal.aborted) setLoadError(message(error)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [client]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!disposed && !document.hidden) await refresh();
      if (!disposed && autoRefresh) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => { disposed = true; clearTimeout(timer); requestRef.current?.abort(); };
  }, [refresh, autoRefresh]);
  useEffect(() => {
    let disposed = false;
    client.catalog().then(value => { if (!disposed) { setCatalog(value); setCatalogError(""); } }).catch(error => { if (!disposed) setCatalogError(message(error)); });
    return () => { disposed = true; commandRef.current?.abort(); };
  }, [client]);
  useEffect(() => {
    if (pending) confirmRef.current?.showModal(); else confirmRef.current?.close();
  }, [pending]);

  const all = useMemo(() => entities(overview), [overview]);
  const query = (params.get("q") ?? "").toLowerCase();
  const attribute = params.get("attribute") ?? "";
  const attributeValue = params.get("value") ?? "";
  const sort = params.get("sort") ?? "hierarchy";
  const scalarKeys = [...new Set(all.flatMap(entity => Object.keys(entity.details).filter(key => !isObject(entity.details[key]) && !Array.isArray(entity.details[key]))))].sort();
  const scalar = (entity: HerdrEntity, key: string) => {
    const column = columns.find(column => column === key);
    return key.startsWith("detail:") ? text(entity.details[key.slice(7)]) : column ? text(entity[column]) : entity.label;
  };
  const ordered = [...all].sort((a, b) => sort === "hierarchy" ? a.session.localeCompare(b.session) || ["session", "workspace", "tab", "pane", "agent", "layout"].indexOf(a.kind) - ["session", "workspace", "tab", "pane", "agent", "layout"].indexOf(b.kind) || a.id.localeCompare(b.id, undefined, { numeric: true }) : scalar(a, sort).localeCompare(scalar(b, sort), undefined, { numeric: true }) || a.key.localeCompare(b.key));
  const visible = ordered.filter(entity => (!query || pretty(entity).toLowerCase().includes(query))
    && columns.slice(1).every(key => !params.get(key) || text(entity[key]) === params.get(key))
    && (!attribute || !attributeValue || text(entity.details[attribute]) === attributeValue));
  const selection = useSelection(visible.map(entity => entity.key));
  const selected = all.find(entity => entity.key === params.get("entity"));
  const sessionName = params.get("targetSession") ?? selected?.session ?? overview.sessions.find(session => session.running)?.name ?? overview.sessions[0]?.name ?? "";
  const method = params.get("method") ?? (selected?.kind === "agent" ? "agent.get" : selected?.kind === "pane" ? "pane.get" : "session.snapshot");
  const operation = catalog?.operations.find(value => value.method === method);
  const operationQuery = (params.get("opq") ?? "").toLowerCase();
  const operationSort = params.get("opsort") ?? "method";
  const operations = (catalog?.operations ?? []).filter(value => (!params.get("group") || value.group === params.get("group"))
    && (!params.get("access") || (value.readOnly ? "read" : "write") === params.get("access"))
    && (!operationQuery || pretty(value.fields.map(field => ({ name: field.name, description: field.description }))).toLowerCase().includes(operationQuery) || value.method.includes(operationQuery)))
    .sort((a, b) => operationSort === "access" ? Number(a.readOnly) - Number(b.readOnly) || a.method.localeCompare(b.method) : a.method.localeCompare(b.method));
  const key = JSON.stringify([sessionName, method, params.get("entity")]);
  const draft = drafts[key] ?? {};
  const defaults = operation ? targetParams(operation, selected?.session === sessionName ? selected : undefined) : {};
  const setField = (name: string, value: string | undefined) => setDrafts(current => {
    const next = { ...(current[key] ?? {}) };
    if (value === undefined) { delete next[name]; if (defaults[name] !== undefined) next[`$omit:${name}`] = "1"; }
    else { next[name] = value; delete next[`$omit:${name}`]; }
    return { ...current, [key]: next };
  });
  const actualDefaults = Object.fromEntries(Object.entries(defaults).filter(([name]) => !draft[`$omit:${name}`]));

  const execute = async (run: () => Promise<unknown>) => {
    if (busy) return;
    commandRef.current = null;
    setBusy(true); setActionError("");
    try { setOutput(await run()); }
    catch (error) { setActionError(message(error)); }
    finally { setBusy(false); await refresh(); }
  };
  const invoke = (values: JsonObject, targets: HerdrEntity[] = []) => {
    if (!operation) return;
    const commands = targets.length ? targets.map(entity => {
      const target = targetParams(operation, entity);
      if (!Object.keys(target).length) throw new Error(`${entity.kind} ${entity.label} is not a target for ${operation.method}. Select compatible entities.`);
      return { session: entity.session, method: operation.method, params: { ...values, ...target } };
    }) : [{ session: sessionName, method: operation.method, params: values }];
    const run = async () => {
      const controller = new AbortController(); commandRef.current = controller;
      const results: { session: string; result?: HerdrResult; error?: string }[] = [];
      for (const command of commands) {
        if (controller.signal.aborted) break;
        try { results.push({ session: command.session, result: await client.command(command, controller.signal) }); }
        catch (error) { results.push({ session: command.session, error: controller.signal.aborted ? "Cancelled waiting. An accepted Herdr command is not undone." : message(error) }); }
      }
      const errors = results.filter(result => result.error).map(result => `${result.session}: ${result.error}`);
      if (errors.length) setActionError(errors.join("\n"));
      return results;
    };
    if (operation.readOnly) void execute(run);
    else setPending({ title: `Run ${operation.method}?`, description: `This changes the live Herdr session. Review the exact targets and parameters:\n${pretty(commands)}`, run });
  };
  const lifecycle = (name: string, action: SessionAction) => {
    if (!name.trim()) { setActionError("Enter a session name."); return; }
    setPending({ title: `${action[0]?.toUpperCase()}${action.slice(1)} session ${name}?`, description: action === "stop" ? "Stops this session and its terminal processes. Other sessions remain running." : action === "delete" ? "Permanently removes the saved state of this stopped session." : "Starts a persistent headless Herdr session. It remains running when Portfolio closes.", run: () => client.session(name, action) });
  };
  const pickEntity = (entity: HerdrEntity) => {
    const next = new URLSearchParams(params);
    next.set("entity", entity.key); next.set("targetSession", entity.session);
    next.set("method", entity.kind === "session" ? "session.snapshot" : entity.kind === "layout" ? "layout.export" : `${entity.kind}.get`);
    onParamsChange(next);
  };

  return <section className="herdr-page" aria-label="Herdr console">
    <header className="herdr-header"><div><h1>Herdr</h1><p>{overview.sessions.filter(session => session.running).length} running sessions · {all.filter(entity => entity.kind === "pane").length} panes · {all.filter(entity => entity.kind === "agent").length} agents</p></div>
      <div className="herdr-actions"><label><input type="checkbox" checked={autoRefresh} onChange={event => setParam("refresh", event.target.checked ? "" : "off")} /> Live refresh</label><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    </header>
    <p className="herdr-freshness">{overview.updated_at ? `Snapshot ${new Date(overview.updated_at).toLocaleTimeString()}` : "Waiting for Herdr…"} · {autoRefresh ? "Updates every 5 seconds; drafts stay in place." : "Automatic refresh paused."}</p>
    {loadError ? <p role="alert" className="herdr-error">{loadError} <button type="button" onClick={() => void refresh()}>Retry discovery</button></p> : null}
    <details className="herdr-session-create"><summary>Create or start a session</summary><form className="herdr-actions" onSubmit={event => { event.preventDefault(); lifecycle(newSession.trim(), "start"); }}><label>Session name<input value={newSession} onChange={event => setNewSession(event.target.value)} required maxLength={64} /></label><button disabled={busy}>Start session</button></form></details>
    <CollectionToolbar query={params.get("q") ?? ""} onQueryChange={value => setParam("q", value)} sort={sort} onSortChange={value => setParam("sort", value)} sortOptions={[{ value: "hierarchy", label: "Session hierarchy" }, ...columns.map(value => ({ value, label: value })), ...scalarKeys.map(value => ({ value: `detail:${value}`, label: value }))]}>
      {columns.slice(1).map(column => <label key={column}>{column}<select aria-label={`Filter ${column}`} value={params.get(column) ?? ""} onChange={event => setParam(column, event.target.value)}><option value="">All</option>{[...new Set(all.map(entity => text(entity[column])).filter(Boolean))].sort().map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
    </CollectionToolbar>
    <details className="herdr-attribute-filter"><summary>Filter by another attribute</summary><div className="herdr-actions"><label>Attribute<select value={attribute} onChange={event => { const next = new URLSearchParams(params); next.set("attribute", event.target.value); next.delete("value"); onParamsChange(next); }}><option value="">Any attribute</option>{scalarKeys.map(value => <option key={value}>{value}</option>)}</select></label><label>Value<select value={attributeValue} onChange={event => setParam("value", event.target.value)}><option value="">Any value</option>{[...new Set(all.map(entity => text(entity.details[attribute])).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label></div></details>
    <SelectionBar count={selection.selected.size} total={visible.length} allSelected={selection.allSelected} onToggleAll={selection.toggleAll} onClear={selection.clear} busy={busy}>
      <button type="button" onClick={() => setOutput(visible.filter(entity => selection.selected.has(entity.key)).map(entity => ({ session: entity.session, kind: entity.kind, ...entity.details })))}>Inspect selected</button>
    </SelectionBar>
    <div className="herdr-workbench">
      <div className="herdr-entities"><div className="herdr-list-scroll">
        <EntityList all={ordered} visible={visible} selected={selected} selection={selection} onPick={pickEntity} />
      </div>
      {!visible.length ? <p className="herdr-empty">{loading && !overview.updated_at ? "Loading sessions…" : all.length ? "No entities match these filters." : "No Herdr sessions found. Start a session above."}</p> : null}
      {selected ? <section className="herdr-inspector"><h2>{selected.kind}: {selected.label}</h2><p>{selected.session} / {selected.id}</p>
        {selected.kind === "session" ? <div className="herdr-actions"><button type="button" disabled={busy || selected.details.running === true} onClick={() => lifecycle(selected.session, "start")}>Start</button><button type="button" disabled={busy || selected.details.running !== true} onClick={() => lifecycle(selected.session, "stop")}>Stop session</button><button type="button" disabled={busy || selected.details.running === true || selected.details.default === true} onClick={() => lifecycle(selected.session, "delete")}>Delete saved session</button></div> : null}
        <pre tabIndex={0} aria-label="Entity details">{pretty(selected.details)}</pre></section> : null}
      {params.has("entity") && !selected ? <p role="status">The selected entity is no longer available. Its command draft has been kept.</p> : null}
      <details><summary>Complete session snapshots</summary><pre tabIndex={0}>{pretty(overview)}</pre></details>
      </div>
      <section className="herdr-controls" aria-label="Herdr controls"><h2>Controls</h2><p>{catalog ? `${catalog.operations.length} operations · protocol ${catalog.protocol}` : "Loading installed capabilities…"}</p>
        {catalogError ? <p role="alert" className="herdr-error">{catalogError}<button type="button" onClick={() => { void client.catalog().then(value => { setCatalog(value); setCatalogError(""); }).catch(error => setCatalogError(message(error))); }}>Retry capabilities</button></p> : null}
        <CollectionToolbar query={params.get("opq") ?? ""} onQueryChange={value => setParam("opq", value)} sort={operationSort} onSortChange={value => setParam("opsort", value)} sortOptions={[{ value: "method", label: "Operation" }, { value: "access", label: "Access" }]}>
          <label>Concept<select value={params.get("group") ?? ""} onChange={event => setParam("group", event.target.value)}><option value="">All concepts</option>{[...new Set(catalog?.operations.map(value => value.group))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Access<select value={params.get("access") ?? ""} onChange={event => setParam("access", event.target.value)}><option value="">All controls</option><option value="read">Read only</option><option value="write">Changes state</option></select></label>
        </CollectionToolbar>
        <label>Operation<select value={method} onChange={event => setParam("method", event.target.value)}>{!operations.some(value => value.method === method) ? <option value={method}>{method} (selected)</option> : null}{operations.map(value => <option key={value.method} value={value.method}>{value.method}{value.readOnly ? "" : " — changes state"}</option>)}</select></label>
        <label>Target session<select value={sessionName} onChange={event => setParam("targetSession", event.target.value)}><option value="">Choose a session</option>{overview.sessions.map(session => <option key={session.name} value={session.name}>{session.name}{session.running ? "" : " (stopped)"}</option>)}</select></label>
        {operation ? <form onSubmit={event => { event.preventDefault(); try { invoke(parameters(operation, draft, actualDefaults)); } catch (error) { setActionError(message(error)); } }}>
          <fieldset disabled={busy}><legend>{operation.method}</legend>
            <p>{operation.readOnly ? "Reads live state without changing it." : "Changes the live session. You will review the request before it runs."}</p>
            <label className="herdr-json-toggle"><input type="checkbox" checked={draft.$raw !== undefined} onChange={event => {
              if (event.target.checked) { try { setField("$raw", pretty(parameters({ ...operation, fields: operation.fields.map(field => ({ ...field, required: false })) }, draft, actualDefaults))); } catch { setField("$raw", pretty(actualDefaults)); } }
              else {
                try {
                  const values: Json = JSON.parse(draft.$raw ?? "{}");
                  if (!isObject(values)) throw new Error("Expected a parameter object.");
                  if (Object.values(values).some(value => value === null)) throw new Error("Keep JSON mode enabled to preserve explicit null values.");
                  const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, operation.fields.find(field => field.name === name)?.kind === "string" ? text(value) : pretty(value)]));
                  for (const name of Object.keys(defaults)) if (!(name in values)) fields[`$omit:${name}`] = "1";
                  setDrafts(current => ({ ...current, [key]: fields }));
                } catch (error) { setActionError(message(error)); }
              }
            }} /> Edit parameters as JSON (including null values)</label>
            {draft.$raw !== undefined ? <label>Parameters JSON<textarea rows={10} spellCheck={false} value={draft.$raw} onChange={event => setField("$raw", event.target.value)} /></label> : operation.fields.map(field => <ParameterField key={field.name} field={field} value={draft[field.name] ?? (actualDefaults[field.name] === undefined ? undefined : text(actualDefaults[field.name]))} onChange={value => setField(field.name, value)} />)}
            {operation.method === "events.subscribe" ? <p>Captures events for 5 seconds, then disconnects. Refresh remains independent.</p> : null}
            <div className="herdr-actions"><button type="submit" disabled={!overview.sessions.some(session => session.name === sessionName && session.running)}>{busy ? "Running…" : operation.method === "events.subscribe" ? "Capture events (5s)" : "Run operation"}</button>
              {selection.selected.size > 0 && operation.fields.some(field => ["workspace_id", "tab_id", "pane_id", "target"].includes(field.name)) ? <button type="button" onClick={() => { try { invoke(parameters(operation, draft, actualDefaults), visible.filter(entity => selection.selected.has(entity.key))); } catch (error) { setActionError(message(error)); } }}>Run on {selection.selected.size} selected</button> : null}</div>
          </fieldset>
          <details><summary>Full parameter schema</summary><pre>{pretty({ parameters: operation.schema, definitions: catalog?.definitions })}</pre></details>
        </form> : null}
      </section>
    </div>
    <section className="herdr-output" aria-label="Operation result">
      <h2>Result</h2>
      {busy ? <p role="status">Waiting for Herdr… {commandRef.current ? <button type="button" onClick={() => commandRef.current?.abort()}>Cancel waiting</button> : null}</p> : null}
      {actionError ? <p role="alert" className="herdr-error">{actionError}</p> : null}
      {terminalOutput ? <pre tabIndex={0} aria-label="Terminal output">{terminalOutput}</pre> : null}
      {output !== undefined ? <pre tabIndex={0} aria-label="Full response">{pretty(output)}</pre> : <p>Inspect an entity or run a control to see its full response here.</p>}
    </section>
    <dialog ref={confirmRef} className="herdr-confirm" aria-labelledby="herdr-confirm-title" onCancel={event => { event.preventDefault(); setPending(null); }}>
      {pending ? <><h2 id="herdr-confirm-title">{pending.title}</h2><pre>{pending.description}</pre><div className="herdr-actions"><button type="button" autoFocus onClick={() => setPending(null)}>Cancel</button><button type="button" className="danger" onClick={() => { const run = pending.run; setPending(null); void execute(run); }}>Confirm and run</button></div></> : null}
    </dialog>
  </section>;
}
