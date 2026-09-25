import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { openTerminal } from "../terminal/store.ts";
import { copyText, openPath, openSystem, reveal } from "../native.ts";
import { pathAction, toggleItem } from "../api.ts";

import { externalLinkUrl } from "../lib/navigation.ts";

interface MenuAction { label: string; run: () => void; danger?: boolean }
interface MenuState { x: number; y: number; actions: MenuAction[] }

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

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
      const urlEl = target.closest<HTMLElement>("a[href], [data-url]");
      const rawUrl = urlEl?.dataset.url ?? urlEl?.getAttribute("href");
      let url: string | null = null;
      try { if (rawUrl) url = externalLinkUrl(rawUrl, window.location.href); }
      catch (error) { console.error("Cannot open link", error); }
      const pathEl = target.closest<HTMLElement>("[data-path]");
      const itemEl = target.closest<HTMLElement>("[data-item]");
      if (!url && !pathEl && !itemEl) return;

      event.preventDefault();
      const actions: MenuAction[] = [];

      if (url) {
        const destination = url;
        actions.push(
          { label: "Open in system browser", run: () => void openSystem(destination).catch(error => console.error("Cannot open system browser", error)) },
          { label: "Copy link", run: () => void copyText(destination) },
        );
      }

      if (pathEl) {
        const path = pathEl.dataset.path!;
        const kind = pathEl.dataset.kind === "dir" ? "dir" : "file";
        if (actions.length) actions.push({ label: "──", run: () => {} });
        actions.push(
          { label: "Copy path", run: () => void copyText(path) },
          { label: "Reveal in Finder", run: () => void reveal(path) },
          { label: "Open", run: () => void openPath(path) },
          { label: "Open terminal here", run: () => openTerminal({ cwd: kind === "dir" ? path : dirname(path), title: path.split("/").pop() }) },
        );
        const itemIdForSlot = pathEl.dataset.item ?? itemEl?.dataset.item;
        if (kind === "file" && itemIdForSlot) {
          actions.push({ label: "Create if missing", run: () => void pathAction(Number(itemIdForSlot), "create", pathEl.dataset.slot) });
        }
      }

      if (itemEl) {
        const id = Number(itemEl.dataset.item);
        // @portfolio/ui rows (RailItem, ItemRow) don't expose data-pinned/data-starred, only an
        // "is-pinned"/"is-starred" class, so fall back to that when this element is one of theirs.
        const pinned = itemEl.dataset.pinned === "1" || itemEl.dataset.pinned === "true" || itemEl.classList.contains("is-pinned");
        const starred = itemEl.dataset.starred === "1" || itemEl.dataset.starred === "true" || itemEl.classList.contains("is-starred");
        if (actions.length) actions.push({ label: "──", run: () => {} });
        actions.push(
          { label: pinned ? "Unpin" : "Pin", run: () => void toggleItem(id, "pinned") },
          { label: starred ? "Unstar" : "Star", run: () => void toggleItem(id, "starred") },
          { label: "Edit", run: () => navigate(`/items/${id}`) },
        );
      }

      setMenu({ x: event.clientX, y: event.clientY, actions: actions.filter(action => action.label !== "──" || true) });
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
        action.label === "──" ? <hr key={index} /> : (
          <button key={index} type="button" className={action.danger ? "danger" : ""} onClick={() => { action.run(); close(); }}>{action.label}</button>
        ),
      )}
    </div>
  );
}
