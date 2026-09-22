// The terminal part's public contract (see ../../CONTRACT.md, "Frontend").

import { useCallback, useEffect, useRef, useState } from "react";
import { GhosttyTerminal } from "./GhosttyTerminal";
import { openTerminal, useTerminalStore } from "./store";
import "./terminal.css";

const HEIGHT_STORAGE_KEY = "pf-terminal-dock-height";
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 720;

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(HEIGHT_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    if (Number.isFinite(parsed)) return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parsed));
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to the default.
  }
  return DEFAULT_HEIGHT;
}

function tabLabel(title: string, exited: number | null): string {
  return exited === null ? title : `${title} [exited ${exited}]`;
}

export function TerminalDock() {
  const store = useTerminalStore();
  const [height, setHeight] = useState(readStoredHeight);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const activeTab = store.tabs.find(tab => tab.id === store.active) ?? null;

  const newTab = useCallback(() => {
    openTerminal({ cwd: activeTab?.cwd || "" });
  }, [activeTab]);

  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
    } catch {
      // Ignore — the height just won't persist across reloads.
    }
  }, [height]);

  const onDragStart = useCallback((event: React.PointerEvent) => {
    dragState.current = { startY: event.clientY, startHeight: height };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }, [height]);

  const onDragMove = useCallback((event: React.PointerEvent) => {
    if (!dragState.current) return;
    const delta = dragState.current.startY - event.clientY;
    setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragState.current.startHeight + delta)));
  }, []);

  const onDragEnd = useCallback((event: React.PointerEvent) => {
    dragState.current = null;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    if (event.key === "t" || event.key === "T") {
      event.preventDefault();
      newTab();
    } else if (event.key === "w" || event.key === "W") {
      if (store.active) {
        event.preventDefault();
        store.close(store.active);
      }
    }
  }, [newTab, store]);

  if (!store.open) return null;

  return (
    <div className="terminal-dock" style={{ height }} onKeyDown={onKeyDown}>
      <div
        className="terminal-dock-handle"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      />
      <div className="terminal-dock-tabs">
        {store.tabs.map(tab => (
          <div
            key={tab.id}
            className={`terminal-dock-tab${tab.id === store.active ? " terminal-dock-tab-active" : ""}`}
          >
            <button type="button" className="terminal-dock-tab-label" onClick={() => store.focus(tab.id)}>
              {tabLabel(tab.title, tab.exited)}
            </button>
            <button
              type="button"
              className="terminal-dock-tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={() => store.close(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="terminal-dock-new-tab" aria-label="New terminal" onClick={newTab}>
          +
        </button>
        <button
          type="button"
          className="terminal-dock-toggle"
          aria-label="Hide terminal"
          onClick={() => store.setOpen(false)}
        >
          ⌄
        </button>
      </div>
      <div className="terminal-dock-body">
        {store.tabs.map(tab => (
          <div
            key={tab.id}
            className="terminal-dock-pane"
            style={{ display: tab.id === store.active ? "block" : "none" }}
          >
            <GhosttyTerminal tab={tab} />
          </div>
        ))}
      </div>
    </div>
  );
}
