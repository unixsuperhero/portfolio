import { createInterface } from "node:readline";
import { OncallApi } from "./client.ts";
import { findTool, toolListing, type ToolContext } from "./tools.ts";
import { isRecord, validateArgs } from "./validate.ts";

export const SERVER_NAME = "portfolio-oncall";
export const SERVER_VERSION = "0.1.0";
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INSTRUCTIONS =
  "Tools for the Portfolio oncall board served by the desktop app (default http://127.0.0.1:4388). " +
  "oncall_list_items shows the Slack threads and pull requests polling has picked up; oncall_update_status " +
  "sets a manual status override; oncall_list_prompts and oncall_run_prompt run the saved oncall prompts and " +
  "oncall_get_prompt_run returns their captured output.";

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface ServerOptions {
  api?: OncallApi;
  /** Defaults to `process.stdin`; overridable so the protocol can be driven in tests. */
  input?: NodeJS.ReadableStream;
  output?: { write(chunk: string): unknown };
  onError?: (message: string) => void;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const asResponse = (id: number | string | null, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const asError = (id: number | string | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

const text = (message: string, isError = false) => ({ content: [{ type: "text", text: message }], ...(isError ? { isError: true } : {}) });

/**
 * Answers one JSON-RPC message: `{ jsonrpc, id?, method, params? }` off the wire.
 * Notifications (no id) return null, since the protocol forbids replying to them.
 */
export async function handleRequest(
  request: unknown,
  context: ToolContext,
  onError: (message: string) => void = () => {},
): Promise<JsonRpcResponse | null> {
  if (!isRecord(request) || typeof request.method !== "string") {
    const id = isRecord(request) && (typeof request.id === "string" || typeof request.id === "number") ? request.id : null;
    return asError(id, INVALID_REQUEST, "invalid request: expected a JSON-RPC object with a method");
  }
  const id = typeof request.id === "string" || typeof request.id === "number" ? request.id : null;
  const notification = request.id === undefined || request.id === null;
  const params = isRecord(request.params) ? request.params : {};
  const { method } = request;

  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      const protocolVersion = typeof requested === "string" && requested ? requested : DEFAULT_PROTOCOL_VERSION;
      return asResponse(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return null;
    case "ping":
      return notification ? null : asResponse(id, {});
    case "tools/list":
      return asResponse(id, { tools: toolListing() });
    case "tools/call":
      return callTool(id, params, context, onError);
    default:
      return notification ? null : asError(id, METHOD_NOT_FOUND, `unknown method: ${method}`);
  }
}

async function callTool(
  id: number | string | null,
  params: Record<string, unknown>,
  { api }: ToolContext,
  onError: (message: string) => void,
): Promise<JsonRpcResponse> {
  const name = params.name;
  if (typeof name !== "string" || !name) return asError(id, INVALID_PARAMS, "tools/call requires a tool name");
  const tool = findTool(name);
  if (!tool) return asError(id, INVALID_PARAMS, `unknown tool: ${name}`);
  const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
  const problems = validateArgs(tool.inputSchema, args);
  if (problems.length) return asResponse(id, text(`invalid arguments for ${name}: ${problems.join("; ")}`, true));
  // validateArgs rejects anything that is not an object, so this narrowing only satisfies the compiler.
  const valid = isRecord(args) ? args : {};
  try {
    const data = await tool.handler(valid, { api });
    return asResponse(id, text(typeof data === "string" ? data : JSON.stringify(data, null, 2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError(`${name} failed: ${message}`);
    return asResponse(id, text(`${name} failed: ${message}`, true));
  }
}

/** Reads newline-delimited JSON-RPC from `input` and writes replies to `output` until the stream ends. */
export async function serve(options: ServerOptions = {}): Promise<void> {
  const api = options.api ?? new OncallApi();
  const output = options.output ?? process.stdout;
  const onError = options.onError ?? ((message: string) => { process.stderr.write(`pf-oncall-mcp: ${message}\n`); });
  const send = (message: unknown): void => { output.write(`${JSON.stringify(message)}\n`); };
  const lines = createInterface({ input: options.input ?? process.stdin, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch (error) {
      send(asError(null, PARSE_ERROR, `parse error: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }
    const batch = Array.isArray(request) ? request : null;
    if (batch) {
      const replies = (await Promise.all(batch.map(entry => handleRequest(entry, { api }, onError)))).filter(reply => reply !== null);
      if (replies.length) send(replies);
      continue;
    }
    const reply = await handleRequest(request, { api }, onError);
    if (reply) send(reply);
  }
}
