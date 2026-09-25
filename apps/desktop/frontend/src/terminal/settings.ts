import { isMacPlatform } from "./shims/platform";

export type TerminalOptionAsAlt = "false" | "true" | "left" | "right";

const TERMINAL_OPTION_AS_ALT_KEY = "terminal_option_as_alt";
/** Dispatched whenever a terminal setting changes so mounted surfaces update without remounting. */
export const TERMINAL_SETTINGS_EVENT = "portfolio:terminal-settings";

function isTerminalOptionAsAlt(value: string | null): value is TerminalOptionAsAlt {
  return value === "false" || value === "true" || value === "left" || value === "right";
}

export function getTerminalOptionAsAlt(): TerminalOptionAsAlt {
  const stored = localStorage.getItem(TERMINAL_OPTION_AS_ALT_KEY);
  if (isTerminalOptionAsAlt(stored)) return stored;
  return isMacPlatform(navigator.platform) ? "true" : "false";
}

export function setTerminalOptionAsAlt(value: TerminalOptionAsAlt): void {
  localStorage.setItem(TERMINAL_OPTION_AS_ALT_KEY, value);
  window.dispatchEvent(new CustomEvent(TERMINAL_SETTINGS_EVENT));
}
