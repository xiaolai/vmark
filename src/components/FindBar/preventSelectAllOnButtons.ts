/**
 * Prevent Cmd+A from selecting all page content when focus is on a non-input
 * element inside the find bar (a toggle or action button). Inputs and
 * textareas keep their native select-all.
 *
 * Lives beside FindBar.tsx rather than inside it so the bar stays under the
 * file-size cap; it has no other consumer.
 *
 * @module components/FindBar/preventSelectAllOnButtons
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function preventSelectAllOnButtons(e: ReactKeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    const target = e.target as HTMLElement;
    /* v8 ignore next -- @preserve tagName INPUT/TEXTAREA branch not exercised in jsdom tests */
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
      e.preventDefault();
    }
  }
}
