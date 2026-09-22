import { watch, type FSWatcher } from "node:fs";
import type { Database } from "bun:sqlite";
import { listWatchedDirectories } from "@portfolio/db";
import { reconcile, type Renderer, type WatchState } from "./reconcile.ts";

export interface WatcherState extends WatchState { watcher: FSWatcher | null }

/**
 * Keeps one fs watcher per watched directory and reconciles on change, debounced
 * and never overlapping. Call `reload()` after the watched_directories table
 * changes and `close()` on shutdown.
 */
export class DirectoryWatcher {
  readonly states = new Map<number, WatcherState>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private db: Database, private render: Renderer, private options: { debounceMs?: number; onError?: (error: unknown) => void } = {}) {}

  schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), this.options.debounceMs ?? 200);
  }

  /** Runs a reconcile; a call during a run queues exactly one more. */
  sync(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      do {
        this.again = false;
        const result = await reconcile(this.db, this.render);
        for (const [id, state] of result.states) this.states.set(id, { ...(this.states.get(id) ?? { watcher: null }), ...state });
      } while (this.again);
    })().catch(error => (this.options.onError ?? console.error)(error)).finally(() => { this.running = null; });
    return this.running;
  }

  /** Re-creates the watchers from the table and runs a sync. */
  async reload(): Promise<void> {
    clearTimeout(this.timer);
    for (const state of this.states.values()) state.watcher?.close();
    this.states.clear();
    for (const directory of listWatchedDirectories(this.db)) {
      const state: WatcherState = { watcher: null, error: null, lastSyncedAt: null, count: 0 };
      try {
        state.watcher = watch(directory.path, { recursive: Boolean(directory.recursive) }, () => this.schedule());
        state.watcher.on("error", error => { state.error = error.message; state.watcher?.close(); state.watcher = null; });
      } catch (error) {
        state.error = (error as Error).message;
      }
      this.states.set(directory.id, state);
    }
    await this.sync();
  }

  close(): void {
    clearTimeout(this.timer);
    for (const state of this.states.values()) state.watcher?.close();
    this.states.clear();
  }
}
