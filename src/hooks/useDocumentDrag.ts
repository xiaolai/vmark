/**
 * useDocumentDrag
 *
 * Purpose: the document-level half of a drag gesture — follow the pointer after
 * a press on some handle, and guarantee that everything the gesture installed
 * is removed when it ends, however it ends.
 *
 * Key decisions:
 *   - One session at a time, owned by a ref. Starting a drag while one is
 *     still attached (its release was delivered outside the window and never
 *     reached the document) ends the old one first, so listeners never stack.
 *   - Attach and detach are written adjacently in `attach()`, which returns the
 *     teardown for exactly what it installed. Two lists in two functions drift:
 *     a listener added to one and forgotten in the other leaks for the lifetime
 *     of the window with nothing looking wrong.
 *   - A drag ends on release, on pointer cancel, on window blur (the user
 *     switched away mid-drag and the release will never arrive) and on unmount.
 *     `onEnd` runs exactly once per session, AFTER the listeners are gone, and
 *     is told why — callers decide what a blur or an unmount should commit.
 *   - Body cursor and user-select are set only when the caller asks for a
 *     cursor, and restored only by the session that set them, so a hook with no
 *     drag in progress cannot clear another resizer's styles on unmount.
 *   - The returned controls are referentially stable, so they are safe in
 *     dependency arrays.
 *
 * @coordinates-with hooks/useSidebarResize.ts — sidebar edge drag
 * @coordinates-with components/Terminal/useTerminalResize.ts — terminal panel edge drag
 * @coordinates-with hooks/useTabDragOut.ts — tab reorder / drag-out (pointer events)
 * @module hooks/useDocumentDrag
 */
import { useEffect, useMemo, useRef } from "react";
import { allowBodyTextSelection, suppressBodyTextSelection } from "@/utils/bodyTextSelection";

/** Which DOM event family carries the drag. */
export type DocumentDragKind = "mouse" | "pointer";

/** The native event type a drag of kind `K` delivers. */
type DocumentDragEvent<K extends DocumentDragKind> = K extends "pointer"
  ? PointerEvent
  : MouseEvent;

/**
 * Why a drag ended.
 *   - release: the button/pointer went up (the only end that carries intent)
 *   - cancel: the engine cancelled the pointer, or the caller called `stop()`
 *   - blur: the window lost focus mid-drag
 *   - superseded: a new drag started while this one was still attached
 *   - unmount: the owning component unmounted mid-drag
 */
export type DocumentDragEndReason = "release" | "cancel" | "blur" | "superseded" | "unmount";

interface DocumentDragSession<K extends DocumentDragKind> {
  /** Called for every move while the drag is attached. */
  onMove: (event: DocumentDragEvent<K>) => void;
  /** Called exactly once, after the listeners are removed. `event` is the release or cancel event, when there is one. */
  onEnd?: (reason: DocumentDragEndReason, event: DocumentDragEvent<K> | null) => void;
  /** Body cursor for the duration of the drag; also disables text selection. */
  cursor?: string;
}

export interface DocumentDragControls<K extends DocumentDragKind> {
  /** Begin following the pointer. Ends any drag this hook still has attached. */
  start: (session: DocumentDragSession<K>) => void;
  /** End the current drag, if any, with reason "cancel". */
  stop: () => void;
  /** True while a drag is attached. */
  isActive: () => boolean;
}

const EVENT_NAMES = {
  mouse: { move: "mousemove", release: "mouseup", cancel: null },
  pointer: { move: "pointermove", release: "pointerup", cancel: "pointercancel" },
} as const;

type EndFn = (reason: DocumentDragEndReason, event: Event | null) => void;

/**
 * Install everything one drag owns and return the teardown for exactly it.
 * Attach and detach stay in this one function on purpose (see the header).
 */
function attach(
  kind: DocumentDragKind,
  onMove: (event: Event) => void,
  end: EndFn,
  cursor: string | undefined,
): () => void {
  const names = EVENT_NAMES[kind];
  const onRelease = (event: Event) => end("release", event);
  const onCancel = (event: Event) => end("cancel", event);
  const onBlur = () => end("blur", null);

  document.addEventListener(names.move, onMove);
  document.addEventListener(names.release, onRelease);
  if (names.cancel) document.addEventListener(names.cancel, onCancel);
  window.addEventListener("blur", onBlur);
  if (cursor !== undefined) {
    document.body.style.cursor = cursor;
    suppressBodyTextSelection();
  }

  return () => {
    document.removeEventListener(names.move, onMove);
    document.removeEventListener(names.release, onRelease);
    if (names.cancel) document.removeEventListener(names.cancel, onCancel);
    window.removeEventListener("blur", onBlur);
    if (cursor !== undefined) {
      document.body.style.cursor = "";
      allowBodyTextSelection();
    }
  };
}

/** Document-level drag tracking with guaranteed listener cleanup. */
export function useDocumentDrag<K extends DocumentDragKind = "mouse">(
  kind?: K,
): DocumentDragControls<K> {
  const eventKind: DocumentDragKind = kind ?? "mouse";
  const activeRef = useRef<{ end: EndFn } | null>(null);

  const controls = useMemo<DocumentDragControls<K>>(() => {
    const start = (session: DocumentDragSession<K>): void => {
      activeRef.current?.end("superseded", null);

      const end: EndFn = (reason, event) => {
        // Only the session that is still attached may end; a late event for a
        // session already torn down is a no-op, and `onEnd` may safely call
        // `stop()` or `start()` because the ref is cleared before it runs.
        if (activeRef.current !== active) return;
        activeRef.current = null;
        detach();
        session.onEnd?.(reason, event as DocumentDragEvent<K> | null);
      };
      const active = { end };
      const detach = attach(
        eventKind,
        (event) => session.onMove(event as DocumentDragEvent<K>),
        end,
        session.cursor,
      );
      activeRef.current = active;
    };

    return {
      start,
      stop: () => activeRef.current?.end("cancel", null),
      isActive: () => activeRef.current !== null,
    };
  }, [eventKind]);

  useEffect(() => () => activeRef.current?.end("unmount", null), []);

  return controls;
}
