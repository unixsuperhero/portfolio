# h-pf

The hiiro entry point for the Portfolio toolbox. It forwards every argument to `bin/pf`, so the tools show up in the `h` ecosystem without a second implementation.

## Synopsis

```bash
h-pf <tool> <subcommand> [args]
h pf <tool> <subcommand> [args]     # once bin/ is on PATH, hiiro finds h-pf itself
```

## Source

```ruby
#!/usr/bin/env ruby
require 'hiiro'

PF = File.join(__dir__, 'pf')

Hiiro.run(*ARGV, external_commands: false) do
  add_default { |*args| exec(PF, *args.map(&:to_s)) }
end
```

`external_commands: false` stops hiiro from scanning `PATH` for `h-pf-*` bins; `pf` does its own scanning for `pf-*`. The built-in `edit` subcommand still works (`h-pf edit` opens this file).

## Examples

```bash
h-pf items ls yt
h-pf it count
h-pf cards preview -g yt -t link
```

See [pf](pf.md) for the dispatcher and the [index](../index.md) for every tool.
