import { useCallback, useEffect, useRef, useState } from "react";
import { PortfolioApiError } from "@portfolio/client";
import { getOncall, patchOncallItem, patchOncallPolling } from "../api.ts";
import type { OncallItem, OncallPrompt, OncallResponse, OncallStatus } from "../types.ts";

const EMPTY: OncallResponse = { items: [], prompts: [], last_polled_at: null, polling_paused: false, polling_error: null };

export interface OncallDataValue {
  items: OncallItem[];
  prompts: OncallPrompt[];
  pollingPaused: boolean;
  lastPolledAt: string | null;
  pollingError: string | null;
  loading: boolean;
  offline: boolean;
  /** Why the last GET /api/oncall failed, when it did. */
  lastError: string | null;
  reload: () => Promise<OncallResponse>;
  /** Sets an item's manual status, or clears the override with null. Resolves with the stored item. */
  setStatus: (id: number, status: OncallStatus | null) => Promise<OncallItem>;
  /** Stops or resumes automatic intake without interrupting an in-flight poll. */
  setPollingPaused: (paused: boolean) => Promise<boolean>;
}

/**
 * Polls GET /api/oncall every 30s. Only ever touches its own slice of state: a poll never
 * navigates, never scrolls, and never overwrites an item whose status change is still in
 * flight, so a page's selection and draft controls survive a refresh.
 */
export function useOncall(): OncallDataValue {
  const [data, setData] = useState<OncallResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const ticket = useRef(0);
  const items = useRef<OncallItem[]>([]);
  const pending = useRef(new Map<number, OncallItem>());
  const pollingMutation = useRef(false);

  const applyItems = useCallback((next: OncallItem[]) => {
    items.current = next;
    setData(current => ({ ...current, items: next }));
  }, []);

  const load = useCallback(async () => {
    const current = ++ticket.current;
    try {
      const result = await getOncall();
      if (current === ticket.current) {
        const merged = result.items.map(item => pending.current.get(item.id) ?? item);
        items.current = merged;
        setData(previous => ({ ...result, items: merged, polling_paused: pollingMutation.current ? previous.polling_paused : result.polling_paused }));
        setOffline(false);
        setLastError(null);
      }
      return result;
    } catch (error) {
      if (current === ticket.current) {
        setOffline(true);
        setLastError(error instanceof PortfolioApiError ? error.message : "Request failed.");
      }
      throw error;
    } finally {
      if (current === ticket.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch(() => {});
    const timer = window.setInterval(() => void load().catch(() => {}), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const setStatus = useCallback(async (id: number, status: OncallStatus | null) => {
    const previous = items.current.find(item => item.id === id);
    if (previous) {
      // Clearing the override falls back to whatever the poller suggests.
      const optimistic: OncallItem = { ...previous, manual_status: status, status: status ?? previous.suggested_status };
      pending.current.set(id, optimistic);
      applyItems(items.current.map(item => (item.id === id ? optimistic : item)));
    }
    try {
      const updated = await patchOncallItem(id, status);
      pending.current.delete(id);
      applyItems(items.current.map(item => (item.id === id ? updated : item)));
      return updated;
    } catch (error) {
      pending.current.delete(id);
      if (previous) applyItems(items.current.map(item => (item.id === id ? previous : item)));
      throw error;
    }
  }, [applyItems]);

  const setPollingPaused = useCallback(async (paused: boolean) => {
    pollingMutation.current = true;
    try {
      const updated = await patchOncallPolling(paused);
      ++ticket.current; // Ignore any board request that started before the mutation completed.
      setData(current => ({ ...current, polling_paused: updated.polling_paused }));
      return updated.polling_paused;
    } finally {
      pollingMutation.current = false;
    }
  }, []);

  return {
    items: data.items,
    prompts: data.prompts,
    lastPolledAt: data.last_polled_at,
    pollingPaused: data.polling_paused,
    pollingError: data.polling_error,
    loading,
    offline,
    lastError,
    reload: load,
    setStatus,
    setPollingPaused,
  };
}
