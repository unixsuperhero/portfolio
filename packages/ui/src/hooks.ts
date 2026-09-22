import { useCallback, useEffect, useState } from "react";
import type { ItemFilter, ItemView } from "@portfolio/core";

export interface Loader<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Loads anything async and re-runs when `deps` change; never resets the page, only its own slice of state. */
export function useLoader<T>(load: () => Promise<T>, deps: unknown[]): Loader<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    load().then(value => { if (live) { setData(value); setError(null); } }, reason => { if (live) setError((reason as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: useCallback(() => setTick(t => t + 1), []) };
}

/** Minimal shape of @portfolio/client that the hooks need, so the UI package has no hard dependency on it. */
export interface PortfolioApi {
  portfolio(id: number): Promise<{ id: number; name: string; description: string; cards: ({ id: number; items: ItemView[]; total: number } & Record<string, unknown>)[] }>;
  items(filter?: ItemFilter): Promise<ItemView[]>;
}

export const usePortfolio = (api: PortfolioApi, id: number) => useLoader(() => api.portfolio(id), [api, id]);
export const useItems = (api: PortfolioApi, filter: ItemFilter = {}) => useLoader(() => api.items(filter), [api, JSON.stringify(filter)]);
