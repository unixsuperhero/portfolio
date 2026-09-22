#!/usr/bin/env bun
// Writes docs/cli/<tool>.md for every pf-* tool from the tools' own help output,
// so the reference never drifts from the code. Run: bun scripts/gen-cli-docs.ts
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const bin = join(root, "bin");
const out = join(root, "docs", "cli");
mkdirSync(out, { recursive: true });

const run = (args: string[]) => { const r = Bun.spawnSync({ cmd: args, cwd: root, env: { ...process.env, PORTFOLIO_DB: "/nonexistent/none.sqlite", NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" }); return r.stdout.toString() + r.stderr.toString(); };

const EXAMPLES: Record<string, string[]> = {
  "pf": ["pf items ls yt              # same as pf-items ls yt", "pf it ls                    # prefix matching, like hiiro", "pf tools"],
  "pf-items": ["pf-items ls -l 20", "pf-items ls procedural -t document -f", "pf-items recent 5 -j", "pf-items show 42", "pf-items open 42", "pf-items tag 42 yt,slides", "pf-items pin 42 43", "pf-items rm 42 -y", "pf-items export -g yt > yt.jsonl"],
  "pf-tags": ["pf-tags ls", "pf-tags items yt -f", "pf-tags rename yt youtube", "pf-tags add review 41 42 43", "pf-tags prune"],
  "pf-portfolios": ["pf-portfolios new YouTube 'everything for the channel'", "pf-portfolios show YouTube", "pf-portfolios show 1 -j   # same payload as GET /api/portfolios/1", "pf-portfolios open YouTube"],
  "pf-cards": ["pf-cards add YouTube 'Scripts' -g yt,slides -t document -s title -d asc", "pf-cards ls YouTube", "pf-cards show 3", "pf-cards preview -g yt -t link,pr -m 5", "pf-cards edit 3 -m 10", "pf-cards move 3 left"],
  "pf-categories": ["pf-categories add project -k dir -s $'tasks | file | TASKS.md\\nlogs | dir | ~/Library/Logs/x'", "pf-categories assign 393 project", "pf-categories slots 393", "pf-categories override 393 tasks ~/other/TASKS.md", "pf-categories items project -f"],
  "pf-detect": ["pf-detect https://github.com/x/y/pull/12", "pf-detect -t ~/proj/thing", "echo '# Plan' | pf-detect"],
  "pf-add": ["pf-add https://github.com/x/y/pull/12 -g review", "pf-add https://remotion.dev/docs -g yt", "pf-add ~/proj/thing -g project -c project", "pf-add ~/notes/plan.md -g docs", "echo '# Idea' | pf-add - -g ideas -o"],
  "pf-docs": ["pf-docs add -r docs/index.md", "pf-docs push -r docs/index.md    # through the server, like mdoc", "pf-docs links docs/index.md", "pf-docs tracked --missing", "pf-docs rerender --all --disk"],
  "pf-render": ["pf-render README.md -o README.html --open", "pf-render README.md > out.html", "echo '**hi**' | pf-render - --fragment"],
  "pf-watch": ["pf-watch add ~/notes/docs -r", "pf-watch scan ~/notes/docs -r", "pf-watch sync", "pf-watch set 1 flat", "pf-watch run"],
  "pf-projects": ["pf-projects parents add ~/proj", "pf-projects scan", "pf-projects ls -f", "pf-projects discover ~/work -d 2"],
  "pf-ports": ["pf-ports ls", "pf-ports ls -p 4387", "pf-ports tree 4387", "pf-ports kill 3000", "pf-ports kill --pid 1234 -9"],
  "pf-db": ["pf-db status", "pf-db q \"select type, count(*) n from items group by type\"", "pf-db backup ~/backups/portfolio.sqlite", "pf-db schema --live", "pf-db reindex"],
  "pf-server": ["pf-server health", "pf-server restart", "pf-server logs -f", "pf-server items yt -l 5", "pf-server api /api/portfolios/1", "pf-server dev 4388"],
};

const tools = readdirSync(bin).filter(name => /^pf(-[a-z-]+)?$/.test(name)).sort((a, b) => a === "pf" ? -1 : b === "pf" ? 1 : a.localeCompare(b));
const index: string[] = [];

for (const tool of tools) {
  const listing = run([join(bin, tool), "--help"]);
  const desc = listing.match(/^Current command: \S+ — (.*)$/m)?.[1] ?? "";
  const rows = [...listing.matchAll(/^  (\S+)\s{2,}(.*?)\s*\((subcommand|bin)\)\s{2,}(.*?)(?:\s{2,}(\S+))?$/gm)].map(m => ({ name: m[1], params: m[2].trim(), kind: m[3], desc: m[4].trim(), location: m[5] ?? "" }));
  const subcommands = rows.filter(row => row.kind === "subcommand" && !row.desc.startsWith("alias of"));
  const aliases = rows.filter(row => row.desc.startsWith("alias of"));
  const bins = rows.filter(row => row.kind === "bin");
  const defaultHelp = listing.includes("\nUsage: ") ? listing.slice(listing.indexOf("\nUsage: ") + 1) : "";
  const lines: string[] = [`# ${tool}`, "", desc ? `${desc[0].toUpperCase()}${desc.slice(1)}.` : "", "", "## Synopsis", "", "```bash", subcommands.length ? `${tool} <subcommand> [args] [options]` : `${tool} [args] [options]`, "```", ""];
  if (bins.length) { lines.push("## Tools", "", "| Tool | Runs |", "|------|------|", ...bins.map(row => `| \`${tool} ${row.name}\` | [${tool}-${row.name}](${tool}-${row.name}.md) |`), ""); }
  if (subcommands.length) {
    lines.push("## Subcommands", "", "| Subcommand | Arguments | Description |", "|------------|-----------|-------------|");
    for (const row of subcommands) {
      const names = [row.name, ...aliases.filter(alias => alias.desc === `alias of ${row.name}`).map(alias => alias.name)].map(name => `\`${name}\``).join(", ");
      const params = row.params.replace(/\s*\[--[^\]]+\]/g, "").trim().replace(/\s{2,}/g, " ").replace(/\|/g, "\\|");
      lines.push(`| ${names} | ${params ? `\`${params}\`` : ""} | ${row.desc} |`);
    }
    lines.push("");
    for (const row of subcommands) {
      const help = run([join(bin, tool), row.name, "--help"]);
      const usage = help.match(/^Usage: (.*)$/m)?.[1] ?? "";
      const options = help.split("Options:\n")[1]?.trimEnd() ?? "";
      lines.push(`### ${row.name}`, "", row.desc ? `${row.desc[0].toUpperCase()}${row.desc.slice(1)}.` : "", "", "```bash", usage.replace(/\|/g, "|"), "```", "");
      if (options && options.split("\n").length > 1) lines.push("Options:", "", "```text", options, "```", "");
    }
  }
  if (defaultHelp) {
    const usage = defaultHelp.match(/^Usage: (.*)$/m)?.[1] ?? "";
    const options = defaultHelp.split("Options:\n")[1]?.trimEnd() ?? "";
    lines.push(subcommands.length ? "## Default (no subcommand)" : "## Usage", "", "```bash", usage, "```", "");
    if (options) lines.push("Options:", "", "```text", options, "```", "");
  }
  if (EXAMPLES[tool]) lines.push("## Examples", "", "```bash", ...EXAMPLES[tool], "```", "");
  lines.push("## Environment", "", "| Variable | Meaning |", "|----------|---------|", "| `PORTFOLIO_DB` | SQLite file to use (default `<project>/portfolio.sqlite`) |", "| `PORTFOLIO_HOME` | project root (default: the parent of `bin/`) |", "| `PORTFOLIO_SERVER` | server URL for commands that open pages or call the API (default `HDOCS_SERVER` or `http://127.0.0.1:4387`) |", "| `PF_PICKER` | fuzzy picker binary (default `sk`, then `fzf`) |", "| `PF_DEBUG` | print stack traces on errors |", "");
  lines.push("See also: [the pf toolbox](pf.md) · [cli-kit, the framework these are built on](../packages/cli-kit.md) · [back to the index](../index.md)", "");
  writeFileSync(join(out, `${tool}.md`), lines.filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n"));
  index.push(`- [${tool}](cli/${tool}.md) — ${desc}`);
}
console.log(index.join("\n"));
