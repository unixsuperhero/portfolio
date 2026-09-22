/** Shells out to the `gh` CLI. Both entry points take an injectable `run` so tests never spawn a process. */

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type Runner = (cmd: string[]) => Promise<RunResult>;

const GH_TIMEOUT_MS = 30_000;

async function defaultRun(cmd: string[]): Promise<RunResult> {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), GH_TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  } finally {
    clearTimeout(timer);
  }
}

export interface GhOptions {
  run?: Runner;
  bin?: string;
}

/** Runs `gh api graphql -f query=... -F var=...`, returning the parsed `data`. Throws on a non-zero exit or a GraphQL error. */
export async function ghGraphql(query: string, variables: Record<string, string | number> = {}, options: GhOptions = {}): Promise<unknown> {
  const bin = options.bin ?? process.env.GH_BIN ?? "gh";
  const run = options.run ?? defaultRun;
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) args.push("-F", `${name}=${value}`);
  const { stdout, stderr, code } = await run([bin, ...args]);
  if (code !== 0) throw new Error(stderr.trim() || `gh exited with code ${code}`);
  let parsed: { data?: unknown; errors?: { message: string }[] };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`gh returned invalid JSON: ${stdout.slice(0, 200)}`);
  }
  if (parsed.errors?.length) throw new Error(parsed.errors.map(e => e.message).join("; "));
  return parsed.data;
}

/** `gh api user`'s login, or the ok/error from `gh auth status` when that fails. */
export async function ghAuth(options: GhOptions = {}): Promise<{ ok: boolean; login: string | null }> {
  const bin = options.bin ?? process.env.GH_BIN ?? "gh";
  const run = options.run ?? defaultRun;
  const user = await run([bin, "api", "user"]);
  if (user.code === 0) {
    try {
      const parsed = JSON.parse(user.stdout) as { login?: string };
      return { ok: true, login: parsed.login ?? null };
    } catch {
      // fall through to gh auth status
    }
  }
  const status = await run([bin, "auth", "status"]);
  return { ok: status.code === 0, login: null };
}
