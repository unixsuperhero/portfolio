// Loads the real libghostty-vt wasm from disk (bypassing Vite, which owns the `?url`
// imports runtime.ts uses) and asserts that feeding "hello\r\n" into a
// GhosttyTerminalCore produces a snapshot whose first row starts with "hello".
//
// bun test has no Vite plugin pipeline, so `.wasm?url` imports in runtime.ts would
// otherwise fail to resolve; a `bun` module plugin (registered below, scoped to this
// test file) resolves them to `file://` URLs on disk instead, which runtime.ts's own
// `fetch(...)` reads unmodified. No DOM is needed on this path: GhosttyTerminalCore's
// write/snapshot API only touches WebAssembly, not the browser.

import { plugin } from "bun";
import { describe, expect, test } from "bun:test";

plugin({
  name: "wasm-url-from-disk",
  setup(build) {
    build.onResolve({ filter: /\.wasm\?url(&no-inline)?$/ }, args => {
      const cleanPath = args.path.split("?")[0];
      const importerDir = args.importer.replace(/^file:\/\//, "").replace(/\/[^/]*$/, "");
      const resolvedPath = new URL(cleanPath, `file://${importerDir}/`).pathname;
      return { path: resolvedPath, namespace: "wasm-url-from-disk" };
    });
    build.onLoad({ filter: /.*/, namespace: "wasm-url-from-disk" }, args => ({
      contents: `export default ${JSON.stringify(`file://${args.path}`)};`,
      loader: "js",
    }));
  },
});

describe("GhosttyTerminalCore (wasm smoke test)", () => {
  test("writing 'hello\\r\\n' renders it on the first row", async () => {
    const { GhosttyTerminalCore } = await import("./core");
    const core = await GhosttyTerminalCore.create(
      80,
      24,
      8,
      16,
      {
        foreground: { r: 229, g: 231, b: 235 },
        background: { r: 0, g: 0, b: 0 },
        cursor: { r: 229, g: 231, b: 235 },
      },
      () => {},
    );
    try {
      core.write("hello\r\n");
      const snapshot = core.snapshot();
      expect(snapshot.rowData[0]?.text.startsWith("hello")).toBe(true);
    } finally {
      core.dispose();
    }
  });
});
