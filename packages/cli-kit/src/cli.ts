import { basename, dirname, join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { parseOptions, optionsHelp, optionsHint, OptionError, type OptDefs, type ParsedArgs } from "./options.ts";
import { matchByPrefix } from "./matcher.ts";

export class CliError extends Error { constructor(message: string, public code = 1) { super(message); } }
export const fail = (message: string, code = 1): never => { throw new CliError(message, code); };

export interface CommandContext<T extends OptDefs = OptDefs> extends ParsedArgs<T> {
  cli: Cli;
  /** The name the command was invoked by. */
  name: string;
  out: (line?: string) => void;
  err: (line?: string) => void;
}

export type Handler<T extends OptDefs = OptDefs> = (context: CommandContext<T>) => unknown | Promise<unknown>;

export interface CommandSpec<T extends OptDefs = OptDefs> {
  desc?: string;
  /** Positional names for the listing, e.g. ["NAME", "PATH..."]. */
  args?: string[];
  opts?: T;
  /** Hand the raw argv through without option parsing. */
  passthrough?: boolean;
}

interface Command { names: string[]; spec: CommandSpec; handler: Handler; location: string; kind: "subcommand" }
interface ExternalBin { names: string[]; path: string; kind: "bin" }
type Runner = Command | ExternalBin;

export interface CliOptions {
  desc?: string;
  /** Look for `name-*` executables next to the script and on PATH. Default true. */
  externalBins?: boolean;
  out?: (line?: string) => void;
  err?: (line?: string) => void;
  /** Where external bins are searched first, usually import.meta.dir of the script. */
  binDir?: string;
  /** process.exit after run. Default true outside tests. */
  exit?: boolean;
}

/**
 * hiiro's Hiiro.run for Bun. Register commands, then `run(argv)`:
 *   exact subcommand > unique prefix > ambiguous listing > default command > help
 * External executables named `<name>-<sub>` next to the script or on PATH are
 * subcommands too, so a tool grows by dropping a file in bin/.
 */
export class Cli {
  private commands: Command[] = [];
  private fallback: Command | null = null;
  readonly out: (line?: string) => void;
  readonly err: (line?: string) => void;

  constructor(readonly name: string, readonly options: CliOptions = {}) {
    this.out = options.out ?? (line => console.log(line ?? ""));
    this.err = options.err ?? (line => console.error(line ?? ""));
  }

  /** Registers a subcommand under one or more names. */
  cmd<T extends OptDefs>(names: string | string[], spec: CommandSpec<T>, handler: Handler<T>): this {
    const frame = new Error().stack?.split("\n")[2]?.trim() ?? "";
    const location = frame.match(/\(?([^() ]+:\d+):\d+\)?$/)?.[1] ?? frame.replace(/^at\s+/, "");
    this.commands.push({ names: [names].flat(), spec: spec as CommandSpec, handler: handler as Handler, location, kind: "subcommand" });
    return this;
  }

  /** Runs when no subcommand matches; receives the whole argv as args. */
  default<T extends OptDefs>(spec: CommandSpec<T>, handler: Handler<T>): this {
    this.fallback = { names: ["DEFAULT"], spec: spec as CommandSpec, handler: handler as Handler, location: "", kind: "subcommand" };
    return this;
  }

  /** A nested CLI, like hiiro's make_child: `tool git global`. */
  child(names: string | string[], desc: string, setup: (cli: Cli) => void): this {
    const child = new Cli(`${this.name}-${[names].flat()[0]}`, { ...this.options, desc, exit: false });
    setup(child);
    return this.cmd(names, { desc, passthrough: true, args: ["SUBCOMMAND"] }, async ({ args }) => child.run(args));
  }

  externalBins(): ExternalBin[] {
    if (this.options.externalBins === false) return [];
    const prefix = `${this.name}-`;
    const dirs = [this.options.binDir, ...(process.env.PATH ?? "").split(":")].filter((dir): dir is string => typeof dir === "string" && dir.length > 0 && existsSync(dir));
    const seen = new Map<string, ExternalBin>();
    for (const dir of dirs) {
      for (const entry of readdirSync(dir)) {
        if (!entry.startsWith(prefix) || seen.has(entry)) continue;
        const path = join(dir, entry);
        try { if (!statSync(path).isFile()) continue; } catch { continue; }
        seen.set(entry, { names: [entry.slice(prefix.length)], path, kind: "bin" });
      }
    }
    return [...seen.values()];
  }

  runners(): Runner[] { return [...this.commands, ...this.externalBins()]; }
  commandNames(): string[] { return this.runners().flatMap(runner => runner.names).sort(); }

  resolve(word: string | undefined): { runner: Runner | null; ambiguous: Runner[] } {
    if (!word) return { runner: null, ambiguous: [] };
    const runners = this.runners();
    const { exact, matches } = matchByPrefix(runners.flatMap(runner => runner.names.map(name => ({ name, runner }))), word, entry => entry.name);
    if (exact) return { runner: exact.runner, ambiguous: [] };
    const distinct = [...new Set(matches.map(entry => entry.runner))];
    if (distinct.length === 1) return { runner: distinct[0], ambiguous: [] };
    return { runner: null, ambiguous: distinct };
  }

  help(word?: string, ambiguous: Runner[] = []): void {
    const out = this.out;
    out(`Current command: ${this.name}${this.options.desc ? ` — ${this.options.desc}` : ""}`);
    if (ambiguous.length) {
      out(`Ambiguous subcommand ${JSON.stringify(word)}!`);
      out();
      out("Did you mean one of these?");
      this.listRunners(ambiguous);
    } else {
      if (word && word !== "--help" && word !== "-h") out(`Unknown subcommand ${JSON.stringify(word)}.`);
      else if (!this.fallback) out(`Subcommand required for ${this.name}`);
      out();
      out("Possible subcommands:");
      this.listRunners(this.runners());
    }
    out();
  }

  listRunners(list: Runner[]): void {
    const rows = list.flatMap(runner => runner.names.map((name, index) => {
      const params = runner.kind === "bin" ? "" : [...(runner.spec.args ?? []).map(arg => `<${arg}>`), runner.spec.opts ? optionsHint(runner.spec.opts) : ""].filter(Boolean).join("  ");
      const desc = runner.kind === "bin" ? "" : index === 0 ? runner.spec.desc ?? "" : `alias of ${runner.names[0]}`;
      const location = runner.kind === "bin" ? runner.path : runner.location;
      return { name, params, kind: `(${runner.kind})`, desc, location };
    })).sort((a, b) => a.name.localeCompare(b.name));
    const width = (key: keyof typeof rows[number]) => Math.max(0, ...rows.map(row => row[key].length));
    for (const row of rows) this.out(`  ${row.name.padEnd(width("name"))}  ${row.params.padEnd(width("params"))}  ${row.kind.padEnd(width("kind"))}  ${row.desc.padEnd(width("desc"))}  ${row.location}`.trimEnd());
  }

  commandHelp(command: Command, name: string): void {
    const usage = [this.name, ...(name === this.name ? [] : [name]), ...(command.spec.args ?? []).map(arg => `<${arg}>`)].join(" ");
    this.out(`Usage: ${usage}${command.spec.opts && Object.keys(command.spec.opts).length ? " [options]" : ""}`);
    if (command.spec.desc) { this.out(); this.out(command.spec.desc); }
    if (command.spec.opts) { this.out(); this.out("Options:"); this.out(optionsHelp(command.spec.opts)); }
  }

  /** Dispatches argv. Resolves to the exit code; exits the process unless options.exit is false. */
  async run(argv: string[] = process.argv.slice(2)): Promise<number> {
    const code = await this.dispatch(argv);
    if (this.options.exit ?? !process.env.BUN_TEST) process.exit(code);
    return code;
  }

  private async dispatch(argv: string[]): Promise<number> {
    const [word, ...rest] = argv;
    if ((word === "--help" || word === "-h") && !rest.length) {
      this.help();
      if (this.fallback) this.commandHelp(this.fallback, this.name);
      return 0;
    }
    const { runner, ambiguous } = this.resolve(word);
    try {
      if (runner?.kind === "bin") {
        const result = Bun.spawnSync({ cmd: [runner.path, ...rest], stdio: ["inherit", "inherit", "inherit"] });
        return result.exitCode ?? 1;
      }
      if (runner) return await this.invoke(runner, word!, rest);
      if (!word && this.fallback) return await this.invoke(this.fallback, this.name, argv);
      if (word && !ambiguous.length && this.fallback) return await this.invoke(this.fallback, this.name, argv);
      this.help(word, ambiguous);
      return 1;
    } catch (error) {
      if (error instanceof OptionError || error instanceof CliError) { this.err(`ERROR: ${error.message}`); return error instanceof CliError ? error.code : 1; }
      this.err(`ERROR: ${(error as Error).message}`);
      if (process.env.PF_DEBUG) this.err((error as Error).stack);
      return 1;
    }
  }

  private async invoke(command: Command, name: string, argv: string[]): Promise<number> {
    let parsed: ParsedArgs;
    if (command.spec.passthrough) parsed = { args: argv, opts: { help: false } as ParsedArgs["opts"], rest: [] };
    else {
      parsed = parseOptions(command.spec.opts ?? {}, argv);
      if (parsed.opts.help) { this.commandHelp(command, name); return 0; }
    }
    const result = await command.handler({ ...parsed, cli: this, name, out: this.out, err: this.err });
    if (typeof result === "number") return result;
    return result === false ? 1 : 0;
  }
}

/** `cli("pf-items", c => { c.cmd(...) }).run()` */
export function cli(name: string, setup: (cli: Cli) => void, options: CliOptions = {}): Cli {
  const instance = new Cli(name, { binDir: process.argv[1] ? dirname(process.argv[1]) : undefined, ...options });
  setup(instance);
  return instance;
}

export const scriptName = (): string => basename(process.argv[1] ?? "cli");
