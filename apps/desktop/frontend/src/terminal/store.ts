// Stub kept to the contract in ../../CONTRACT.md until the terminal part lands.
import { useSyncExternalStore } from "react";

export interface TerminalRequest { cwd?: string; command?: string; title?: string }
export interface TerminalTab { id: string; title: string; cwd: string; command?: string; ptyId: string | null; exited: number | null }
interface State { tabs: TerminalTab[]; active: string | null; open: boolean }

let state: State = { tabs: [], active: null, open: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const set = (next: Partial<State>) => { state = { ...state, ...next }; emit(); };

export function openTerminal(request: TerminalRequest = {}): string {
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tab: TerminalTab = { id, title: request.title ?? request.command ?? request.cwd ?? "shell", cwd: request.cwd ?? "", command: request.command, ptyId: null, exited: null };
  set({ tabs: [...state.tabs, tab], active: id, open: true });
  return id;
}

export function useTerminalStore() {
  const snapshot = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
  return {
    ...snapshot,
    setOpen: (open: boolean) => set({ open }),
    focus: (id: string) => set({ active: id }),
    close: (id: string) => { const tabs = state.tabs.filter(tab => tab.id !== id); set({ tabs, active: state.active === id ? tabs.at(-1)?.id ?? null : state.active }); },
  };
}
