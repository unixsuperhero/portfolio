import { useCallback, useEffect, useRef, useState } from "react";
import type { PrEvent } from "../types.ts";
import { getPrEvents, getPrs, markPrEventsSeen } from "../api.ts";
import { notify } from "../native.ts";
import { playPing } from "../lib/sound.ts";

export interface PrToast extends PrEvent {
  /** Resolved from the current PR lists; null when the PR couldn't be looked up. */
  url: string | null;
}

/**
 * Polls GET /api/prs/events?since=<lastSeenId> every 60s. For each new event: shows an in-app
 * toast (with an "Open" action), fires a native notification, plays a short ping, then POSTs
 * /api/prs/events/seen. Only ever touches its own toast list — never navigates, resets a form,
 * or scrolls.
 */
export function usePrEvents() {
  const [toasts, setToasts] = useState<PrToast[]>([]);
  const sinceRef = useRef(0);
  const urlCache = useRef<Map<number, string>>(new Map());

  const resolveUrl = useCallback(async (prId: number): Promise<string | null> => {
    if (urlCache.current.has(prId)) return urlCache.current.get(prId)!;
    try {
      const { mine, review_requested, watched } = await getPrs();
      for (const pr of [...mine, ...review_requested, ...watched]) urlCache.current.set(pr.id, pr.url);
    } catch {
      // ignore — the toast just won't have an Open action
    }
    return urlCache.current.get(prId) ?? null;
  }, []);

  useEffect(() => {
    let live = true;
    const check = () => {
      getPrEvents(sinceRef.current)
        .then(async ({ events }) => {
          if (!live || !events.length) return;
          sinceRef.current = events.reduce((max, event) => Math.max(max, event.id), sinceRef.current);

          const withUrls: PrToast[] = [];
          for (const event of events) {
            const url = await resolveUrl(event.pr_id);
            withUrls.push({ ...event, url });
          }
          if (!live) return;

          events.forEach(event => void notify("Pull request update", event.message));
          playPing();
          setToasts(current => [...current, ...withUrls]);
          markPrEventsSeen(events.map(event => event.id)).catch(() => {});
        })
        .catch(() => {});
    };
    check();
    const id = setInterval(check, 60_000);
    return () => { live = false; clearInterval(id); };
  }, [resolveUrl]);

  const dismiss = useCallback((eventId: number) => {
    setToasts(current => current.filter(toast => toast.id !== eventId));
  }, []);

  return { toasts, dismiss };
}
