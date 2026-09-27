/**
 * Pseudo focus for listings. One row at a time is "focused" without moving browser focus:
 * j/k move it, Enter runs the row's standard action, Space toggles its selection checkbox,
 * and `.` opens the command palette scoped to that row's actions.
 *
 * Rows are found by selector, so every listing takes part without per-page wiring.
 */

export const NAV_ROW_SELECTOR = [
  "[data-nav-item]",
  "article.item",
  ".selectable-pr-row",
  ".task-row",
  ".tasks-card-row",
  ".port-row",
  "a.tile",
  ".notification-list > li",
  "table.data-table > tbody > tr:not(:has(.empty-table-cell))",
].join(", ");

export const NAV_FOCUS_ATTR = "data-nav-focused";
export const ROW_ACTIONS_EVENT = "portfolio:row-actions";

const EDITABLE = "input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']), textarea, select, [contenteditable='true'], [contenteditable='']";
const INTERACTIVE = "a[href], button, input, select, textarea, summary, [role='tab'], [role='button'], [contenteditable='true']";
const BLOCKING = ".command-palette, dialog[open], .context-menu";
const OUTSIDE = ".terminal-dock-shell, .command-palette, dialog, .context-menu";

export type NavIntent = "down" | "up" | "open" | "select" | "actions";
export type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export interface NavContext {
  /** Browser focus is in a text field, select, or editable region. */
  editable: boolean;
  /** Browser focus is on a control that handles Enter/Space itself. */
  interactive: boolean;
  /** A palette, modal, or menu is open, or focus is in the terminal. */
  blocked: boolean;
}

export interface RowAction { id: string; label: string; hint: string; run: () => void }
export interface RowActionsDetail { label: string; actions: RowAction[] }
export interface ContextAction { label: string; run: () => void }

/** Which list action a key press means, or null when the key belongs to something else. */
export function navIntent(event: KeyLike, context: NavContext): NavIntent | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (context.blocked || context.editable) return null;
  if (event.key === "j") return "down";
  if (event.key === "k") return "up";
  if (event.key === ".") return "actions";
  if (context.interactive) return null;
  if (event.key === "Enter") return "open";
  if (event.key === " ") return "select";
  return null;
}

/** Cmd+K opens the palette from anywhere. Ctrl+K stays the native kill-line inside text fields. */
export function shouldOpenPalette(event: KeyLike, context: { inPalette: boolean; editable: boolean; modalOpen: boolean }): boolean {
  if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return false;
  if (context.inPalette || context.modalOpen) return false;
  if (event.metaKey) return true;
  return event.ctrlKey && !context.editable;
}

/** The next row index. With nothing focused, either direction lands on the first row. */
export function moveIndex(current: number, length: number, direction: 1 | -1): number {
  if (length <= 0) return -1;
  if (current < 0) return 0;
  return Math.max(0, Math.min(current + direction, length - 1));
}

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(EDITABLE) !== null;

const text = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

function elementLabel(element: Element): string {
  const own = element instanceof HTMLElement ? element.dataset.navLabel : undefined;
  return text(own) || text(element.getAttribute("aria-label")) || text(element.getAttribute("title")) || text(element.textContent);
}

const isVisible = (element: Element) => element.getClientRects().length > 0;

function primaryOf(row: HTMLElement): HTMLElement | null {
  const marked = row.matches("[data-nav-primary]") ? row : row.querySelector<HTMLElement>("[data-nav-primary]");
  if (marked) return marked;
  if (row.matches("a[href]")) return row;
  return [...row.querySelectorAll<HTMLElement>("a[href]")].find(isVisible) ?? null;
}

function checkboxOf(row: HTMLElement): HTMLInputElement | null {
  const marked = row.querySelector<HTMLInputElement>("input[type='checkbox'][data-nav-select]");
  if (marked) return marked.disabled ? null : marked;
  return [...row.querySelectorAll<HTMLInputElement>("input[type='checkbox']:not(.done-check)")].find(box => !box.disabled && isVisible(box)) ?? null;
}

function rowLabel(row: HTMLElement): string {
  const primary = primaryOf(row);
  return text(row.dataset.navLabel) || (primary ? elementLabel(primary) : "") || text(row.textContent).slice(0, 80);
}

export interface ListNavOptions {
  /** Extra actions for an element, the same ones its right-click menu offers. */
  contextActions?: (target: Element) => ContextAction[];
}

