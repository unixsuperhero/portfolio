import { openTerminal } from "../terminal/store.ts";
import { copyText, openPath, openSystem, reveal } from "../native.ts";
import { pathAction, toggleItem } from "../api.ts";
import { externalLinkUrl } from "../lib/navigation.ts";

export interface MenuAction { label: string; run: () => void; danger?: boolean }

export const MENU_SEPARATOR = "──";

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

/** The actions an element offers, from its link, its path, and the item it belongs to. */
export function contextActionsFor(target: Element, navigate: (to: string) => void): MenuAction[] {
  const urlEl = target.closest<HTMLElement>("a[href], [data-url]");
  const rawUrl = urlEl?.dataset.url ?? urlEl?.getAttribute("href");
  let url: string | null = null;
  try { if (rawUrl) url = externalLinkUrl(rawUrl, window.location.href); }
  catch (error) { console.error("Cannot open link", error); }
  const pathEl = target.closest<HTMLElement>("[data-path]");
  const itemEl = target.closest<HTMLElement>("[data-item]");
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
    if (actions.length) actions.push({ label: MENU_SEPARATOR, run: () => {} });
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
    if (actions.length) actions.push({ label: MENU_SEPARATOR, run: () => {} });
    actions.push(
      { label: pinned ? "Unpin" : "Pin", run: () => void toggleItem(id, "pinned") },
      { label: starred ? "Unstar" : "Star", run: () => void toggleItem(id, "starred") },
      { label: "Edit", run: () => navigate(`/items/${id}`) },
    );
  }

  return actions;
}
