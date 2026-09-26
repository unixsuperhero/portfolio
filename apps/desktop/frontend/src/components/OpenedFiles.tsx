import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Events } from "@wailsio/runtime";
import { isMarkdownPath } from "@portfolio/core";
import { TakeOpenedFiles } from "../../bindings/portfolio-desktop/nativeservice.ts";
import { quickAdd } from "../api.ts";
import { useSidecarStatus } from "../hooks/useSidecarStatus.ts";

export function OpenedFiles() {
  const navigate = useNavigate();
  const status = useSidecarStatus();
  const processing = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "ok") return;
    const openPending = async () => {
      if (processing.current) return;
      processing.current = true;
      try {
        while (true) {
          const paths = await TakeOpenedFiles() ?? [];
          if (!paths.length) break;
          for (const path of paths) {
            try {
              if (!isMarkdownPath(path)) throw new Error("Choose a Markdown file.");
              const item = await quickAdd(path, { type: "document" });
              await navigate(`/items/${item.id}`);
            } catch (cause) {
              setError(`Could not open ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
            }
          }
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not receive opened files.");
      } finally {
        processing.current = false;
      }
    };
    const unsubscribe = Events.On("native:files-opened", () => { void openPending(); });
    void openPending();
    return unsubscribe;
  }, [navigate, status]);

  return error ? <p role="alert" className="markdown-error">{error} <button type="button" onClick={() => setError("")}>Dismiss</button></p> : null;
}
