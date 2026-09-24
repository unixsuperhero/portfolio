import { useSyncExternalStore } from "react";

export type NotificationPayload = { id: string; title: string; message: string } & (
  | { kind: "reminder"; reminder_id: number; due_at: string; task_id: number | null }
  | { kind: "pr"; url: string | null }
);
export type AppNotification = NotificationPayload & { received_at: number; dismissed_at: number | null };
export const NOTIFICATION_POPUP_MS = 8000;
const STORAGE_KEY = "portfolio.notifications.v1";

type Snapshot = { items: AppNotification[]; storageError: string; pollingError: string };
const listeners = new Set<() => void>();

export function mergeNotifications(current: AppNotification[], incoming: readonly NotificationPayload[], now: number): AppNotification[] {
  const known = new Set(current.map(item => item.id));
  const fresh: AppNotification[] = [];
  for (const item of incoming) {
    if (known.has(item.id)) continue;
    known.add(item.id);
    fresh.push({ ...item, received_at: now, dismissed_at: null });
  }
  return fresh.length ? [...current, ...fresh] : current;
}

export function dismissRecords(current: AppNotification[], ids: ReadonlySet<string> | null, now: number): AppNotification[] {
  return current.map(item => item.dismissed_at === null && (ids === null || ids.has(item.id)) ? { ...item, dismissed_at: now } : item);
}

export function visibleNotifications(items: AppNotification[], now: number): AppNotification[] {
  return items.filter(item => item.dismissed_at === null && item.received_at + NOTIFICATION_POPUP_MS > now);
}

function isNotification(value: unknown): value is AppNotification {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !("title" in value) || typeof value.title !== "string"
    || !("message" in value) || typeof value.message !== "string" || !("received_at" in value) || typeof value.received_at !== "number" || !Number.isFinite(new Date(value.received_at).getTime())
    || !("dismissed_at" in value) || (value.dismissed_at !== null && (typeof value.dismissed_at !== "number" || !Number.isFinite(new Date(value.dismissed_at).getTime()))) || !("kind" in value)) return false;
  if (value.kind === "pr") return "url" in value && (value.url === null || (typeof value.url === "string" && /^https?:\/\//.test(value.url)));
  return value.kind === "reminder" && "reminder_id" in value && typeof value.reminder_id === "number" && Number.isInteger(value.reminder_id)
    && "due_at" in value && typeof value.due_at === "string" && Number.isFinite(Date.parse(value.due_at))
    && "task_id" in value && (value.task_id === null || (typeof value.task_id === "number" && Number.isInteger(value.task_id)));
}

export function decodeNotifications(raw: string | null): AppNotification[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every(isNotification)) throw new Error("Saved notification history is invalid.");
  return value;
}

function load(): Snapshot {
  try {
    return { items: typeof window === "undefined" ? [] : decodeNotifications(window.localStorage.getItem(STORAGE_KEY)), storageError: "", pollingError: "" };
  } catch (error) {
    return { items: [], storageError: `Could not load notification history: ${String(error)}`, pollingError: "" };
  }
}
let snapshot = load();
const getSnapshot = () => snapshot;
function emit() { listeners.forEach(listener => listener()); }
function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const loaded = load();
  if (loaded.storageError) snapshot = { ...snapshot, storageError: loaded.storageError };
  else snapshot = { ...loaded, pollingError: snapshot.pollingError };
  emit();
}
function subscribe(listener: () => void) {
  if (!listeners.size && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
function save(items: AppNotification[]): boolean {
  let storageError = "";
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  catch (error) { storageError = `Notification history is only available until this window closes: ${String(error)}`; }
  if (items !== snapshot.items || storageError !== snapshot.storageError) {
    snapshot = { ...snapshot, items, storageError };
    emit();
  }
  return !storageError;
}

export function receiveNotifications(incoming: readonly NotificationPayload[]) {
  const current = snapshot.items;
  const merged = mergeNotifications(current, incoming, Date.now());
  const saved = merged === current && !snapshot.storageError ? true : save(merged);
  return { fresh: merged.slice(current.length), saved };
}
export function dismissNotifications(ids?: readonly string[]) {
  save(dismissRecords(snapshot.items, ids ? new Set(ids) : null, Date.now()));
}
export function setNotificationPollingError(pollingError: string) {
  if (pollingError === snapshot.pollingError) return;
  snapshot = { ...snapshot, pollingError };
  emit();
}
export function useNotifications() { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
