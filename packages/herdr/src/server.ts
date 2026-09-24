import { connect } from "node:net";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { isObject, text } from "./index.ts";
import type { HerdrCatalog, HerdrCommand, HerdrField, HerdrOverview, HerdrResult, HerdrSession, Json, JsonObject, SessionAction } from "./index.ts";

export class HerdrError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

function parseObject(raw: string): JsonObject {
  const value: Json = JSON.parse(raw);
  if (!isObject(value)) throw new HerdrError("Herdr returned an invalid JSON object");
  return value;
}

const sessionValidator = new Ajv2020().compile<Omit<HerdrSession, "snapshot" | "error">[]>({
  type: "array", items: { type: "object", required: ["name", "default", "running", "session_dir", "socket_path"], properties: {
    name: { type: "string" }, default: { type: "boolean" }, running: { type: "boolean" }, session_dir: { type: "string" }, socket_path: { type: "string" },
  } },
});
const readMethods = new Set([
  "ping", "server.agent_manifests", "session.snapshot", "workspace.list", "workspace.get", "worktree.list", "tab.list", "tab.get",
  "agent.list", "agent.get", "agent.read", "agent.explain", "agent.wait", "pane.layout", "pane.process_info", "layout.export",
  "pane.neighbor", "pane.edges", "pane.list", "pane.current", "pane.get", "pane.read", "pane.graphics.info", "events.subscribe", "events.wait",
  "pane.wait_for_output", "plugin.list", "plugin.action.list", "plugin.log.list",
]);

export class HerdrService {
  private metadata?: Promise<{ catalog: HerdrCatalog; validate: ValidateFunction }>;
  private starting = new Map<string, Promise<HerdrResult>>();
  constructor(private bin = process.env.HERDR_BIN ?? Bun.which("herdr") ?? join(homedir(), ".local", "bin", "herdr"), private env = process.env) {}

