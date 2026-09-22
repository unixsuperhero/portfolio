// The terminal part's public contract (see ../../CONTRACT.md, "Frontend"). The rest of
// src/ imports only openTerminal and useTerminalStore from this module. store.ts and
// TerminalDock.tsx are the two files the contract names explicitly; GhosttyTerminal.tsx
// reaches a few extra setters below (setTabPtyId, setTabExited) to report pty lifecycle
// back into the shared tab list.

import { useSyncExternalStore } from "react";

export interface TerminalRequest { cwd?: string; command?: string; title?: string }
export interface TerminalTab { id: string; title: string; cwd: string; command?: string; ptyId: string | null; exited: number | null }

interface State { tabs: TerminalTab[]; active: string | null; open: boolean }

let state: State = { tabs: [], active: null, open: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const set = (next: Partial<State>) => { state = { ...state, ...next }; emit(); };

function nextId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function defaultTitle(request: TerminalRequest): string {
  if (request.title) return request.title;
  if (request.command) return request.command;
  if (request.cwd) return request.cwd.split("/").filter(Boolean).at(-1) ?? request.cwd;
  return "shell";
}

/** Creates a tab, shows the dock, and returns the new tab's id. */
export function openTerminal(request: TerminalRequest = {}): string {
  const id = nextId();
  const tab: TerminalTab = {
    id,
    title: defaultTitle(request),
    cwd: request.cwd ?? "",
    command: request.command,
    ptyId: null,
    exited: null,
  };
  set({ tabs: [...state.tabs, tab], active: id, open: true });
  return id;
}

function updateTab(id: string, patch: Partial<TerminalTab>): void {
  const tabs = state.tabs.map(tab => (tab.id === id ? { ...tab, ...patch } : tab));
  set({ tabs });
}

/** Records the pty session id once GhosttyTerminal creates it (first resize). */
export function setTabPtyId(id: string, ptyId: string): void {
  updateTab(id, { ptyId });
}

/** Records the exit code once the session's pty exits; output stays visible. */
export function setTabExited(id: string, code: number): void {
  updateTab(id, { exited: code });
}

export function useTerminalStore() {
  const snapshot = useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state,
  );
  return {
    ...snapshot,
    setOpen: (open: boolean) => set({ open }),
    focus: (id: string) => set({ active: id }),
    close: (id: string) => {
      const tabs = state.tabs.filter(tab => tab.id !== id);
      set({ tabs, active: state.active === id ? (tabs.at(-1)?.id ?? null) : state.active });
    },
  };
}