/** Attaches the pseudo-focus controller to the page. Returns the cleanup function. */
export function attachListNavigation(options: ListNavOptions = {}): () => void {
  let focused: HTMLElement | null = null;
  let lastIndex = -1;
  let focusPage = "";

  const page = () => window.location.hash.split("?")[0] ?? "";

  const container = () => document.querySelector<HTMLElement>(".content") ?? document.body;
  const rows = () => [...container().querySelectorAll<HTMLElement>(NAV_ROW_SELECTOR)].filter(isVisible);

  const paint = () => {
    for (const element of document.querySelectorAll(`[${NAV_FOCUS_ATTR}]`)) {
      if (element !== focused) element.removeAttribute(NAV_FOCUS_ATTR);
    }
    focused?.setAttribute(NAV_FOCUS_ATTR, "true");
  };

  const setFocus = (row: HTMLElement | null, index: number, scroll: boolean) => {
    focused = row;
    lastIndex = index;
    focusPage = page();
    paint();
    if (row && scroll) row.scrollIntoView({ block: "nearest" });
  };

  /** Keeps the focus on a live row: when the focused row leaves the list, its neighbour takes over. */
  const reconcile = () => {
    if (lastIndex < 0) return;
    const list = rows();
    if (focused && focused.isConnected && list.includes(focused)) {
      lastIndex = list.indexOf(focused);
      paint();
      return;
    }
    // A different page starts with nothing focused.
    if (focusPage !== page()) { setFocus(null, -1, false); return; }
    const key = focused?.dataset.navItem ?? focused?.dataset.item;
    const byKey = key ? list.find(row => (row.dataset.navItem ?? row.dataset.item) === key) : undefined;
    const next = byKey ?? list[Math.min(lastIndex, list.length - 1)] ?? null;
    setFocus(next, next ? list.indexOf(next) : -1, false);
  };

  const actionsFor = (row: HTMLElement): RowAction[] => {
    const actions: RowAction[] = [];
    const seen = new Set<string>();
    const add = (label: string, hint: string, run: () => void) => {
      const name = text(label);
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      actions.push({ id: `row-action-${actions.length}`, label: name, hint, run });
    };
    const primary = primaryOf(row);
    const box = checkboxOf(row);
    if (primary) add(`Open ${elementLabel(primary)}`, "Enter", () => primary.click());
    if (box) add(box.checked ? "Remove from selection" : "Add to selection", "Space", () => box.click());
    for (const control of row.querySelectorAll<HTMLElement>("a[href], button, input[type='checkbox']")) {
      if (control === primary || control === box || !isVisible(control)) continue;
      if ((control as HTMLButtonElement | HTMLInputElement).disabled) continue;
      add(elementLabel(control), control.matches("a[href]") ? "Link" : control.matches("input") ? "Toggle" : "Action", () => control.click());
    }
    const targets = new Set<Element>([primary ?? row, row, ...row.querySelectorAll("[data-path], [data-url]")]);
    for (const target of targets) {
      for (const action of options.contextActions?.(target) ?? []) {
        if (/[\p{L}\p{N}]/u.test(action.label)) add(action.label, "Menu", action.run);
      }
    }
    return actions;
  };

  const openActions = (row: HTMLElement) => {
    const detail: RowActionsDetail = { label: rowLabel(row), actions: actionsFor(row) };
    if (detail.actions.length) window.dispatchEvent(new CustomEvent<RowActionsDetail>(ROW_ACTIONS_EVENT, { detail }));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    const active = document.activeElement;
    const intent = navIntent(event, {
      editable: isEditableTarget(target),
      interactive: active instanceof Element && active !== document.body && active.matches(INTERACTIVE),
      blocked: document.querySelector(BLOCKING) !== null || target?.closest(OUTSIDE) != null,
    });
    if (!intent) return;

    if (intent === "down" || intent === "up") {
      const list = rows();
      if (!list.length) return;
      event.preventDefault();
      const current = focused && list.includes(focused) ? list.indexOf(focused) : -1;
      const index = moveIndex(current, list.length, intent === "down" ? 1 : -1);
      // Browser focus steps aside so Enter and Space reach the pseudo-focused row.
      if (active instanceof HTMLElement && active !== document.body) active.blur();
      setFocus(list[index] ?? null, index, true);
      return;
    }

    if (!focused || !focused.isConnected || !isVisible(focused)) return;
    const row = focused;
    if (intent === "actions") { event.preventDefault(); openActions(row); return; }
    if (intent === "select") {
      const box = checkboxOf(row);
      if (!box) return;
      event.preventDefault();
      box.click();
      return;
    }
    event.preventDefault();
    const primary = primaryOf(row);
    if (primary) primary.click();
    else openActions(row);
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(OUTSIDE)) return;
    const row = target.closest<HTMLElement>(NAV_ROW_SELECTOR);
    if (!row || !container().contains(row)) return;
    setFocus(row, rows().indexOf(row), false);
  };

  const observer = new MutationObserver(reconcile);
  observer.observe(container(), { childList: true, subtree: true });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pointerdown", onPointerDown, true);

  return () => {
    observer.disconnect();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointerdown", onPointerDown, true);
    focused = null;
    paint();
  };
}
