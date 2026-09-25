import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getPrs, refreshPrs } from "../api.ts";
import type { PrsResponse } from "../types.ts";

const EMPTY: PrsResponse = {
  mine: [],
  review_requested: [],
  watched: [],
  ignored: [],
  status: { last_poll_at: null, next_poll_at: null, rate: null, polling: false, error: null, gh_ok: true, login: null },
};

interface PrDataValue {
  data: PrsResponse;
  loading: boolean;
  offline: boolean;
  reload: () => Promise<PrsResponse>;
  refresh: () => Promise<PrsResponse>;
}

const PrDataContext = createContext<PrDataValue | null>(null);

export function PrDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const request = useRef(0);

  const run = useCallback(async (fetcher: () => Promise<PrsResponse>) => {
    const current = ++request.current;
    try {
      const result = await fetcher();
      if (current === request.current) {
        setData(result);
        setOffline(false);
      }
      return result;
    } catch (error) {
      if (current === request.current) setOffline(true);
      throw error;
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => run(getPrs), [run]);
  const refresh = useCallback(() => run(refreshPrs), [run]);

  useEffect(() => {
    void reload().catch(() => {});
    const timer = window.setInterval(() => void reload().catch(() => {}), 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  return <PrDataContext.Provider value={{ data, loading, offline, reload, refresh }}>{children}</PrDataContext.Provider>;
}

export function usePrData(): PrDataValue {
  const value = useContext(PrDataContext);
  if (!value) throw new Error("usePrData must be used inside PrDataProvider");
  return value;
}
