export * from "./client.ts";
export * from "./tools.ts";
export * from "./server.ts";
export * from "./validate.ts";

import { defaultApiUrl } from "./client.ts";
import { SERVER_VERSION, serve } from "./server.ts";

const HELP = `pf-oncall-mcp — stdio Model Context Protocol server for the Portfolio oncall board.

Usage:
  bun <repo>/bin/pf-oncall-mcp

Tools:
  oncall_list_items     the Slack threads and pull requests polling picked up
  oncall_create_item    add an item by hand
  oncall_update_status  set or clear an item's manual status override
  oncall_list_prompts   the saved prompts, with their working directories
  oncall_run_prompt     run a prompt in its directory
  oncall_get_prompt_run a run's captured output

The server talks to the running Portfolio API (default ${defaultApiUrl()}) over JSON-RPC 2.0 on
stdin/stdout; diagnostics go to stderr. Set PORTFOLIO_API_URL to point somewhere else.
`;

/** The `bin/pf-oncall-mcp` entry point: help/version, else the stdio server loop. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return 0;
  }
  const unknown = argv.find(arg => arg.startsWith("-"));
  if (unknown) {
    process.stderr.write(`pf-oncall-mcp: unknown option ${unknown}\n\n${HELP}`);
    return 2;
  }
  try {
    await serve();
    return 0;
  } catch (error) {
    process.stderr.write(`pf-oncall-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
