import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { openSystem } from "../native.ts";
import { externalLinkUrl } from "../lib/navigation.ts";
import { contextActionsFor, MENU_SEPARATOR, type MenuAction } from "./actions.ts";

interface MenuState { x: number; y: number; actions: MenuAction[] }

/**
 * Mounted once in App. External links always use the system browser; only navigation
 * within the current app document is allowed to reach the main webview.
 */
export function ContextMenuProvider() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const navigate = useNavigate();

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const actions = contextActionsFor(target, navigate);
      if (!actions.length) return;
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, actions });
    };

    const onClickCapture = (event: MouseEvent) => {
      if (event.type === "click" ? event.button !== 0 : event.button !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      try {
        const destination = externalLinkUrl(anchor.getAttribute("href") ?? "", window.location.href);
        if (destination === null) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        void openSystem(destination).catch(error => console.error("Cannot open system browser", error));
      } catch (error) {
        event.preventDefault();
        event.stopPropagation();
        console.error("Cannot open link", error);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onScroll = () => close();
    const onClick = () => close();

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("auxclick", onClickCapture, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("auxclick", onClickCapture, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("click", onClick);
    };
  }, [close, navigate]);

  if (!menu) return null;
  return (
    <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}>
      {menu.actions.map((action, index) =>
        action.label === MENU_SEPARATOR ? <hr key={index} /> : (
          <button key={index} type="button" className={action.danger ? "danger" : ""} onClick={() => { action.run(); close(); }}>{action.label}</button>
        ),
      )}
    </div>
  );
}
