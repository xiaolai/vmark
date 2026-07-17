/**
 * Shared workspace event source — one bus + one fs subscription per window.
 *
 * Purpose: The single owner of the `fs:changed` subscription for a window. It
 *   normalizes (scope + self-write flag + kind + dedup), coalesces, and — via
 *   the content-hash cache — suppresses no-op touches, then fans the resulting
 *   {@link SemanticWorkspaceEvent} batches out to every subscriber
 *   (useFileTree, useExternalFileChanges, …). Replaces the two hand-rolled
 *   `listen("fs:changed")` listeners that each duplicated scoping + self-write
 *   logic — one owner of the raw watch, many subscribers.
 *
 * Scope: events are scoped to {@link pickWatchRoot} — the *same* root
 *   `useWindowFileWatcher` starts the Rust watcher on — so workspace and
 *   single-file modes are both covered and never drift.
 *
 * @coordinates-with hooks/useWindowFileWatcher — shares pickWatchRoot; that hook starts the watcher, this one consumes it
 * @coordinates-with services/workspaceEvents — the normalize/coalesce/suppress pipeline
 * @module hooks/useWorkspaceEventBus
 */

import { listen } from "@tauri-apps/api/event";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";

import { isBinaryMediaPath } from "@/hooks/openMediaFile";
import {
  attachFsSource,
  createContentHashCache,
  createWorkspaceEventBus,
  hashContent,
  suppressUnchanged,
  type WorkspaceEventBus,
  type WorkspaceEventListener,
} from "@/services/workspaceEvents";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { workspaceEventsWarn } from "@/utils/debug";
import { normalizePath } from "@/utils/paths";
import { hasPendingSave } from "@/utils/pendingSaves";
import { pickWatchRoot } from "@/utils/watchRoot";

/** Above this batch size, skip content suppression (a storm — pass through). */
const SUPPRESS_MAX_BATCH = 50;

/** Above this file size, skip suppression — hashing costs more than it saves. */
const MAX_SUPPRESS_BYTES = 1_000_000;

interface Source {
  bus: WorkspaceEventBus;
  /** Live subscriber count — the source disposes when it drops to zero. */
  refs: number;
  dispose: () => void;
}

/** Per-window sources, reference-counted so a closed window frees its listener + cache. */
const sources = new Map<string, Source>();

/** Resolve the current watch root imperatively (mirrors useWindowFileWatcher). */
function resolveWatchRoot(windowLabel: string): string | null {
  const scope = getActiveWorkspaceScope(windowLabel);
  const activeTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const activeFilePath = activeTabId
    ? useDocumentStore.getState().documents[activeTabId]?.filePath ?? null
    : null;
  return pickWatchRoot({
    isWorkspaceMode: scope.isWorkspaceMode,
    workspaceRoot: scope.rootPath,
    activeFilePath,
  });
}

/** Get (or lazily create + attach) the shared source for a window. */
function ensureSource(windowLabel: string): Source {
  const existing = sources.get(windowLabel);
  if (existing) return existing;

  const bus = createWorkspaceEventBus();
  const cache = createContentHashCache();
  let unlisten: (() => void) | null = null;

  const source: Source = {
    bus,
    refs: 0,
    dispose: () => {
      // Idempotent: only dispose while still the registered source.
      if (sources.get(windowLabel) !== source) return;
      sources.delete(windowLabel);
      unlisten?.();
      unlisten = null;
      bus.dispose();
    },
  };
  sources.set(windowLabel, source);

  void attachFsSource(bus, windowLabel, {
    listen,
    getRootPath: () => resolveWatchRoot(windowLabel),
    normalizePath,
    hasPendingSave,
    suppress: (events) =>
      // Skip content reads for a storm-sized batch (git checkout / formatter):
      // reading every changed file workspace-wide would cost far more than the
      // redundant reactions suppression saves. Consumers still coalesce.
      events.length > SUPPRESS_MAX_BATCH
        ? Promise.resolve(events)
        : suppressUnchanged(events, {
            cache,
            readText: async (path) => {
              // Skip a large file: hashing it costs more than the redundant
              // reaction suppression saves. Throwing makes suppressUnchanged keep
              // (never suppress) the event.
              const info = await stat(path);
              if (info.size > MAX_SUPPRESS_BYTES) {
                throw new Error("file too large to fingerprint");
              }
              return readTextFile(path);
            },
            hash: hashContent,
            isMedia: (path) => isBinaryMediaPath(path),
          }),
  })
    .then((un) => {
      if (sources.get(windowLabel) === source) unlisten = un;
      else un(); // disposed before attach resolved
    })
    .catch((err) => {
      workspaceEventsWarn("failed to attach fs source", err);
      source.dispose(); // drop the dead source so a later subscribe retries
    });

  return source;
}

/**
 * Subscribe to normalized, coalesced, no-op-suppressed workspace events for a
 * window. Lazily creates the window's shared source on first call and disposes
 * it when the last subscriber leaves (window close). Returns an unsubscribe fn.
 */
export function subscribeWorkspaceEvents(
  windowLabel: string,
  listener: WorkspaceEventListener,
): () => void {
  const source = ensureSource(windowLabel);
  source.refs += 1;
  const unsubscribe = source.bus.subscribe(listener);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsubscribe();
    source.refs -= 1;
    if (source.refs <= 0) source.dispose();
  };
}

/** Test helper: dispose and drop every window source. */
export function _resetWorkspaceEventSources(): void {
  for (const source of [...sources.values()]) source.dispose();
  sources.clear();
}
