# @portfolio/cli-kit

hiiro, for Bun. The same shape as `Hiiro.run { add_subcmd(:x) { } }`: register commands, dispatch by exact name, unique prefix, or an ambiguity listing, discover external `name-sub` executables, print a help table with locations, parse options, pick with `sk`/`fzf`, open and edit things.

```ts
import { cli, flag, option, table, pickOne, openDefault, editFiles, CliError } from "@portfolio/cli-kit";

cli("tool", c => {
  c.cmd(["list", "ls"], { desc: "list things", args: ["QUERY..."], opts: { json: flag("j", "print JSON"), limit: option("l", "at most N", { type: "number" }) } }, ({ args, opts, out }) => {
    out(opts.json ? JSON.stringify(args) : table(args.map(a => ({ a }))));
  });
  c.child("git", "git things", git => { git.cmd("global", {}, ({ out }) => out("~/.gitconfig")); });
  c.default({ desc: "runs when nothing matches", args: ["TEXT..."] }, ({ args }) => { /* … */ });
}, { desc: "an example" }).run();
```

## Dispatch

`tool ls x` → exact. `tool li x` → unique prefix. `tool l` → ambiguous, prints "Did you mean one of these?" with the matches. `tool zzz` → unknown, prints the full listing (or runs the default command when one is registered). `tool` alone → listing, exit 1. `tool --help` → listing plus the default command's usage. `tool ls --help` → that command's usage and options.

External bins: any executable named `tool-<sub>` next to the running script or on `PATH` is listed as `(bin)` and run with the remaining arguments. That is how `pf` finds the `pf-*` tools, and how a tool grows by dropping a file in `bin/`.

Handlers return: nothing or `true` → exit 0, `false` → exit 1, a number → that code. Throw `CliError(message, code)` for a clean `ERROR: message`. Any other error prints its message; `PF_DEBUG=1` adds the stack.

## Options

`parseOptions(defs, argv)` handles `--name value`, `--name=value`, `-n value`, `-nvalue`, combined flags `-abc`, `--no-flag`, numbers (`type: "number"`), repeats (`multi: true`), positionals anywhere, and `--` to stop. Unknown options and missing values are errors. The parsed `opts` object is typed from the definitions: a flag is `boolean`, a `type: "number"` option is `number | null`, a `multi` option is `string[]`.

## Helpers

| Helper | Does |
|--------|------|
| `table(rows, { columns, max, header })` | fixed-width text table |
| `json(value)` | pretty JSON |
| `pick(lines, { multi, prompt })`, `pickOne(items, labelOf)` | fuzzy choose with `sk`, then `fzf`; `PF_PICKER` overrides (`PF_PICKER=head` for scripts) |
| `openDefault(target)` | `open` / `xdg-open` |
| `editor()`, `editFiles(files, maxSplits)` | `$EDITOR`; vim-likes get `-O` splits |
| `copyToClipboard(text)` | `pbcopy` |
| `readStdin()` | whole stdin, trailing newline removed |
| `confirm(question, assume?)` | y/N; non-TTY answers no |
| `numberArg(value, what)` | positive integer or a `CliError` |
| `matchByPrefix(items, input, nameOf)` | the matcher, exported for reuse |

## Testing a CLI

Construct `new Cli(name, { out, err, exit: false })` with capturing functions; `run(argv)` resolves to the exit code without exiting. Under `bun test` the process never exits even with the default options.

Tests: `packages/cli-kit/test/cli.test.ts`. Back to the [index](../index.md).
