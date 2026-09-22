import { useEffect, useState } from "react";
import { health } from "../api.ts";

/** Polls GET /health every 10s. Only ever touches its own tiny slice of state. */
export function useSidecarStatus() {
  const [status, setStatus] = useState<"unknown" | "ok" | "down">("unknown");

  useEffect(() => {
    let live = true;
    const check = () => {
      health()
        .then(() => { if (live) setStatus("ok"); })
        .catch(() => { if (live) setStatus("down"); });
    };
    check();
    const id = setInterval(check, 10_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  return status;
}