  private async cli(args: string[]): Promise<JsonObject> {
    let proc;
    try { proc = Bun.spawn([this.bin, ...args], { env: this.env, stdout: "pipe", stderr: "pipe" }); }
    catch (error) { throw new HerdrError(`Cannot start Herdr (${this.bin}): ${String(error)}`, 503); }
    const timer = setTimeout(() => proc.kill(), 15_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) throw new HerdrError(stderr.trim() || `Herdr exited with code ${code}`, 503);
      return stdout.trim() ? parseObject(stdout) : { ok: true };
    } finally { clearTimeout(timer); }
  }

  private async sessions() {
    const result = await this.cli(["session", "list", "--json"]);
    if (!sessionValidator(result.sessions)) throw new HerdrError("Herdr session list has an unsupported shape");
    return result.sessions;
  }

  private schema() {
    if (!this.metadata) {
      this.metadata = this.loadSchema().catch(error => { this.metadata = undefined; throw error; });
    }
    return this.metadata;
  }

  private async loadSchema() {
    const document = await this.cli(["api", "schema", "--json"]);
    const schemas = document.schemas;
    const request = isObject(schemas) ? schemas.request : null;
    if (!isObject(request) || !Array.isArray(request.oneOf) || !isObject(request.$defs)) throw new HerdrError("Unsupported Herdr API schema");
    const defs = request.$defs;
    const deref = (value: Json | undefined): JsonObject => {
      if (!isObject(value)) return {};
      if (typeof value.$ref === "string") {
        const name = value.$ref.split("/").at(-1) ?? "";
        const definition = defs[name];
        return isObject(definition) ? definition : value;
      }
      return value;
    };
    const operations = request.oneOf.map(variant => {
      if (!isObject(variant) || !isObject(variant.properties)) throw new HerdrError("Unsupported Herdr operation schema");
      const method = text(deref(variant.properties.method).const);
      const params = deref(variant.properties.params);
      const properties = isObject(params.properties) ? params.properties : {};
      const required = Array.isArray(params.required) ? params.required : [];
      const fields: HerdrField[] = Object.entries(properties).map(([name, value]) => {
        let schema = deref(value);
        const alternatives = schema.anyOf;
        if (Array.isArray(alternatives)) {
          const nonNull = alternatives.filter(v => deref(v).type !== "null");
          if (nonNull.length === 1) schema = deref(nonNull[0]);
        }
        const type = Array.isArray(schema.type) ? schema.type.find(v => v !== "null") : schema.type;
        return { name, required: required.includes(name), kind: type === "string" ? "string" : type === "integer" || type === "number" ? "number" : type === "boolean" ? "boolean" : "json",
          choices: Array.isArray(schema.enum) ? schema.enum.filter((v): v is string => typeof v === "string") : [], description: text(schema.description), schema };
      });
      return { method, group: method.split(".")[0] ?? method, readOnly: readMethods.has(method), fields, schema: params };
    });
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addSchema(document, "herdr");
    const validate = ajv.compile({ $ref: "herdr#/schemas/request" });
    return { catalog: { protocol: Number(document.protocol), operations, definitions: defs }, validate };
  }

  async catalog(): Promise<HerdrCatalog> { return (await this.schema()).catalog; }

  async overview(signal?: AbortSignal): Promise<HerdrOverview> {
    const sessions = await this.sessions();
    return { updated_at: new Date().toISOString(), sessions: await Promise.all(sessions.map(async session => {
      if (!session.running) return { ...session, snapshot: null, error: null };
      try {
        const { result } = await this.socket(session.socket_path, "session.snapshot", {}, signal);
        if (!isObject(result) || !isObject(result.snapshot)) throw new HerdrError("Herdr returned no session snapshot");
        return { ...session, snapshot: result.snapshot, error: null };
      } catch (error) { return { ...session, snapshot: null, error: error instanceof Error ? error.message : String(error) }; }
    })) };
  }

  async command(command: HerdrCommand, signal?: AbortSignal): Promise<HerdrResult> {
    const { validate } = await this.schema();
    if (!validate({ id: "portfolio", method: command.method, params: command.params })) {
      const relevant = validate.errors?.filter(error => !error.instancePath.endsWith("/method") && error.keyword !== "oneOf");
      throw new HerdrError(`Invalid parameters for ${command.method}: ${JSON.stringify(relevant?.slice(0, 6))}`, 422);
    }
    if (command.capture_ms !== undefined && (!Number.isInteger(command.capture_ms) || command.capture_ms < 100 || command.capture_ms > 30_000)) throw new HerdrError("capture_ms must be between 100 and 30000", 422);
    const session = (await this.sessions()).find(value => value.name === command.session);
    if (!session) throw new HerdrError("Herdr session not found", 404);
    if (!session.running) throw new HerdrError("Herdr session is stopped", 409);
    return this.socket(session.socket_path, command.method, command.params, signal, command.capture_ms);
  }

  async session(name: string, action: SessionAction): Promise<HerdrResult> {
    if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,63}$/.test(name) || name === "." || name === "..") throw new HerdrError("Use a session name containing letters, digits, dots, hyphens, or underscores (maximum 64 characters; no leading hyphen)", 422);
    const current = (await this.sessions()).find(session => session.name === name);
    if (action !== "start") {
      if (!current) throw new HerdrError("Herdr session not found", 404);
      return { result: await this.cli(["session", action, name, "--json"]) };
    }
    if (current?.running) return { result: { name, running: true } };
    const pending = this.starting.get(name);
    if (pending) return pending;
    const start = this.start(name).finally(() => this.starting.delete(name));
    this.starting.set(name, start);
    return start;
  }

  private async start(name: string): Promise<HerdrResult> {
    const child = spawn(this.bin, ["--session", name, "server"], { env: this.env, detached: true, stdio: "ignore" });
    let failure: Error | undefined;
    child.on("error", error => { failure = error; });
    try {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (failure) throw failure;
        if (child.exitCode !== null) throw new HerdrError(`Herdr server exited with code ${child.exitCode}; inspect the session's herdr-server.log`);
        const session = (await this.sessions()).find(value => value.name === name && value.running);
        if (session) {
          await this.socket(session.socket_path, "ping", {});
          child.unref();
          return { result: { name, running: true } };
        }
        await Bun.sleep(100);
      }
      throw new HerdrError("Herdr session did not become ready within 15 seconds", 504);
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  private socket(path: string, method: string, params: JsonObject, signal?: AbortSignal, captureMs = 5000): Promise<HerdrResult> {
    const { promise, resolve, reject } = Promise.withResolvers<HerdrResult>();
    const id = crypto.randomUUID();
    const payload = JSON.stringify({ id, method, params }) + "\n";
    if (Buffer.byteLength(payload) > 1024 * 1024) return Promise.reject(new HerdrError("Herdr request exceeds 1 MiB", 413));
    const socket = connect(path);
    const events: Json[] = [];
    let buffer = "";
    let bytes = 0;
    let settled = false;
    let subscription: Json | undefined;
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => finish(new HerdrError("Herdr command timed out; it may still be running. Refresh before retrying.", 504)), method === "session.snapshot" || method === "ping" ? 5000 : 90_000);
    const abort = () => finish(new HerdrError("Herdr request cancelled; an accepted command is not undone", 499));
    function finish(error?: Error, result?: HerdrResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout); clearTimeout(captureTimer);
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error); else resolve(result ?? { result: subscription ?? null, events });
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return promise; }
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(payload));
    socket.on("error", error => finish(new HerdrError(error.message)));
    socket.on("end", () => finish(new HerdrError("Herdr disconnected before replying; refresh before retrying")));
    socket.on("data", chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 16 * 1024 * 1024) { finish(new HerdrError("Herdr response exceeds 16 MiB; narrow the request")); return; }
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const response = parseObject(line);
          if (isObject(response.error)) { finish(new HerdrError(`${text(response.error.code)}: ${text(response.error.message)}`, 409)); return; }
          if (response.id === id) {
            if (response.result === undefined) throw new HerdrError("Herdr response has no result");
            if (method !== "events.subscribe") { finish(undefined, { result: response.result }); return; }
            subscription = response.result;
            captureTimer = setTimeout(() => finish(), captureMs);
          } else if (subscription !== undefined) events.push(response);
          else throw new HerdrError("Herdr returned an unexpected response id");
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return; }
      }
    });
    return promise;
  }
}
