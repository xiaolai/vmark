/**
 * IME-Safe Toast
 *
 * Purpose: Wraps sonner's toast API to defer notifications when the editor is
 * in an IME composition session. Without this, DOM insertion by sonner can
 * interrupt CJK input and cause the composition to commit prematurely.
 *
 * Also adds opt-in `{ pin: true }` support — long-form toasts get a pin
 * button that, when clicked, replaces the toast with an infinite-duration
 * version so the user can read the message at their own pace.
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
 *   - Pin support is opt-in per call site — keeps existing call-site/test
 *     signatures stable; only sites that pass `{ pin: true }` get the action
 *
 * @coordinates-with utils/imeGuard.ts — shares the composition detection approach
 * @coordinates-with utils/imeToastPinAction.tsx — builds the pin action JSX
 * @coordinates-with stores/activeEditorStore.ts — reads active editor instances
 * @module utils/imeToast
 */

import { toast } from "sonner";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { buildPinAction } from "./imeToastPinAction";

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

/**
 * Extended toast options — adds opt-in `pin` flag.
 * When `pin: true` and no `action` is supplied by the caller, we inject a
 * Pin action that re-fires the toast with `duration: Infinity`. If the
 * caller already provides an `action` (e.g. Undo on tab move), we respect
 * it — pin is skipped because we never display two action buttons.
 */
export type PinnableToastOpts = NonNullable<Parameters<typeof toast.info>[1]> & {
  pin?: boolean;
};

/** Args accepted by imeToast emit methods (message + optional pinnable options). */
type ToastArgs = [Parameters<typeof toast.info>[0], PinnableToastOpts?];

/** Args accepted by sonner internally (message + sonner-native options). */
type SonnerArgs = Parameters<typeof toast.info>;

type ToastFn = (...args: SonnerArgs) => string | number;

/**
 * Strip our custom `pin` field, optionally inject a Pin action, and return
 * sonner-compatible args. Caller invokes sonner with the result.
 */
function applyPin(fn: ToastFn, args: ToastArgs): SonnerArgs {
  const [message, rawOpts] = args;
  // No options at all → pass through with just the message so existing
  // tests that assert toHaveBeenCalledWith("msg") (single arg) keep matching.
  if (rawOpts === undefined) return [message] as SonnerArgs;
  const opts = rawOpts as PinnableToastOpts;
  if (!opts.pin) return [message, opts] as SonnerArgs;

  // `pin` is consumed here — never forwarded to sonner.
  const { pin: _pin, ...passthrough } = opts;

  // Existing user-supplied action wins; we never replace it. The user gets
  // their action button (Undo, etc.) without a pin — usually short-lived
  // toasts that need pin less anyway.
  if (passthrough.action) {
    return [message, passthrough] as SonnerArgs;
  }

  // Stable id so the pin click can replace this exact toast in place.
  // Respect a user-supplied id if present — and preserve its type (sonner
  // treats string/number ids as distinct namespaces; coercing would create
  // a new toast on pin click instead of replacing the original).
  const id =
    passthrough.id ?? `pinnable-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const action = buildPinAction(fn, message, passthrough, id);
  return [message, { ...passthrough, id, action }] as SonnerArgs;
}

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
 *
 * All emit-style methods (info/success/message/error/warning) accept an
 * optional `{ pin: true }` flag in their second arg. When set, a pin
 * button is added; clicking it re-fires the toast with `duration: Infinity`
 * so the user can read it at their own pace before manually closing.
 */
export const imeToast = {
  info: (...args: ToastArgs) => deferIfComposing(toast.info, applyPin(toast.info as ToastFn, args)),
  success: (...args: ToastArgs) =>
    deferIfComposing(toast.success, applyPin(toast.success as ToastFn, args)),
  message: (...args: Parameters<typeof toast.message>) => {
    const piped = applyPin(toast.message as unknown as ToastFn, args as ToastArgs);
    deferIfComposing(toast.message as (...a: ToastArgs) => void, piped);
  },
  error: (...args: ToastArgs) => {
    const piped = applyPin(toast.error as ToastFn, args);
    return toast.error(...piped);
  },
  warning: (...args: ToastArgs) => {
    const piped = applyPin(toast.warning as ToastFn, args);
    return toast.warning(...piped);
  },
  loading: toast.loading,
  dismiss: toast.dismiss,
};
