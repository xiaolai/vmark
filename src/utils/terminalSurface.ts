/**
 * Terminal surface — the ONE definition of "focus is inside the terminal".
 *
 * Purpose: two layers ask this question and neither owns the other — the
 * keybinding scope resolver (`services/keybinding/bindingContext.ts`, which
 * turns it into the `terminal` scope) and the editor⇄terminal focus toggle
 * (`services/terminal/terminalFocus.ts`). A second copy of the selector is the
 * drift where one stops matching while the other keeps working, with nothing
 * to notice: xterm renames a class, the scope resolver goes blind, and every
 * terminal-scoped binding silently starts behaving like a window binding.
 *
 * Leaf-pure (ADR-013): DOM reads only — no stores, no Tauri.
 *
 * @coordinates-with services/keybinding/bindingContext.ts — the `terminal` scope
 * @coordinates-with services/terminal/terminalFocus.ts — the focus toggle
 * @module utils/terminalSurface
 */

/** Every element xterm.js and the panel can put the caret inside. */
export const TERMINAL_SURFACE_SELECTOR = ".xterm, .terminal-container";

/** Whether `el` sits inside a terminal surface. */
export function isTerminalSurface(el: Element | null | undefined): boolean {
  return el?.closest?.(TERMINAL_SURFACE_SELECTOR) != null;
}

/** Whether the document's focus is currently inside the terminal. */
export function terminalHasFocus(): boolean {
  if (typeof document === "undefined") return false;
  return isTerminalSurface(document.activeElement);
}
