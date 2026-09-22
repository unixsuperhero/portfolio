export interface FlagDef { kind: "flag"; short?: string; desc?: string; default?: boolean }
export interface OptionDef { kind: "option"; short?: string; desc?: string; default?: string | number | null; multi?: boolean; type?: "string" | "number" }
export type OptDef = FlagDef | OptionDef;
export type OptDefs = Record<string, OptDef>;

export const flag = (short?: string, desc?: string, extra: Partial<FlagDef> = {}): FlagDef => ({ kind: "flag", short, desc, default: false, ...extra });
/** `option("l", "limit", { type: "number" })`; the literal `type` and `multi` shape the parsed value's type. */
export const option = <const E extends Partial<OptionDef> = {}>(short?: string, desc?: string, extra?: E): OptionDef & E => ({ kind: "option", short, desc, default: null, ...(extra ?? {} as E) });

export interface ParsedArgs<T extends OptDefs = OptDefs> {
  /** Positional arguments in order, after the options were taken out. */
  args: string[];
  opts: { [K in keyof T]: T[K] extends FlagDef ? boolean : T[K] extends { multi: true } ? string[] : T[K] extends { type: "number" } ? number | null : string | null } & { help: boolean };
  /** Everything after a bare `--`. */
  rest: string[];
}

export class OptionError extends Error {}

const longName = (name: string) => name.replace(/_/g, "-");

/**
 * Parses `--name value`, `--name=value`, `-n value`, `-abc` (combined flags),
 * `--no-flag`, and stops at `--`. Unknown options are an error. Positionals
 * may appear anywhere.
 */
export function parseOptions<T extends OptDefs>(defs: T, argv: string[]): ParsedArgs<T> {
  const all: OptDefs = { help: { kind: "flag", short: "h", desc: "Show help" }, ...defs };
  const byLong = new Map<string, string>();
  const byShort = new Map<string, string>();
  for (const [name, def] of Object.entries(all)) {
    byLong.set(longName(name), name);
    if (def.short) byShort.set(def.short, name);
  }
  const opts: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(all)) opts[name] = def.kind === "flag" ? Boolean(def.default) : def.multi ? [] : def.default ?? null;
  const args: string[] = [];
  const rest: string[] = [];
  const assign = (name: string, raw: string | undefined, next: () => string | undefined) => {
    const def = all[name];
    if (def.kind === "flag") { if (raw !== undefined) throw new OptionError(`--${longName(name)} does not take a value`); opts[name] = true; return; }
    const value = raw ?? next();
    if (value === undefined) throw new OptionError(`--${longName(name)} needs a value`);
    const typed = def.type === "number" ? Number(value) : value;
    if (def.type === "number" && Number.isNaN(typed)) throw new OptionError(`--${longName(name)} needs a number`);
    if (def.multi) (opts[name] as unknown[]).push(typed); else opts[name] = typed;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--") { rest.push(...argv.slice(i + 1)); break; }
    if (arg.startsWith("--")) {
      const [key, raw] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      let name = byLong.get(key);
      if (!name && key.startsWith("no-") && all[byLong.get(key.slice(3)) ?? ""]?.kind === "flag") { opts[byLong.get(key.slice(3))!] = false; continue; }
      if (!name) throw new OptionError(`unknown option --${key}`);
      assign(name, raw, next);
      continue;
    }
    if (arg.length > 1 && arg.startsWith("-") && !/^-\d/.test(arg)) {
      const letters = arg.slice(1);
      for (let j = 0; j < letters.length; j++) {
        const name = byShort.get(letters[j]);
        if (!name) throw new OptionError(`unknown option -${letters[j]}`);
        if (all[name].kind === "flag") { opts[name] = true; continue; }
        const inline = letters.slice(j + 1);
        assign(name, inline || undefined, next);
        break;
      }
      continue;
    }
    args.push(arg);
  }
  return { args, opts: opts as ParsedArgs<T>["opts"], rest };
}

/** One line per option, hiiro style: `-s, --long <val>  description`. */
export function optionsHelp(defs: OptDefs): string {
  const entries: [string, OptDef][] = [...Object.entries(defs), ["help", { kind: "flag", short: "h", desc: "Show this help" }]];
  const rows = entries.map(([name, def]) => {
    const short = def.short ? `-${def.short}, ` : "    ";
    const long = `--${longName(name)}${def.kind === "option" ? " <val>" : ""}`;
    return [short + long, def.desc ?? ""] as const;
  });
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, desc]) => `  ${left.padEnd(width)}  ${desc}`.trimEnd()).join("\n");
}

/** `[--flag] [--opt <val>]` for a listing. */
export const optionsHint = (defs: OptDefs): string => Object.entries(defs).map(([name, def]) => `[--${longName(name)}${def.kind === "option" ? " <val>" : ""}]`).join(" ");
