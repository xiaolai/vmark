/**
 * Workspace event bus — coalescing pub/sub over normalized fs events.
 *
 * Purpose: The single subscription point for the workspace event layer. One
 *   Rust `fs:changed` stream in ({@link attachFsSource}); coalesced, batched
 *   {@link SemanticWorkspaceEvent} arrays out to any number of subscribers.
 *   Publishes are batched on a fixed window (flushed `coalesceMs` after the
 *   first buffered event, repeatedly while a storm keeps arriving), so a git
 *   checkout or formatter run reaches consumers as a few batches rather than the
 *   raw per-file event flood.
 *
 * Boundary discipline: the bus transports events; it never interprets them.
 *   Subscribers decide meaning and reaction (bureau interprets significance;
 *   the agent acts) — the bus only guarantees a trustworthy, deduplicated,
 *   self-write-flagged, coalesced signal.
 *
 * @coordinates-with services/workspaceEvents/normalizeFsEvents — the pure transform this wraps
 * @module services/workspaceEvents/workspaceEventBus
 */

import { workspaceEventsWarn } from "@/utils/debug";

import { normalizeFsEvents } from "./normalizeFsEvents";
import type { RawFsChangeEvent, SemanticWorkspaceEvent } from "./types";

/** A subscriber receiving one coalesced batch of workspace events. */
export type WorkspaceEventListener = (events: SemanticWorkspaceEvent[]) => void;

/** The coalescing pub/sub surface. */
export interface WorkspaceEventBus {
  /** Register a listener; returns an unsubscribe fn. */
  subscribe(listener: WorkspaceEventListener): () => void;
  /** Buffer events for coalesced delivery. Empty arrays are ignored. */
  publish(events: SemanticWorkspaceEvent[]): void;
  /** Cancel any pending delivery and drop all listeners. */
  dispose(): void;
}

/** Default coalesce window (ms) — long enough to absorb a git/formatter storm. */
const DEFAULT_COALESCE_MS = 50;

/**
 * Create a coalescing workspace event bus. Buffered publishes are flushed as one
 * batch `coalesceMs` after the *first* buffered event (the window re-arms each
 * cycle), so a burst arrives as a few batches rather than the raw per-event flood.
 */
export function createWorkspaceEventBus(
  coalesceMs: number = DEFAULT_COALESCE_MS,
): WorkspaceEventBus {
  const listeners = new Set<WorkspaceEventListener>();
  let buffer: SemanticWorkspaceEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function flush(): void {
    timer = null;
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    for (const listener of listeners) {
      try {
        listener(batch);
      } catch (err) {
        // One bad subscriber must never break delivery to the others.
        workspaceEventsWarn("subscriber threw", err);
      }
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(events) {
      // Ignore a late publish (e.g. a suppression promise resolving after
      // dispose) so it can't schedule a stray timer on a dead bus.
      if (disposed || events.length === 0) return;
      buffer.push(...events);
      if (timer === null) timer = setTimeout(flush, coalesceMs);
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      buffer = [];
      listeners.clear();
    },
  };
}

/** Injected collaborators for wiring the bus to the Rust `fs:changed` stream. */
export interface FsSourceDeps {
  /** Tauri event subscription (or a fake in tests). */
  listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
  /** Read the active workspace root live, per event (`null` outside workspace mode). */
  getRootPath: () => string | null;
  /** Normalize a path for scoping/dedup. */
  normalizePath: (path: string) => string;
  /** True if a save VMark initiated is pending for the normalized path. */
  hasPendingSave: (normalizedPath: string) => boolean;
  /**
   * Optional content no-op filter (see `suppressUnchanged`). When present, its
   * result is published instead of the raw normalized events; on rejection the
   * unfiltered events are published (never drop on error). Absent → publish
   * synchronously with no disk reads.
   */
  suppress?: (events: SemanticWorkspaceEvent[]) => Promise<SemanticWorkspaceEvent[]>;
}

/**
 * Wire a bus to the Rust `fs:changed` stream: every raw emission is normalized
 * (scoped to this window + workspace, deduped, self-write-flagged) and published.
 * With `deps.suppress`, content no-ops are filtered out first. Returns the Tauri
 * unlisten fn.
 */
export function attachFsSource(
  bus: WorkspaceEventBus,
  windowLabel: string,
  deps: FsSourceDeps,
): Promise<() => void> {
  // Serializes the async suppression path so concurrent per-event reads can't
  // reorder delivery or race the shared content-hash cache.
  let queue: Promise<void> = Promise.resolve();
  return deps.listen<RawFsChangeEvent>("fs:changed", (e) => {
    const events = normalizeFsEvents(e.payload, {
      windowLabel,
      rootPath: deps.getRootPath(),
      normalizePath: deps.normalizePath,
      hasPendingSave: deps.hasPendingSave,
    });
    const suppress = deps.suppress;
    if (!suppress) {
      bus.publish(events);
      return;
    }
    queue = queue.then(async () => {
      try {
        bus.publish(await suppress(events));
      } catch (err) {
        // Never drop events because suppression failed — publish unfiltered.
        workspaceEventsWarn("content suppression failed", err);
        bus.publish(events);
      }
    });
  });
}
