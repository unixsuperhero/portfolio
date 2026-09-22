# Changes from the t3code source

Vendored from `~/proj/t3code/apps/web/src/terminal/ghostty/` at libghostty-vt revision
`9f62873bf195e4d8a762d768a1405a5f2f7b1697` (see `VERSION`). `renderer.ts` and
`runtime.ts`, and `keyCodes.ts` are byte-identical to the source. `.test.ts` files were
not copied.

`core.ts` diverges from the t3code source with one addition: a
`setMacosOptionAsAlt(value: 0 | 1 | 2 | 3)` method that stores the macOS
"Option as Alt" enum on the instance (default 0/false) and, in `encodeKey`
right after `ghostty_key_encoder_setopt_from_terminal` (which resets option
id 6 to false on every call), writes the stored value into `this.scratch` and
calls `ghostty_key_encoder_setopt(this.keyEncoder, 6, this.scratch)` when
non-zero. This lets the macOS Option key send Alt/Meta sequences instead of
composed characters, configurable from Settings.

Edits in `surface.ts`:

1. **Import paths for the four t3code app imports.** Replaced with local shims under
   `../shims/` (each shim's header comment names its own t3code source file and notes what
   was trimmed):
   - `import { isMacPlatform } from "../../lib/utils"` → `"../shims/platform"`
   - `import { SELECTION_MULTI_CLICK_INTERVAL_MS } from "../../lib/selectionActions"` →
     `"../shims/selection"`
   - `import { collectWrappedTerminalLinkLine, extractTerminalLinks } from "../../terminal-links"`
     → `"../shims/terminalLinks"`
   - `import { isMonospaceFamily } from "../../appearanceFonts"` → `"../shims/monospace"`

2. **Tailwind class strings replaced with plain class names**, styled in
   `../terminal.css` using this app's CSS tokens instead of Tailwind's `@apply`/arbitrary
   values:
   - `canvas.className = "block size-full cursor-text"` → `"ghostty-canvas"`
   - `input.className = "t3-ghostty-input"` → `"ghostty-input"`
   - `scrollbar.className = "group absolute top-1 right-px bottom-1 z-1 w-[var(--app-scrollbar-width)] cursor-default touch-none"`
     → `"ghostty-scrollbar"`
   - `scrollbarThumb.className = "absolute inset-x-px top-0 rounded-[3px] bg-[var(--app-scrollbar-thumb)] …"`
     → `"ghostty-scrollbar-thumb"`

3. **`GhosttyTerminalSurfaceOptions.macosOptionAsAlt?: "false" | "true" | "left" | "right"`**,
   applied to the core after creation via `core.setMacosOptionAsAlt(...)`, plus a
   `setMacosOptionAsAlt(value)` method on `GhosttyTerminalSurface` so the app can change it
   live on a mounted surface. Not part of the t3code source.

Otherwise `surface.ts` is unchanged from the t3code source.
