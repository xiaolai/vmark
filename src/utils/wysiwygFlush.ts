/**
 * WYSIWYG Flush Registry
 *
 * Purpose: Allows non-WYSIWYG code to trigger an immediate WYSIWYG-to-markdown
 * flush without importing the WYSIWYG module directly.
 *
 * Two registries:
 *   - The single "active" flusher (the visible editor) — used by per-tab save
 *     paths that only need the current editor synced.
 *   - A keyed registry of ALL mounted WYSIWYG flushers — used by Save All /
 *     Quit so that every open editor in this window (e.g. split-pane, or
 *     multiple mounted tabs) is synced to the document store before dirty
 *     content is collected, not just the focused one.
 */

type WysiwygFlusher = () => void;

let activeWysiwygFlusher: WysiwygFlusher | null = null;
const keyedFlushers = new Map<string, WysiwygFlusher>();

/** Register (or unregister with null) the active WYSIWYG flusher callback. */
export function registerActiveWysiwygFlusher(flusher: WysiwygFlusher | null) {
  activeWysiwygFlusher = flusher;
}

/**
 * Register (or unregister with null) a keyed WYSIWYG flusher. Keyed by a stable
 * id (typically the tab id) so every mounted editor can be flushed, regardless
 * of which one is focused.
 */
export function registerWysiwygFlusher(key: string, flusher: WysiwygFlusher | null) {
  if (flusher) {
    keyedFlushers.set(key, flusher);
  } else {
    keyedFlushers.delete(key);
  }
}

/** Immediately invoke the registered active WYSIWYG flusher, if any. */
export function flushActiveWysiwygNow() {
  activeWysiwygFlusher?.();
}

/**
 * Immediately invoke EVERY registered keyed WYSIWYG flusher. Used before
 * collecting dirty documents for Save All so inactive-but-mounted editors are
 * synced from their live editor state rather than stale store content. A
 * throwing flusher does not prevent the others from running.
 */
export function flushAllWysiwygNow() {
  for (const flusher of keyedFlushers.values()) {
    try {
      flusher();
    } catch {
      // Best-effort: one editor failing to flush must not block the rest.
    }
  }
}
