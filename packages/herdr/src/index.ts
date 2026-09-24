export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface HerdrSession {
  name: string;
  default: boolean;
  running: boolean;
  session_dir: string;
  socket_path: string;
  snapshot: JsonObject | null;
  error: string | null;
}
export interface HerdrOverview { sessions: HerdrSession[]; updated_at: string }
export interface HerdrField {
  name: string;
  required: boolean;
  kind: "string" | "number" | "boolean" | "json";
  choices: string[];
  description: string;
  schema: Json;
}
export interface HerdrOperation {
  method: string;
  group: string;
  readOnly: boolean;
  fields: HerdrField[];
  schema: Json;
}
export interface HerdrCatalog { protocol: number; operations: HerdrOperation[]; definitions: JsonObject }
export interface HerdrCommand { session: string; method: string; params: JsonObject; capture_ms?: number }
export interface HerdrResult { result: Json; events?: Json[] }
export type SessionAction = "start" | "stop" | "delete";

export function createHerdrClient(request: <T>(path: string, init?: { method?: string; json?: unknown; signal?: AbortSignal }) => Promise<T>) {
  return {
    overview: (signal?: AbortSignal) => request<HerdrOverview>("/api/herdr", { signal }),
    catalog: () => request<HerdrCatalog>("/api/herdr/catalog"),
    command: (command: HerdrCommand, signal?: AbortSignal) => request<HerdrResult>("/api/herdr/command", { method: "POST", json: command, signal }),
    session: (name: string, action: SessionAction) => request<HerdrResult>("/api/herdr/session", { method: "POST", json: { name, action } }),
  };
}
export type HerdrClient = ReturnType<typeof createHerdrClient>;

export function isObject(value: Json | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function text(value: Json | undefined): string {
  return value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

export interface HerdrEntity {
  key: string;
  kind: string;
  id: string;
  label: string;
  session: string;
  workspace: string;
  tab: string;
  status: string;
  agent: string;
  cwd: string;
  focused: boolean;
  details: JsonObject;
}

export function entities(overview: HerdrOverview): HerdrEntity[] {
  const result: HerdrEntity[] = [];
  for (const session of overview.sessions) {
    const add = (kind: string, data: JsonObject) => {
      const id = text(kind === "workspace" ? data.workspace_id : kind === "tab" || kind === "layout" ? data.tab_id : kind === "session" ? session.name : data.pane_id);
      result.push({
        key: JSON.stringify([session.name, kind, id]), kind, id,
        label: text(data.label || data.name || data.terminal_title_stripped || data.title || id),
        session: session.name, workspace: text(data.workspace_id), tab: text(data.tab_id),
        status: kind === "session" ? session.error ? "unavailable" : session.running ? "running" : "stopped" : text(data.agent_status),
        agent: text(data.agent), cwd: text(data.foreground_cwd || data.cwd), focused: data.focused === true, details: data,
      });
    };
    add("session", { name: session.name, running: session.running, default: session.default, session_dir: session.session_dir, socket_path: session.socket_path, error: session.error,
      ...(session.snapshot ? Object.fromEntries(Object.entries(session.snapshot).filter(([, value]) => !Array.isArray(value))) : {}) });
    for (const [collection, kind] of [["workspaces", "workspace"], ["tabs", "tab"], ["panes", "pane"], ["agents", "agent"], ["layouts", "layout"]]) {
      const rows = session.snapshot?.[collection];
      if (Array.isArray(rows)) for (const row of rows) if (isObject(row) && kind) add(kind, row);
    }
  }
  return result;
}

export function targetParams(operation: HerdrOperation, entity?: HerdrEntity): JsonObject {
  if (!entity) return {};
  const pane = text(entity.details.pane_id);
  const candidates: [string, string][] = [
    ...(operation.group === "agent" ? [["target", text(entity.details.name || pane)] satisfies [string, string]] : []),
    ["pane_id", pane],
    [operation.method === "pane.swap" ? "source_pane_id" : "target_pane_id", pane],
    ["caller_pane_id", pane],
    ["tab_id", entity.kind === "tab" ? entity.id : entity.tab],
    ["workspace_id", entity.kind === "workspace" ? entity.id : entity.workspace],
  ];
  const target = candidates.find(([name, value]) => value && operation.fields.some(field => field.name === name));
  return target ? { [target[0]]: target[1] } : {};
}
