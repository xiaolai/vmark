/**
 * useDismissOnOutsideOrEscape
 *
 * Purpose: Centralised "click outside / press Escape to close" behaviour for
 * floating menus and popovers. Context-menu and spotlight-overlay components
 * had the same inline pattern with subtle differences (gating vs ungating,
 * capture vs bubble phase, deferred listener attach, Escape ownership);
 * consolidating prevents future drift.
 *
 * Key decisions:
 *   - Defaults to capture-phase mousedown so the dismiss fires before child
 *     handlers that might `stopPropagation`, matching the behaviour of the
 *     original context-menu sites that all used `addEventListener(..., true)`.
 *     Callers whose original code used bubble-phase mousedown pass
 *     `capture: false` to preserve identical semantics.
 *   - Escape is filtered through `isImeKeyEvent` so IME-confirmation keystrokes
 *     don't accidentally close the popover.
 *   - Escape handling is opt-out via `escape: false` for callers that own a
 *     richer Escape on their own element (mode state machines, Tab focus traps,
 *     `preventDefault`) and only need the outside-click half.
 *   - `deferActivation` attaches the outside-click listener on the next tick
 *     (`setTimeout(..., 0)`) so the same click that opened the popover doesn't
 *     immediately dismiss it. Replaces hand-rolled `setTimeout(0)` guards.
 *   - The `enabled` flag is the single gate (was scattered across `if (!isOpen)
 *     return;` early-exits or unconditional effects in callers).
 *
 * @coordinates-with utils/imeGuard.ts — Escape filtering
 * @module hooks/useDismissOnOutsideOrEscape
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import { isImeKeyEvent } from "@/utils/imeGuard";

export interface DismissOptions {
  /**
   * When true, the outside-click listener is attached on the next tick via
   * `setTimeout(..., 0)` instead of synchronously. Use this when the same
   * pointer event that opens the popover would otherwise be observed as an
   * "outside click" and dismiss it immediately. Default: false.
   */
  deferActivation?: boolean;
  /**
   * When false, Escape is not handled by the hook (the caller owns it on its
   * own element). The outside-click half still applies. Default: true.
   */
  escape?: boolean;
  /**
   * Mousedown listener phase. `true` = capture (fires before child handlers
   * that stop propagation), `false` = bubble. Default: true.
   */
  capture?: boolean;
}

/**
 * When `enabled`, listens for mousedown anywhere in the document and (unless
 * `escape: false`) Escape keydown. If the mousedown target is outside
 * `ref.current`, or the keydown is Escape (and not an IME confirmation),
 * `onDismiss` is invoked.
 *
 * No listeners are attached when `enabled` is false, so the hook is safe to
 * call unconditionally and gate via the flag.
 */
export function useDismissOnOutsideOrEscape(
  enabled: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options: DismissOptions = {},
): void {
  const { deferActivation = false, escape = true, capture = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleMouseDown = (event: MouseEvent) => {
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) {
        onDismiss();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeKeyEvent(event)) return;
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    let deferTimer: ReturnType<typeof setTimeout> | undefined;
    const attachMouseDown = () => {
      document.addEventListener("mousedown", handleMouseDown, capture);
    };

    if (deferActivation) {
      // Attach on the next tick so the opening click isn't seen as outside.
      deferTimer = setTimeout(attachMouseDown, 0);
    } else {
      attachMouseDown();
    }

    if (escape) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      if (deferTimer !== undefined) clearTimeout(deferTimer);
      document.removeEventListener("mousedown", handleMouseDown, capture);
      if (escape) {
        document.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [enabled, ref, onDismiss, deferActivation, escape, capture]);
}
