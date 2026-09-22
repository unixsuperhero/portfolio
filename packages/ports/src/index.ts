import { join } from "node:path";

export interface HerdrPane { workspace_id?: string; workspace_label?: string; tab_id?: string; pane_id?: string; agent?: string; agent_status?: string; agent_session?: string; cwd?: string; shell_pid?: number; match?: "process" | "cwd" | string }
export interface AiSession { kind?: string; session?: string; hint?: string; source?: string }
export interface TreeNode { pid: number; ppid?: number; command: string; cwd: string; ports?: { host: string; port: number }[]; elapsed_secs?: number | null; elapsed?: string | null; started_at?: string | null }
export interface PortEntry {
  port: number | null; host: string; proto?: string; command: string; pid: number; user?: string; cwd: string; ppid?: number; command_line?: string;
  elapsed_secs?: number | null; elapsed?: string | null; started_at?: string | null;
  herdr?: HerdrPane | null; ai?: AiSession | null; tree?: TreeNode[]; children?: TreeNode[];
}
export interface PortsSnapshot { scanned_at: string; herdr_available: boolean; ports: PortEntry[]; warnings: string[]; error?: string }

/** PORTS_SCAN_BIN, else bin/ports-scan next to the project root. */
export const portsScanBin = (root = process.env.PORTFOLIO_HOME ?? join(process.env.HOME ?? "", "proj", "portfolio")): string => process.env.PORTS_SCAN_BIN ?? join(root, "bin", "ports-scan");

const empty = (error: string): PortsSnapshot => ({ scanned_at: new Date().toISOString(), herdr_available: false, ports: [], warnings: [], error });

/** Runs the scanner. Never throws: a failure comes back as a snapshot with `error`. */
export function scanPorts(bin = portsScanBin()): PortsSnapshot {
  try {
    const result = Bun.spawnSync({ cmd: [bin], stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return empty(result.stderr.toString().trim().split("\n")[0] || `scanner exited with ${result.exitCode}`);
    const payload = JSON.parse(result.stdout.toString()) as PortsSnapshot;
    if (!Array.isArray(payload.ports)) throw new Error("scanner returned no ports array");
    return payload;
  } catch (error) {
    return empty((error as Error).message);
  }
}

const LOCAL_HOSTS = ["*", "::", "0.0.0.0", "::1", "127.0.0.1", "localhost"];

/** http://localhost:PORT for wildcard and loopback binds, otherwise the bound host. */
export function portSiteUrl(entry: Pick<PortEntry, "host" | "port">): string {
  const host = !entry.host || LOCAL_HOSTS.includes(entry.host) ? "localhost" : entry.host;
  const target = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${target}:${entry.port}`;
}

export function findPortEntry(snapshot: PortsSnapshot, pid: number, port: number | null = null): PortEntry | null {
  const matches = (snapshot.ports ?? []).filter(entry => entry.pid === pid);
  if (!matches.length) return null;
  if (port != null && Number.isInteger(port)) return matches.find(entry => entry.port === port) ?? matches[0];
  return matches[0];
}

export const findByPort = (snapshot: PortsSnapshot, port: number): PortEntry[] => snapshot.ports.filter(entry => entry.port === port);

export interface KillResult { ok: boolean; status: number; message: string; pid?: number; signal?: "SIGTERM" | "SIGKILL" }

/** Signals a pid only when it is a current listener and not this process. Returns an HTTP-style status. */
export function killListener(pid: number, options: { signal?: "TERM" | "KILL" | string; snapshot?: PortsSnapshot; self?: number } = {}): KillResult {
  if (!Number.isInteger(pid) || pid <= 1) return { ok: false, status: 422, message: "invalid pid" };
  if (pid === (options.self ?? process.pid)) return { ok: false, status: 403, message: "refusing to kill this process" };
  const signal = String(options.signal ?? "TERM").toUpperCase() === "KILL" ? "SIGKILL" : "SIGTERM";
  const snapshot = options.snapshot ?? scanPorts();
  if (snapshot.error && !snapshot.ports.length) return { ok: false, status: 502, message: `cannot verify listeners: ${snapshot.error}` };
  if (!findPortEntry(snapshot, pid)) return { ok: false, status: 404, message: "pid is not a current TCP listener" };
  try {
    process.kill(pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return { ok: false, status: 404, message: "no such process" };
    if (code === "EPERM") return { ok: false, status: 403, message: "no permission to signal that process" };
    return { ok: false, status: 500, message: `failed to signal process: ${(error as Error).message}` };
  }
  return { ok: true, status: 200, message: "signalled", pid, signal };
}

export interface ProjectRef { id: number; path: string }

/** Each snapshot entry annotated with the project whose path is the longest prefix of its cwd, or null. */
export function matchPortsToProjects<T extends { cwd: string }>(snapshot: PortsSnapshot, projects: ProjectRef[]): (T & { project: ProjectRef | null })[] {
  const sorted = [...projects].sort((a, b) => b.path.length - a.path.length);
  return (snapshot.ports as unknown as T[]).map(entry => {
    const project = sorted.find(candidate => entry.cwd === candidate.path || entry.cwd.startsWith(candidate.path + "/")) ?? null;
    return { ...entry, project };
  });
}

/** Text table rows for a terminal listing. */
export const portRows = (snapshot: PortsSnapshot) => snapshot.ports.map(entry => ({
  port: entry.port ?? "", host: entry.host || "", process: `${entry.command} #${entry.pid}`, uptime: entry.elapsed ?? "", cwd: entry.cwd || "",
  herdr: entry.herdr ? `${entry.herdr.workspace_label || entry.herdr.workspace_id || ""} ${entry.herdr.pane_id || ""}${entry.herdr.match === "cwd" ? " ~" : ""}`.trim() : "",
  ai: entry.ai?.session ? `${entry.ai.kind ?? ""} ${String(entry.ai.session).slice(0, 8)}` : entry.ai?.kind ?? "",
}));
