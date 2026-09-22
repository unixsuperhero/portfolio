// Builds a ghostty/core.ts GhosttyTheme from this app's CSS tokens
// (packages/ui/src/tokens.css: --bg, --surface, --border, --text, --mono),
// read once at mount via getComputedStyle, per CONTRACT.md.
//
// Note: GhosttyTheme only carries foreground/background/cursor/selectionBackground —
// libghostty-vt owns the 16-colour ANSI palette internally and this vendored API does
// not expose a hook to override it, so there is nothing else for this module to build.

import type { GhosttyTheme } from "./ghostty/core";

function readToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function parseColor(value: string): { r: number; g: number; b: number } {
  // getComputedStyle resolves any CSS color syntax to rgb()/rgba().
  const match = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (match) {
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  return { r: 0, g: 0, b: 0 };
}

/** Reads the current theme tokens off `document.documentElement` and builds a GhosttyTheme. */
export function readGhosttyTheme(): GhosttyTheme {
  const styles = getComputedStyle(document.documentElement);
  const background = parseColor(readToken(styles, "--bg", "#0b1020"));
  const foreground = parseColor(readToken(styles, "--text", "#edf2f9"));
  const accent = readToken(styles, "--accent", "#7db1ff");
  return {
    foreground,
    background,
    cursor: parseColor(accent),
    selectionBackground: "rgba(125, 177, 255, 0.35)",
  };
}

/** The `--mono` token, for the font family GhosttyTerminalSurface.create() measures against. */
export function readGhosttyFontFamily(): string {
  const styles = getComputedStyle(document.documentElement);
  return readToken(styles, "--mono", "'SF Mono', 'JetBrains Mono', monospace");
}
