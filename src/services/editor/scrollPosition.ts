/**
 * Editor Scroll Position Memory
 *
 * Purpose: remember where the reader was in each tab, per editor surface, so a
 * remount (tab switch, mode toggle, split toggle, external reload) comes back
 * to the same place instead of the top of the document.
 *
 * Why this exists (#1249): the editor restored the CURSOR and nothing else, so
 * a reader who never clicked had nothing to restore to — every incidental tab
 * switch cost them their place. The cursor path is untouched: when a cursor
 * exists it still wins, because it also carries the WYSIWYG↔Source position
 * mapping. This fills the gap underneath it.
 *
 * Key decisions:
 *   - Offsets are keyed (tabId, surface). WYSIWYG pixels mean nothing in
 *     CodeMirror and vice versa, so the two surfaces never share a number.
 *   - The store is a plain module map, like `contentSearchNavigation.ts`:
 *     nothing renders from it, so a Zustand store would only add change
 *     notifications to the scroll path. `cleanupTabState` clears it on close.
 *   - A restore WAITS for the container to be able to hold the offset, rather
 *     than writing once. The old code scrolled to 0 precisely because content
 *     can still be growing — async node views, images, `content-visibility`
 *     estimates — and an early write CLAMPS against a scrollHeight that is not
 *     final. Measured in the real app (WebKit, 60-section fixture with Mermaid,
 *     KaTeX and images): the surface remounts reporting scrollHeight 1330, and
 *     the true 19464 does not arrive until ~570ms later. A frame-count window
 *     sized by guesswork (12 frames ≈ 200ms) expired first and restored
 *     nothing — the gate for this is the CONDITION, not a duration.
 *   - It holds the position for the whole window rather than writing once,
 *     because `view.focus()` and the caret reset each produce their OWN scroll
 *     a frame or two later. Measured: focus slammed the container to its
 *     maximum (16591) at +417ms, then a caret reset put it at 0 at +527ms.
 *   - Reader intent is read from INPUT GESTURES, never from position. An
 *     earlier version stood down whenever the container sat past the target —
 *     which WebKit's own scroll-caret-into-view triggers on the first frame, so
 *     the restore aborted before it ever ran. Position cannot distinguish
 *     "the reader scrolled" from "the browser scrolled".
 *   - Anything else that deliberately owns the viewport HANDS OFF explicitly:
 *     a pending lint/Find-in-Files jump skips the restore entirely
 *     (`sourceFocusRestore.ts`), and heading-fragment navigation cancels it
 *     (`cancelEditorScrollRestore`). One owner at a time, by contract rather
 *     than by whoever writes last.
 *   - Two classes of scroll event are NOT the reader and are dropped: one on a
 *     container that cannot scroll (going to Source mode flips
 *     `.editor-content` to `overflow: hidden` and zeroes it), and any arriving
 *     while a restore is in flight (`view.focus()` scrolls the caret into view
 *     mid-restore). Both were observed erasing the offset being restored.
 *
 * @coordinates-with tiptapFocus.ts — WYSIWYG restore on fresh load
 * @coordinates-with components/Editor/sourceFocusRestore.ts — Source restore
 * @coordinates-with hooks/useWysiwygScrollMemory.ts — WYSIWYG tracking
 * @coordinates-with services/windowClose/tabCleanup.ts — clears on tab close
 * @module services/editor/scrollPosition
 */

/** The two editor surfaces that own a scroll position of their own. */
export type EditorSurface = "wysiwyg" | "source";

/**
 * Frames a restore will wait for late content before giving up (~1.5s at
 * 60fps). Measured settle on a heavy document was ~570ms; the rest is headroom
 * for a slower machine. It is an upper bound, not a duration — once the offset
 * is reachable the restore lands and stops within `HOLD_FRAMES`.
 */
const MAX_RESTORE_FRAMES = 90;

/** Input that means the reader has taken over; the restore stands down. */
const USER_GESTURES = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/** Teardown for the restore currently holding a viewport, if any. */
let activeRestore: (() => void) | null = null;

/**
 * Bumped by every restore, so a capture taken before one can be told from a
 * capture taken after it.
 *
 * Suppressing writes only while a restore RUNS is not enough, and the gap is
 * not theoretical: the caret scroll is captured a moment before the restore
 * starts and written 150ms later by the throttle, from inside it. Measured
 * live, that wrote 16591 (the container's maximum) over the 8000 being
 * restored, and the reader's position walked to the bottom of the document on
 * the next tab switch.
 */
let restoreEpoch = 0;

/** Trailing-throttle window for persisting a scroll offset. */
const SAVE_THROTTLE_MS = 150;

/** Last known scroll offset per tab, per surface. */
const offsetsByTab: Record<string, Partial<Record<EditorSurface, number>>> = {};

