/**
 * Incremental workspace watcher (Phase 2, WI-2.5).
 *
 * Watches the workspace for markdown changes and rebuilds the index
 * (debounced), then invokes a callback so the server can swap the live index
 * and push SSE reloads. Whole-index rebuild is intentional for correctness in
 * v1 — relationship edges are cross-file, so a single edit can change other
 * docs' backlinks; a precise incremental graph patch is a later optimization.
 *
 * @module index/watch
 */

import chokidar, { type FSWatcher } from "chokidar";
import { buildIndex, type WorkspaceIndex } from "./buildIndex";
import { ALWAYS_SKIP_DIRS, type WalkOptions } from "./walk";

export interface WatchOptions extends WalkOptions {
  debounceMs?: number;
}

export interface WorkspaceWatcher {
  close: () => Promise<void>;
  /** Last rebuild/watch error message, or null (grill H10). */
  lastError: () => string | null;
  /** False once the watcher has errored fatally or been closed (grill H10). */
  alive: () => boolean;
}

const MARKDOWN_RE = /\.(md|markdown|mdown|mkd)$/i;

/** Start watching `root`; calls `onRebuild` with the fresh index after changes. */
export function watchWorkspace(
  root: string,
  onRebuild: (index: WorkspaceIndex, changedPath?: string) => void,
  options: WatchOptions = {}
): WorkspaceWatcher {
  const debounceMs = options.debounceMs ?? 150;

  const watcher: FSWatcher = chokidar.watch(root, {
    // Codex audit: compare path SEGMENTS relative to root, not a substring of
    // the absolute path (an ancestor dir named `dist`/`node_modules` would have
    // ignored the whole workspace).
    ignored: (p: string) => {
      const rel = p.startsWith(root) ? p.slice(root.length) : p;
      return rel.split(/[\\/]/).some((seg) => ALWAYS_SKIP_DIRS.has(seg));
    },
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastChanged: string | undefined;
  let rebuilding = false;
  let pendingAgain = false;
  let closed = false; // grill M7 — stop the run/re-arm loop on shutdown
  let lastError: string | null = null;
  let fatal = false;

  const schedule = (changedPath: string) => {
    if (closed || !MARKDOWN_RE.test(changedPath)) return;
    lastChanged = changedPath;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  };

  const run = async () => {
    if (closed) return; // grill M7
    if (rebuilding) {
      pendingAgain = true;
      return;
    }
    rebuilding = true;
    try {
      const idx = await buildIndex(root, options);
      if (closed) return; // Codex audit: don't fire onRebuild after shutdown
      lastError = null;
      onRebuild(idx, lastChanged);
    } catch (err) {
      // grill H10 — record the error instead of swallowing it silently.
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      rebuilding = false;
      if (pendingAgain && !closed) {
        pendingAgain = false;
        timer = setTimeout(run, debounceMs);
      }
    }
  };

  watcher.on("add", schedule).on("change", schedule).on("unlink", schedule);
  // grill H10 — surface inotify/EMFILE overflow instead of silently dying.
  watcher.on("error", (err: unknown) => {
    fatal = true;
    lastError = err instanceof Error ? err.message : String(err);
  });

  return {
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
    lastError: () => lastError,
    alive: () => !closed && !fatal,
  };
}
