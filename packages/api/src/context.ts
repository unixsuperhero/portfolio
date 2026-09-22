import type { Store } from "@portfolio/db";
import type { PortsSnapshot } from "@portfolio/ports";
import { scanPorts } from "@portfolio/ports";
import type { RenderOptions } from "@portfolio/render";
import type { DirectoryWatcher } from "@portfolio/watch";

export interface ApiOptions {
  /** Renders Markdown to a standalone HTML page. Defaults to @portfolio/render's renderMarkdown through Pandoc. */
  render?: (markdown: string, options: RenderOptions) => Promise<string>;
  home?: string;
  /** How long a ports scan is cached for. */
  portsTtlMs?: number;
  log?: (message: string) => void;
  /** When set, watched-directory routes reload it so file watching picks up the change immediately. */
  watcher?: DirectoryWatcher;
}

export interface Ctx {
  store: Store;
  render: (markdown: string, options: RenderOptions) => Promise<string>;
  home: string;
  log: (message: string) => void;
  ports: { snapshot: PortsSnapshot | null; at: number; ttlMs: number };
  watcher?: DirectoryWatcher;
}

export function createContext(store: Store, options: ApiOptions = {}): Ctx {
  return {
    store,
    render: options.render ?? defaultRender,
    home: options.home ?? process.env.HOME ?? "",
    log: options.log ?? (() => {}),
    ports: { snapshot: null, at: 0, ttlMs: options.portsTtlMs ?? 10_000 },
    watcher: options.watcher,
  };
}

async function defaultRender(markdown: string, options: RenderOptions): Promise<string> {
  const { renderMarkdown } = await import("@portfolio/render");
  return renderMarkdown(markdown, options);
}

/** The cached ports snapshot, re-scanned once it is older than the configured ttl. */
export function getPortsSnapshot(ctx: Ctx): PortsSnapshot {
  const now = Date.now();
  if (!ctx.ports.snapshot || now - ctx.ports.at > ctx.ports.ttlMs) {
    ctx.ports.snapshot = scanPorts();
    ctx.ports.at = now;
  }
  return ctx.ports.snapshot;
}
