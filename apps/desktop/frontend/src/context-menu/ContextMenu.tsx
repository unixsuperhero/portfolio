import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { openTerminal } from "../terminal/store.ts";
import { copyText, openInApp, openPath, openSystem, reveal } from "../native.ts";
import { pathAction, toggleItem } from "../api.ts";

export type LinksOpenIn = "in-app" | "system";

export const getLinksOpenIn = (): LinksOpenIn => (localStorage.getItem("links_open_in") === "system" ? "system" : "in-app");
export const setLinksOpenIn = (value: LinksOpenIn) => localStorage.setItem("links_open_in", value);

interface MenuAction { label: string; run: () => void; danger?: boolean }
interface MenuState { x: number; y: number; actions: MenuAction[] }

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

/**
 * Mounted once in App. Implements the contract's right-click menu (data-url / http links,
 * data-path with data-kind, data-item with data-pinned/data-starred) and the left-click
 * interceptor that opens external links per the `links_open_in` setting instead of navigating
 * the webview away.
 */
export function ContextMenuProvider() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const navigate = useNavigate();

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const urlEl = target.closest<HTMLElement>("a[href^='http'], [data-url]");
      const pathEl = target.closest<HTMLElement>("[data-path]");
      const itemEl = target.closest<HTMLElement>("[data-item]");
      if (!urlEl && !pathEl && !itemEl) return;

      event.preventDefault();
      const actions: MenuAction[] = [];

      if (urlEl) {
        const url = urlEl.dataset.url ?? (urlEl as HTMLAnchorElement).href;
        actions.push(
          { label: "Open in in-app browser", run: () => void openInApp(url) },
          { label: "Open in system browser", run: () => void openSystem(url) },
          { label: "Copy link", run: () => void copyText(url) },
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
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      // Only genuinely external links leave the page. In a plain browser the app's own links also
      // resolve to http://…, so compare origins rather than trusting the scheme.
      if (!anchor || !/^https?:\/\//.test(anchor.href) || anchor.origin === window.location.origin) return;
      event.preventDefault();
      if (getLinksOpenIn() === "system") void openSystem(anchor.href);
      else void openInApp(anchor.href).catch(err => { console.error("in-app browser failed, opening in the system browser", err); return openSystem(anchor.href); });
    };

    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onScroll = () => close();
    const onClick = () => close();

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("click", onClickCapture, true);
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
