/**
 * True when this page is served by the Wails webview. Detected from the page URL
 * (wails:// on macOS and Linux, http://wails.localhost on Windows) rather than
 * `window._wails`, which only exists once the runtime module has evaluated.
 */
export const isWails = (): boolean =>
  typeof window !== "undefined" && (window.location.protocol === "wails:" || window.location.hostname === "wails.localhost");

/** The page's own origin, built from href because location.origin is "null" on non-special schemes. */
export const ownOrigin = (): string => {
  const here = new URL(window.location.href);
  return `${here.protocol}//${here.host}`;
};
