import { OncallApiError, type OncallApi, type OncallItemKind, type OncallItemStatus, type PromptRun } from "./client.ts";
import type { JsonSchema } from "./validate.ts";

export interface ToolContext {
  api: OncallApi;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

const STATUS_VALUES = ["open", "working", "blocked", "done", "dismissed"] as const;
const KIND_VALUES = ["slack", "pr"] as const;
/** `auto` (and null) drop the manual override and fall back to the board's suggested status. */
const STATUS_CHOICES = [...STATUS_VALUES, "auto"] as const;

const asString = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};
const asInteger = (args: Record<string, unknown>, key: string): number | undefined => {
  const value = args[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
};
const requiredString = (args: Record<string, unknown>, key: string): string => {
  const value = asString(args, key);
  if (value === undefined) throw new Error(`"${key}" is required`);
  return value;
};
const requiredInteger = (args: Record<string, unknown>, key: string): number => {
  const value = asInteger(args, key);
  if (value === undefined) throw new Error(`"${key}" is required`);
  return value;
};

// Arguments arrive as unknown, so the enums are re-checked here before they reach the typed client.
const isKind = (value: string): value is OncallItemKind => (KIND_VALUES as readonly string[]).includes(value);
const isStatus = (value: string): value is OncallItemStatus => (STATUS_VALUES as readonly string[]).includes(value);

/** A run that is still going has no output yet: say so instead of returning a blank field. */
const runSummary = (run: PromptRun): { run: PromptRun; note?: string } =>
  run.status === "running"
    ? { run, note: `run ${run.id} is still running; call oncall_get_prompt_run with id ${run.id} to collect its output.` }
    : { run };

const oncall_list_items: ToolDefinition = {
  name: "oncall_list_items",
  title: "List oncall items",
  description:
    "List the oncall board: the Slack threads and pull requests the desktop app polls every 6 minutes, " +
    "with each item's effective status, suggested status, links, and author. " +
    "Also reports when the board was last polled and any polling error. Newest first.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["all", ...STATUS_VALUES],
        description: "Only items with this effective status; \"all\" (the default) returns everything.",
        default: "all",
      },
      kind: { type: "string", enum: KIND_VALUES, description: "Only Slack items or only pull requests." },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum items to return (default 50).", default: 50 },
    },
    additionalProperties: false,
  },
  async handler(args, { api }) {
    const board = await api.board();
    const status = asString(args, "status") ?? "all";
    const kind = asString(args, "kind");
    const limit = asInteger(args, "limit") ?? 50;
    const items = board.items.filter(item => (status === "all" || item.status === status) && (!kind || item.kind === kind));
    return {
      last_polled_at: board.last_polled_at,
      polling_error: board.polling_error,
      total: board.items.length,
      count: Math.min(items.length, limit),
      items: items.slice(0, limit),
    };
  },
};

const oncall_create_item: ToolDefinition = {
  name: "oncall_create_item",
  title: "Create oncall item",
  description:
    "Add an item to the oncall board by hand — something neither Slack polling nor the PR watcher picked up. " +
    "Give a title and, ideally, the context in body. Slack and PR fields are optional: when a field is omitted " +
    "it is stored as null. `status` sets a manual override immediately; omit it to let the board suggest one.",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, description: "Short one-line summary of the item." },
      body: { type: "string", description: "Details: what happened, what is blocked, links." },
      kind: { type: "string", enum: KIND_VALUES, description: "Defaults to \"slack\"." },
      status: { type: "string", enum: STATUS_VALUES, description: "Manual status override; omit for no override." },
      pr_url: { type: "string", description: "Pull request URL, for kind \"pr\"." },
      slack_channel: { type: "string", description: "Channel name, e.g. \"#oncall\"." },
      slack_channel_url: { type: "string", description: "Link to the channel." },
      slack_message_url: { type: "string", description: "Link to the message." },
      slack_thread_url: { type: "string", description: "Link to the thread." },
      author: { type: "string", description: "Who raised it." },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async handler(args, { api }) {
    const kind = asString(args, "kind");
    const status = asString(args, "status");
    return { item: await api.createItem({
      title: requiredString(args, "title"),
      body: asString(args, "body"),
      kind: kind && isKind(kind) ? kind : undefined,
      status: status && isStatus(status) ? status : undefined,
      pr_url: asString(args, "pr_url"),
      slack_channel: asString(args, "slack_channel"),
      slack_channel_url: asString(args, "slack_channel_url"),
      slack_message_url: asString(args, "slack_message_url"),
      slack_thread_url: asString(args, "slack_thread_url"),
      author: asString(args, "author"),
    }) };
  },
};

