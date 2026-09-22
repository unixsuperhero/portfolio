// Stub kept to the contract in ../../CONTRACT.md until the terminal part lands.
import { useTerminalStore } from "./store.ts";

export function TerminalDock() {
  const store = useTerminalStore();
  if (!store.open) return null;
  return (
    <div className="terminal-dock" style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 1rem", fontFamily: "var(--mono)" }}>
      {store.tabs.map(tab => <button key={tab.id} type="button" onClick={() => store.focus(tab.id)}>{tab.title}</button>)}
      <span style={{ marginLeft: "1rem", color: "var(--text3)" }}>terminal not wired yet</span>
    </div>
  );
}