/** Record where `surface` was scrolled to in `tabId`. */
export function setEditorScrollOffset(
  tabId: string | null | undefined,
  surface: EditorSurface,
  offset: number,
): void {
  if (!tabId) return;
  if (!Number.isFinite(offset) || offset < 0) return;
  const entry = offsetsByTab[tabId] ?? (offsetsByTab[tabId] = {});
  entry[surface] = offset;
}

/** The remembered offset for `surface` in `tabId`, or undefined if never read. */
export function getEditorScrollOffset(
  tabId: string | null | undefined,
  surface: EditorSurface,
): number | undefined {
  if (!tabId) return undefined;
  return offsetsByTab[tabId]?.[surface];
}

/** Forget every surface's offset for a tab (called on tab close/detach). */
export function clearEditorScrollOffsets(tabId: string): void {
  delete offsetsByTab[tabId];
}

/**
 * Find the scrollable ancestor of `from` (or `from` itself), falling back to
 * its direct parent. Moved here from `tiptapFocus.ts` so the tracker and the
 * restore agree on which element carries the position.
 */
export function findScrollContainer(from: HTMLElement | null): HTMLElement | null {
  if (!from) return null;
  let el: HTMLElement | null = from;
  while (el) {
    try {
      const style = getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return el;
      }
    } catch {
      // getComputedStyle may fail on mock elements in tests
      break;
    }
    el = el.parentElement;
  }
  return from.parentElement;
}

/**
 * Persist `container`'s scroll offset for (tabId, surface) while the caller
 * lives. Returns a teardown that detaches the listener and flushes whatever
 * the throttle was still holding — an unmount within 150ms of the last scroll
 * is the common case, not an edge one.
 */
export function trackEditorScroll(
  container: HTMLElement | null,
  tabId: string | null | undefined,
  surface: EditorSurface,
): () => void {
  if (!container || !tabId || typeof container.addEventListener !== "function") {
    return () => {};
  }

  let pending: number | null = null;
  let pendingEpoch = restoreEpoch;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const value = pending;
    pending = null;
    if (value === null) return;
    // A capture from before a restore describes the position the restore is
    // undoing, not the reader's. Writing it here — 150ms later, from inside the
    // restore — is how the remembered offset overwrote itself.
    if (activeRestore || pendingEpoch !== restoreEpoch) return;
    setEditorScrollOffset(tabId, surface, value);
  };

  const onScroll = () => {
    // A container that cannot scroll has no reading position to remember; the
    // event is teardown noise (overflow flipped, content removed).
    if (container.scrollHeight <= container.clientHeight) return;
    // Nor is a restore-in-flight the reader: `view.focus()` scrolls the caret
    // into view during it, and recording that 0 overwrote the very offset being
    // restored — measured live, the memory poisoned itself in one round trip.
    if (activeRestore) return;
    pending = container.scrollTop;
    pendingEpoch = restoreEpoch;
    if (timer === null) timer = setTimeout(flush, SAVE_THROTTLE_MS);
  };

  container.addEventListener("scroll", onScroll, { passive: true });

  return () => {
    container.removeEventListener("scroll", onScroll);
    if (timer !== null) clearTimeout(timer);
    flush();
  };
}

/**
 * Scroll `container` back to `offset`, holding it there for a short window
 * while late layout settles.
 *
 * `offset <= 0` is written once and returns: "the top" is always reachable, and
 * a watch loop there would fight a reader scrolling down out of a fresh load.
 */
export function restoreEditorScroll(container: HTMLElement | null, offset: number): void {
  cancelEditorScrollRestore();
  if (!container) return;
  restoreEpoch += 1;
  if (offset <= 0) {
    container.scrollTop = 0;
    return;
  }

  let frames = 0;
  let landed = false;
  let finished = false;

  const doc = container.ownerDocument;
  const finish = (settle: boolean) => {
    if (finished) return;
    finished = true;
    if (activeRestore === stop) activeRestore = null;
    for (const type of USER_GESTURES) doc?.removeEventListener(type, stop, true);
    // Ran out of patience without ever reaching the offset: the document is
    // shorter than it was. Landing at its end beats landing at its top.
    if (settle && !landed) container.scrollTop = offset;
  };
  const stop = () => finish(false);

  for (const type of USER_GESTURES) doc?.addEventListener(type, stop, true);
  activeRestore = stop;

  const step = () => {
    if (finished) return;
    // Hold it against focus() and the caret reset, which each scroll on their
    // own a frame or two after this starts.
    if (container.scrollHeight - container.clientHeight >= offset) {
      if (container.scrollTop !== offset) container.scrollTop = offset;
      landed = landed || container.scrollTop === offset;
    }
    if (++frames >= MAX_RESTORE_FRAMES) return finish(true);
    requestAnimationFrame(step);
  };
  step();
}

/**
 * Stand down: something else is deliberately taking this viewport (a heading
 * fragment jump). Safe to call when no restore is running.
 */
export function cancelEditorScrollRestore(): void {
  activeRestore?.();
}
