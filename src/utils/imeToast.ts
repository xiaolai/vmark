/**
 * IME-Safe Toast
 *
 * Purpose: Wraps sonner's toast API to defer notifications when the editor is
 * in an IME composition session. Without this, DOM insertion by sonner can
 * interrupt CJK input and cause the composition to commit prematurely.
 *
 * Key decisions:
 *   - Checks both WYSIWYG (Tiptap view.composing) and Source (CodeMirror
 *     view.composing) editors via activeEditorStore
 *   - When composing, queues the toast and flushes on the next
 *     `compositionend` event (event-driven, not fixed delay)
 *   - Falls through to immediate toast when no editor is composing
 *   - Only info/success/message are deferred — error/warning/loading/dismiss
 *     pass through immediately (urgent or carry a return id callers depend on)
 *   - Re-checks composition state before flushing — if a new composition
 *     started quickly, re-defers instead of interrupting
 *   - Fallback timeout (5s) prevents indefinite queuing if compositionend
 *     never fires (e.g. editor unmounted during composition)
 *
 * @coordinates-with utils/imeGuard.ts — shares the composition detection approach
 * @coordinates-with stores/activeEditorStore.ts — reads active editor instances
 * @module utils/imeToast
 */

import { toast } from "sonner";
import { useActiveEditorStore } from "@/stores/activeEditorStore";

/** Small delay after compositionend before flushing (ms).
 * Matches IME_GRACE_PERIOD_MS — lets the browser finish processing. */
const POST_COMPOSITION_DELAY_MS = 60;

/** Maximum time to keep toasts queued before force-flushing (ms).
 * Prevents indefinite queuing if compositionend never fires. */
const FALLBACK_FLUSH_TIMEOUT_MS = 5000;

function isEditorComposing(): boolean {
  const { activeWysiwygEditor, activeSourceView } = useActiveEditorStore.getState();

  if (activeWysiwygEditor?.view?.composing) return true;
  if (activeSourceView?.composing) return true;

  return false;
}

type ToastArgs = Parameters<typeof toast.info>;

/** Pending toasts queued during composition */
const pendingToasts: Array<{ fn: (...args: ToastArgs) => void; args: ToastArgs }> = [];
let compositionEndListenerAttached = false;
let fallbackTimerId: ReturnType<typeof setTimeout> | null = null;

function clearFallbackTimer(): void {
  /* v8 ignore start -- fallbackTimerId is null when no timer is pending; else branch is a no-op guard */
  if (fallbackTimerId !== null) {
    clearTimeout(fallbackTimerId);
    fallbackTimerId = null;
  }
  /* v8 ignore stop */
}

function flushPendingToasts(): void {
  // Re-check: if a new composition started quickly, re-defer
  if (isEditorComposing()) {
    // Re-attach listener for the new composition session
    /* v8 ignore start -- listener is always un-attached when re-entering flushPendingToasts; else is defensive */
    if (!compositionEndListenerAttached) {
      compositionEndListenerAttached = true;
      document.addEventListener("compositionend", onCompositionEnd, { once: true });
    }
    /* v8 ignore stop */
    return;
  }

  compositionEndListenerAttached = false;
  clearFallbackTimer();
  const toasts = pendingToasts.splice(0);
  for (const { fn, args } of toasts) {
    fn(...args);
  }
}

function onCompositionEnd(): void {
  document.removeEventListener("compositionend", onCompositionEnd);
  // Mark listener as consumed so re-defer can re-attach if needed
  compositionEndListenerAttached = false;
  // Small delay to let the browser finish IME processing before inserting toast DOM
  setTimeout(flushPendingToasts, POST_COMPOSITION_DELAY_MS);
}

function deferIfComposing(fn: (...args: ToastArgs) => void, args: ToastArgs): void {
  if (!isEditorComposing()) {
    fn(...args);
    return;
  }

  pendingToasts.push({ fn, args });

  if (!compositionEndListenerAttached) {
    compositionEndListenerAttached = true;
    document.addEventListener("compositionend", onCompositionEnd, { once: true });
  }

  // Fallback: force flush after timeout if compositionend never fires
  if (fallbackTimerId === null) {
    fallbackTimerId = setTimeout(() => {
      fallbackTimerId = null;
      compositionEndListenerAttached = false;
      document.removeEventListener("compositionend", onCompositionEnd);
      const toasts = pendingToasts.splice(0);
      for (const { fn, args } of toasts) {
        fn(...args);
      }
    }, FALLBACK_FLUSH_TIMEOUT_MS);
  }
}

/**
 * IME-safe toast — defers info/success/message when the editor is composing.
 * Error/warning are urgent (always immediate).
 * Loading/dismiss return values or take ids — must be synchronous, so they
 * also pass through. (Loading toasts during composition is an edge case;
 * deferring them would mean the user sees no spinner while their op runs.)
 */
export const imeToast = {
  info: (...args: ToastArgs) => deferIfComposing(toast.info, args),
  success: (...args: ToastArgs) => deferIfComposing(toast.success, args),
  message: (...args: Parameters<typeof toast.message>) =>
    deferIfComposing(toast.message as (...a: ToastArgs) => void, args as ToastArgs),
  error: toast.error,
  warning: toast.warning,
  loading: toast.loading,
  dismiss: toast.dismiss,
};
