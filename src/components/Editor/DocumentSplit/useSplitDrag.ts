/**
 * useSplitDrag — the pointer-drag half of a split divider (audit 20260907,
 * #277/#278/#279). Returns the `onPointerDown` handler; the caller owns the
 * keyboard half and the ARIA surface.
 *
 * Key decisions:
 *   - Pointer Events, not mouse events, so touch and pen resize the split
 *     too; only the primary BUTTON starts a drag, and the session then answers
 *     to the starting `pointerId` alone. Document listeners
 *     see every pointer, so without the id a second finger's move resized the
 *     bar the first one was holding, and its pointerup ended the drag (audit
 *     R2, #568). The pointer is captured where the engine supports it, so a
 *     fast drag past the bar keeps moving — and the capture is RELEASED by the
 *     same teardown that removes the listeners, since a blur-ended drag never
 *     reaches the pointerup that would have released it implicitly (#570).
 *   - The drag reports a FRACTION of the divider's parent width; clamping is
 *     the store's job (paneStore.setFraction), exactly as for the keyboard. A
 *     zero-width parent would make that fraction `Infinity` or `NaN`, which
 *     the store's `Math.max` propagates rather than clamps, so no session is
 *     installed for one (#567).
 *   - `onResize` is read from a ref at move time, never captured: the consumer
 *     passes an inline arrow, so its identity changes on the re-render every
 *     move causes and a captured one is stale from the second move onward
 *     (#569).
 *   - Cleanup follows useSidebarResize: the document listeners and the body
 *     cursor/user-select are torn down on pointerup, pointercancel, window
 *     blur (the user switched away mid-drag) AND unmount — closing the split
 *     mid-drag used to leak all of them and leave text selection disabled.
 *     Handlers live in a ref so the teardown removes the exact functions, and
 *     the body styles are restored only when this hook OWNS a session: an
 *     unmount with no drag in progress used to clear the cursor and
 *     user-select another resizer had set (#566).
 *
 * @coordinates-with ./SplitDivider.tsx — the only consumer
 * @coordinates-with src/hooks/useSidebarResize.ts — the cleanup discipline this mirrors
 * @module components/Editor/DocumentSplit/useSplitDrag
 */
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface DragSession {
  /** Undo everything `beginDragSession` did — listeners, body styles, capture. */
  stop: () => void;
}

/** The three document/window handlers a drag installs. */
interface DragHandlers {
  move: (e: PointerEvent) => void;
  end: (e: PointerEvent) => void;
  /** The window-blur teardown, held so the same function can be removed. */
  blur: () => void;
}

/**
 * Install everything a drag owns and return the teardown that undoes exactly
 * it: four listeners, the two body styles, and the pointer capture.
 *
 * Attach and detach are written ADJACENTLY on purpose (audit R3 #565). They
 * used to be two lists in two functions — one building the session, one
 * `cleanup` — so a fifth listener added to one and forgotten in the other
 * leaks for the lifetime of the window, and nothing about either function
 * would look wrong. Here the pair cannot be edited apart.
 *
 * Capture is an OPTIMISATION for a fast drag past the bar; the document
 * listeners carry the drag either way, so a refusal is swallowed. Releasing it
 * is not optional: a blur-ended drag never reaches the pointerup that would
 * have released it implicitly (#570).
 */
function beginDragSession(
  target: HTMLElement,
  pointerId: number,
  { move, end, blur }: DragHandlers,
): DragSession {
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  window.addEventListener("blur", blur);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  if (typeof target.setPointerCapture === "function") {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Capture is an optimisation; the document listeners carry the drag.
    }
  }

  return {
    stop: () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", blur);
      releaseCapture(target, pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
  };
}

export function useSplitDrag(onResize: (fraction: number) => void) {
  const sessionRef = useRef<DragSession | null>(null);
  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const cleanup = useCallback(() => {
    const session = sessionRef.current;
    // No session means this hook set none of it — clearing the body styles
    // would take away another resizer's (#566).
    if (!session) return;
    sessionRef.current = null;
    session.stop();
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      // Deliberately NOT gated on `e.isPrimary`: jsdom reports `false` for
      // every synthetic pointer event, so that guard refuses every drag under
      // test while buying only the second-finger-lands-on-the-4px-bar case in
      // a browser. Id ownership below is what the defect actually needed; a
      // later pointerdown simply takes the bar over, which is self-consistent.
      e.preventDefault();
      const container = e.currentTarget.parentElement;
      if (!container) return;
      // A pointerdown can arrive while a previous drag's listeners are still
      // attached (a pointerup delivered outside the window); never stack them.
      cleanup();
      const rect = container.getBoundingClientRect();
      // Every fraction below divides by this. Zero is not a narrow split, it
      // is a container that has not been laid out (#567).
      if (!(rect.width > 0)) return;
      const pointerId = e.pointerId;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        onResizeRef.current((ev.clientX - rect.left) / rect.width);
      };
      const end = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
      };
      const blur = () => cleanup();
      sessionRef.current = beginDragSession(e.currentTarget, pointerId, { move, end, blur });
    },
    [cleanup],
  );

  return { onPointerDown };
}

/** Give back a pointer capture the drag may still hold (blur ends no capture). */
function releaseCapture(target: HTMLElement, pointerId: number): void {
  if (typeof target.releasePointerCapture !== "function") return;
  if (typeof target.hasPointerCapture === "function" && !target.hasPointerCapture(pointerId)) return;
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // The engine released it with the pointerup; nothing left to give back.
  }
}
