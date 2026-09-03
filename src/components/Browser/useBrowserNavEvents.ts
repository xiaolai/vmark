/**
 * useBrowserNavEvents — per-tab React adapter over the window-level native event
 * subscription in `services/browser/browserNavEvents` (WI-1.7). Kept for components
 * that care about one tab; the types and the subscription are re-exported so
 * existing importers keep their path.
 *
 * @coordinates-with services/browser/browserNavEvents — the decoder + subscription
 * @module components/Browser/useBrowserNavEvents
 */
import { useLayoutEffect, useEffect, useRef } from "react";
import {
  subscribeBrowserNavEvents,
  type BrowserNavHandlers,
} from "@/services/browser/browserNavEvents";

export { subscribeBrowserNavEvents, type BrowserNavHandlers } from "@/services/browser/browserNavEvents";

/** Per-tab hook: the window-level subscription filtered to one `tabId`. */
export function useBrowserNavEvents(tabId: string, handlers: BrowserNavHandlers): void {
  const handlersRef = useRef(handlers);
  // Layout effect, not a passive one: a native event can arrive between commit
  // and a passive effect, and would then hit the previous render's handlers.
  // (Writing the ref during render is what React 19 forbids — this is after commit.)
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const only = <A extends unknown[]>(fn: ((...a: A) => void) | undefined) =>
      fn ? (id: string, ...a: A) => (id === tabId ? fn(...a) : undefined) : undefined;
    return subscribeBrowserNavEvents(() => {
      const h = handlersRef.current;
      return {
        onNavigated: only(h.onNavigated),
        onLoaded: only(h.onLoaded),
        onHistoryChanged: only(h.onHistoryChanged),
        onFailed: only(h.onFailed),
        onCrashed: only(h.onCrashed),
        onDialog: only(h.onDialog),
        onPopupBlocked: only(h.onPopupBlocked),
      };
    });
  }, [tabId]);
}
