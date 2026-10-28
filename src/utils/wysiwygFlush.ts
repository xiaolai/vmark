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
 *
 * `flushAllWysiwygNow` is best-effort: a flusher's failure does not stop the
 * rest, and is returned for a caller that must know; `flushWysiwygNow`
 * flushes one editor and throws its failure, for a caller that must know the
 * store now holds that editor's text.
 *
 * @module utils/wysiwygFlush
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
 * throwing flusher does not prevent the others from running; the keys whose
 * flusher threw are returned with their errors.
 */
export function flushAllWysiwygNow(): ReadonlyMap<string, unknown> {
  const failed = new Map<string, unknown>();
  for (const [key, flusher] of keyedFlushers) {
    try {
      flusher();
    } catch (error) {
      // Best-effort: one editor failing to flush must not block the rest.
      failed.set(key, error);
    }
  }
  return failed;
}

/**
 * Immediately invoke the keyed flusher registered for `key`, and report its
 * failure: a flusher's error is rethrown, and a key with no flusher throws,
 * because nothing brought the store up to that editor's text. For a caller
 * that has just changed that editor and must not report the store as current
 * unless it is.
 */
export function flushWysiwygNow(key: string): void {
  const flusher = keyedFlushers.get(key);
  if (!flusher) throw new Error(`no WYSIWYG flusher is registered for ${key}`);
  flusher();
}
