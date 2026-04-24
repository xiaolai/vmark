/**
 * useDismissOnOutsideOrEscape
 *
 * Purpose: Centralised "click outside / press Escape to close" behaviour for
 * floating menus and popovers. Three context-menu components had the same
 * inline pattern with subtle differences (gating vs ungating, dep arrays);
 * consolidating prevents future drift.
 *
 * Key decisions:
 *   - Uses capture-phase mousedown so the dismiss fires before child handlers
 *     that might `stopPropagation`, matching the behaviour of the original
 *     three sites that all used `addEventListener(..., true)`.
 *   - Escape is filtered through `isImeKeyEvent` so IME-confirmation keystrokes
 *     don't accidentally close the popover.
 *   - The `enabled` flag is the single gate (was scattered across `if (!isOpen)
 *     return;` early-exits or unconditional effects in callers).
 *
 * @coordinates-with utils/imeGuard.ts — Escape filtering
 * @module hooks/useDismissOnOutsideOrEscape
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import { isImeKeyEvent } from "@/utils/imeGuard";

/**
 * When `enabled`, listens for capture-phase mousedown anywhere in the document
 * and Escape keydown. If the mousedown target is outside `ref.current`, or the
 * keydown is Escape (and not an IME confirmation), `onDismiss` is invoked.
 *
 * No listeners are attached when `enabled` is false, so the hook is safe to
 * call unconditionally and gate via the flag.
 */
export function useDismissOnOutsideOrEscape(
  enabled: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
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

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, ref, onDismiss]);
}
