/**
 * Per-window editor-action retry owner
 *
 * Purpose: own the retry timers for editor actions on a per-window basis. Both
 *   the native menu and the Command Palette obtain the SAME owner for a window
 *   (via `getEditorActionOwner`), so a caller's disposal cannot cancel another
 *   caller's pending work; disposing a window's owner (its editor host
 *   unmounting) cancels only that window's timers, and a disposed owner
 *   schedules nothing further. Disposal is idempotent and observable
 *   (`isDisposed()`), so an already-queued IME callback can drop itself after
 *   teardown, and a stale double-dispose never evicts a replacement owner.
 *
 * Replaces the pre-extraction module-global timer set, where one window's
 * unmount cancelled every window's pending retries (command-registry WI-1.3).
 *
 * @module services/editor/editorActionOwner
 */

/** Delay before each editor-not-mounted retry. */
const RETRY_DELAY_MS = 50;

/**
 * A window's retry owner. Timers belong to the window's editor-host lifecycle,
 * not to the caller (menu vs bus).
 */
export interface EditorActionOwner {
  readonly windowLabel: string;
  scheduleRetry(retry: () => void): void;
  dispose(): void;
  /** True once disposed — deferred (IME-queued) callbacks check this so a
   * queued action cannot execute after the window's editor host tore down. */
  isDisposed(): boolean;
}

const owners = new Map<string, EditorActionOwner>();

/** Get (or lazily create) the shared retry owner for a window. */
export function getEditorActionOwner(windowLabel: string): EditorActionOwner {
  const existing = owners.get(windowLabel);
  if (existing) return existing;

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  const owner: EditorActionOwner = {
    windowLabel,
    scheduleRetry(retry) {
      if (disposed) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        retry();
      }, RETRY_DELAY_MS);
      timers.add(timer);
    },
    dispose() {
      if (disposed) return; // idempotent
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      // Only evict self — a replacement owner may already hold this label
      // (dispose A → create B → dispose A must not evict B).
      if (owners.get(windowLabel) === owner) owners.delete(windowLabel);
    },
    isDisposed: () => disposed,
  };
  owners.set(windowLabel, owner);
  return owner;
}

/** Dispose a window's retry owner (editor host unmount). No-op if none exists. */
export function disposeEditorActionOwner(windowLabel: string): void {
  owners.get(windowLabel)?.dispose();
}
