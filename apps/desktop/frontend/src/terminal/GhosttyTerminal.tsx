// Mounts one ghostty/surface.ts GhosttyTerminalSurface for one tab. Per the vendored
// README, no React state drives the render loop: the surface owns the canvas directly,
// and this component's own re-renders (from useTerminalStore) only ever flip a ref-backed
// setVisible call, never touch the surface's internals.

import { useEffect, useRef } from "react";
import { GhosttyTerminalSurface } from "./ghostty/surface";
import { readGhosttyFontFamily, readGhosttyTheme } from "./theme";
import { createPtySession, type PtySession } from "./pty";
import { getTerminalOptionAsAlt, TERMINAL_SETTINGS_EVENT } from "./settings";
import { setTabExited, setTabPtyId, useTerminalStore, type TerminalTab } from "./store";
import { openSystem } from "../native.ts";
import "./terminal.css";


export function GhosttyTerminal({ tab }: { tab: TerminalTab }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<GhosttyTerminalSurface | null>(null);
  const store = useTerminalStore();
  const isActive = store.active === tab.id;

  // Mount the surface and pty session once per tab; tab.cwd/tab.command never change
  // after creation, so tab.id is deliberately the only dependency.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let session: PtySession | null = null;
    let sessionCreated = false;
    let unsubscribeData: (() => void) | null = null;
    let unsubscribeExit: (() => void) | null = null;

    async function ensureSession(cols: number, rows: number) {
      if (sessionCreated) return;
      sessionCreated = true;
      const created = await createPtySession({ cwd: tab.cwd, cols, rows, command: tab.command });
      if (disposed) {
        created.close();
        created.dispose();
        return;
      }
      session = created;
      setTabPtyId(tab.id, created.id);
      unsubscribeData = created.onData(text => surfaceRef.current?.write(text));
      unsubscribeExit = created.onExit(code => setTabExited(tab.id, code));
    }

    void GhosttyTerminalSurface.create(mount, {
      theme: readGhosttyTheme(),
      font: { family: readGhosttyFontFamily() },
      visible: isActive,
      macosOptionAsAlt: getTerminalOptionAsAlt(),
      onData: data => session?.write(data),
      onResize: (cols, rows) => {
        if (!sessionCreated) void ensureSession(cols, rows);
        else session?.resize(cols, rows);
      },
      onSelectionChange: () => {},
      beforeKey: () => true,
      onLinkActivate: text => {
        if (/^https?:\/\//i.test(text)) void openSystem(text).catch(error => console.error("Cannot open terminal link", error));
      },
      // onContextMenu omitted: the event bubbles to the app's document-level context menu.
    }).then(surface => {
      if (disposed) {
        surface.dispose();
        return;
      }
      surfaceRef.current = surface;
    });

    return () => {
      disposed = true;
      unsubscribeData?.();
      unsubscribeExit?.();
      session?.close();
      session?.dispose();
      surfaceRef.current?.dispose();
      surfaceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  useEffect(() => {
    surfaceRef.current?.setVisible(isActive);
  }, [isActive]);

  useEffect(() => {
    const onSettingsChange = () => {
      surfaceRef.current?.setMacosOptionAsAlt(getTerminalOptionAsAlt());
    };
    window.addEventListener(TERMINAL_SETTINGS_EVENT, onSettingsChange);
    return () => window.removeEventListener(TERMINAL_SETTINGS_EVENT, onSettingsChange);
  }, []);

  return <div ref={mountRef} className="ghostty-mount" />;
}