const oncall_update_status: ToolDefinition = {
  name: "oncall_update_status",
  title: "Update oncall item status",
  description:
    "Set the manual status override on an oncall item. The statuses are open, working, blocked, done, and " +
    "dismissed; pass \"auto\" or null to clear the override and fall back to the status the board suggests. " +
    "Returns the updated item.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer", minimum: 1, description: "Item id from oncall_list_items." },
      status: {
        type: ["string", "null"],
        enum: [...STATUS_CHOICES, null],
        description: "New status, or \"auto\"/null to drop the override.",
      },
    },
    required: ["id", "status"],
    additionalProperties: false,
  },
  async handler(args, { api }) {
    const choice = args.status;
    const status = typeof choice === "string" && isStatus(choice) ? choice : null;
    return { item: await api.setStatus(requiredInteger(args, "id"), status) };
  },
};

const oncall_list_prompts: ToolDefinition = {
  name: "oncall_list_prompts",
  title: "List oncall prompts",
  description:
    "List the saved oncall prompts: each one's id, title, the working directory it runs in, and its text. " +
    "Run one with oncall_run_prompt.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { api }) {
    const board = await api.board();
    return { count: board.prompts.length, prompts: board.prompts };
  },
};

const oncall_run_prompt: ToolDefinition = {
  name: "oncall_run_prompt",
  title: "Run oncall prompt",
  description:
    "Start a saved oncall prompt in its own working directory and return the run. The run may come back " +
    "\"running\" with empty output — poll oncall_get_prompt_run with the run id until it is completed or failed.",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, description: "Prompt id from oncall_list_prompts." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async handler(args, { api }) {
    return runSummary(await api.runPrompt(requiredString(args, "id")));
  },
};

const oncall_get_prompt_run: ToolDefinition = {
  name: "oncall_get_prompt_run",
  title: "Get oncall prompt run",
  description:
    "Fetch prompt runs with their captured output. Pass id for one run (its own request, so poll it until " +
    "status is completed or failed), or prompt_id for that prompt's recent runs, newest first.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer", minimum: 1, description: "Run id returned by oncall_run_prompt." },
      prompt_id: { type: "string", minLength: 1, description: "Prompt id, to see its recent runs." },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum runs for prompt_id (default 5).", default: 5 },
    },
    additionalProperties: false,
  },
  async handler(args, { api }) {
    const id = asInteger(args, "id");
    const promptId = asString(args, "prompt_id");
    if (id === undefined && promptId === undefined) throw new Error("pass either id (one run) or prompt_id (that prompt's recent runs)");
    if (id !== undefined) {
      try {
        return runSummary(await api.run(id));
      } catch (error) {
        if (error instanceof OncallApiError && error.status === 404) throw new Error(`no prompt run with id ${id}`);
        throw error;
      }
    }
    const limit = asInteger(args, "limit") ?? 5;
    const matching = (await api.runs())
      .filter(entry => entry.prompt_id === promptId)
      .sort((a, b) => (a.started_at === b.started_at ? b.id - a.id : a.started_at < b.started_at ? 1 : -1));
    if (matching.length === 0) throw new Error(`no prompt runs for prompt_id ${JSON.stringify(promptId)}`);
    return { prompt_id: promptId, count: Math.min(matching.length, limit), runs: matching.slice(0, limit) };
  },
};

export const TOOLS: ToolDefinition[] = [
  oncall_list_items,
  oncall_create_item,
  oncall_update_status,
  oncall_list_prompts,
  oncall_run_prompt,
  oncall_get_prompt_run,
];

export const findTool = (name: string): ToolDefinition | undefined => TOOLS.find(tool => tool.name === name);

/** A tool as the MCP client sees it: the definition without the handler. */
export interface ToolListing {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
}

/** The tools/list payload. */
export const toolListing = (): ToolListing[] =>
  TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    ...(annotations ? { annotations } : {}),
  }));
