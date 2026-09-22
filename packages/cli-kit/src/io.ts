import { CliError } from "./cli.ts";

/** Fixed-width text table from objects; columns default to the first row's keys. */
export function table(rows: Record<string, unknown>[], options: { columns?: string[]; max?: number; header?: boolean } = {}): string {
  if (!rows.length) return "(no results)";
  const columns = options.columns ?? Object.keys(rows[0]);
  const max = options.max ?? 60;
  const cell = (value: unknown) => { const text = value === null || value === undefined ? "" : String(value).replace(/\s+/g, " "); return text.length > max ? text.slice(0, max - 1) + "…" : text; };
  const widths = columns.map(column => Math.max(column.length, ...rows.map(row => cell(row[column]).length)));
  const line = (values: string[]) => values.map((value, i) => value.padEnd(widths[i])).join("  ").trimEnd();
  const lines = rows.map(row => line(columns.map(column => cell(row[column]))));
  if (options.header === false) return lines.join("\n");
  return [line(columns), line(widths.map(width => "-".repeat(width))), ...lines].join("\n");
}

export const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** Lets the user pick one line with sk or fzf. Returns null when nothing was chosen or no picker exists. */
export function pick(lines: string[], options: { prompt?: string; multi?: boolean } = {}): string[] | null {
  if (!lines.length) return null;
  if (lines.length === 1) return [lines[0]];
  const bin = process.env.PF_PICKER ?? Bun.which("sk") ?? Bun.which("fzf");
  if (!bin) throw new CliError("no fuzzy picker: install sk or fzf, or pass an exact match");
  const args = [bin, ...(options.multi ? ["--multi"] : []), ...(options.prompt ? ["--prompt", options.prompt] : [])];
  const result = Bun.spawnSync({ cmd: args, stdin: Buffer.from(lines.join("\n") + "\n"), stdout: "pipe", stderr: "inherit" });
  const chosen = result.stdout.toString().split("\n").map(line => line.trim()).filter(Boolean);
  return chosen.length ? chosen : null;
}

/** Picks exactly one, resolving either an exact label or the fuzzy choice. */
export function pickOne<T>(items: T[], labelOf: (item: T) => string, options: { prompt?: string } = {}): T | null {
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  const chosen = pick(items.map(labelOf), options);
  if (!chosen) return null;
  return items.find(item => labelOf(item) === chosen[0]) ?? null;
}

/** Opens a file, directory, or URL with the OS handler. */
export const openDefault = (target: string): number => Bun.spawnSync({ cmd: [process.platform === "darwin" ? "open" : "xdg-open", target], stdio: ["ignore", "inherit", "inherit"] }).exitCode ?? 1;

export const editor = (): string => process.env.EDITOR ?? Bun.which("nvim") ?? Bun.which("vim") ?? "vi";

/** Opens files in $EDITOR; vim-likes get vertical splits, at most `maxSplits`. */
export function editFiles(files: string[], maxSplits = 3): number {
  const bin = editor();
  const cmd = /vim/i.test(bin) ? [bin, files.length > maxSplits ? `-O${maxSplits}` : "-O", ...files] : [bin, ...files];
  return Bun.spawnSync({ cmd, stdio: ["inherit", "inherit", "inherit"] }).exitCode ?? 1;
}

export const copyToClipboard = (text: string): boolean => {
  const bin = process.env.PORTFOLIO_PBCOPY_BIN ?? Bun.which("pbcopy");
  if (!bin) return false;
  return (Bun.spawnSync({ cmd: [bin], stdin: Buffer.from(text) }).exitCode ?? 1) === 0;
};

export const readStdin = async (): Promise<string> => (await Bun.stdin.text()).replace(/\n$/, "");

/** y/N prompt; non-interactive runs answer no unless `assume` is set. */
export function confirm(question: string, assume?: boolean): boolean {
  if (assume !== undefined) return assume;
  if (!process.stdin.isTTY) return false;
  const answer = prompt(`${question} [y/N]`) ?? "";
  return /^y(es)?$/i.test(answer.trim());
}

export const numberArg = (value: string | undefined, what = "id"): number => {
  const n = Number(value);
  if (!value || !Number.isInteger(n) || n <= 0) throw new CliError(`${what} must be a positive integer, got ${JSON.stringify(value ?? "")}`);
  return n;
};
