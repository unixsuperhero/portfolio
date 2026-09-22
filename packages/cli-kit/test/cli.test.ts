import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Cli, flag, matchByPrefix, option, optionsHelp, parseOptions, table, CliError } from "../src/index.ts";

describe("parseOptions", () => {
  const defs = { verbose: flag("v", "talk"), limit: option("l", "count", { type: "number" }), tag: option("t", "tags", { multi: true }), title: option(undefined, "t") };
  test("long, short, combined, equals, multi, --, no-", () => {
    const parsed = parseOptions(defs, ["a", "-v", "--limit=5", "-t", "x", "--tag", "y", "b", "--title", "T", "--", "-z"]);
    expect(parsed.args).toEqual(["a", "b"]);
    expect(parsed.opts).toEqual({ help: false, verbose: true, limit: 5, tag: ["x", "y"], title: "T" });
    expect(parsed.rest).toEqual(["-z"]);
    expect(parseOptions(defs, ["-vl3"]).opts).toMatchObject({ verbose: true, limit: 3 });
    expect(parseOptions(defs, ["-v", "--no-verbose"]).opts.verbose).toBe(false);
    expect(parseOptions(defs, ["-5"]).args).toEqual(["-5"]);
    expect(() => parseOptions(defs, ["--nope"])).toThrow(/unknown option --nope/);
    expect(() => parseOptions(defs, ["--limit"])).toThrow(/needs a value/);
    expect(() => parseOptions(defs, ["--limit", "x"])).toThrow(/number/);
    expect(optionsHelp(defs)).toContain("-l, --limit <val>  count");
  });
});

test("matchByPrefix", () => {
  const names = ["list", "ls", "load", "open"];
  expect(matchByPrefix(names, "ls", n => n).exact).toBe("ls");
  expect(matchByPrefix(names, "l", n => n).matches).toEqual(["list", "ls", "load"]);
  expect(matchByPrefix(names, "op", n => n).matches).toEqual(["open"]);
});

describe("Cli dispatch", () => {
  const make = (binDir?: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const cli = new Cli("tool", { out: line => out.push(line ?? ""), err: line => err.push(line ?? ""), exit: false, binDir, externalBins: Boolean(binDir) });
    cli.cmd(["list", "ls"], { desc: "list things", args: ["QUERY..."], opts: { json: flag("j", "json out") } }, ({ args, opts, out }) => { out(`list ${args.join(",")} json=${opts.json}`); });
    cli.cmd("load", { desc: "load" }, () => false);
    cli.cmd("boom", {}, () => { throw new CliError("bad", 3); });
    cli.child("git", "git things", git => { git.cmd("global", {}, ({ out }) => { out("global!"); }); });
    return { cli, out, err };
  };
  test("exact, alias, prefix, ambiguous, unknown, help, exit codes", async () => {
    const { cli, out, err } = make();
    expect(await cli.run(["list", "a", "b", "-j"])).toBe(0);
    expect(out.at(-1)).toBe("list a,b json=true");
    expect(await cli.run(["ls", "x"])).toBe(0);
    expect(out.at(-1)).toBe("list x json=false");
    expect(await cli.run(["lo"])).toBe(1);
    expect(await cli.run(["l"])).toBe(1);
    expect(out.join("\n")).toContain('Ambiguous subcommand "l"');
    expect(await cli.run(["zzz"])).toBe(1);
    expect(out.join("\n")).toContain('Unknown subcommand "zzz"');
    expect(await cli.run([])).toBe(1);
    expect(out.join("\n")).toContain("Possible subcommands:");
    expect(out.join("\n")).toMatch(/list\s+<QUERY\.\.\.>  \[--json\]\s+\(subcommand\)\s+list things/);
    expect(await cli.run(["boom"])).toBe(3);
    expect(err.at(-1)).toBe("ERROR: bad");
    expect(await cli.run(["list", "--help"])).toBe(0);
    expect(out.at(-1)).toContain("-j, --json");
    expect(await cli.run(["git", "glo"])).toBe(0);
    expect(out.at(-1)).toBe("global!");
  });
  test("default command and external bins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clikit-"));
    writeFileSync(join(dir, "tool-ext"), "#!/bin/sh\nexit 7\n");
    chmodSync(join(dir, "tool-ext"), 0o755);
    const { cli, out } = make(dir);
    expect(cli.commandNames()).toContain("ext");
    expect(await cli.run(["ex"])).toBe(7);
    cli.default({}, ({ args, out }) => { out(`default ${args.join(" ")}`); });
    expect(await cli.run(["whatever", "x"])).toBe(0);
    expect(out.at(-1)).toBe("default whatever x");
  });
});

test("table", () => {
  expect(table([{ id: 1, title: "a very long title that goes on" }], { max: 12 })).toBe("id  title\n--  ------------\n1   a very long…");
  expect(table([])).toBe("(no results)");
});
