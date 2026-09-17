/**
 * terminalFocus — moving the caret across the editor⇄terminal boundary.
 *
 * Purpose: nothing modelled this before. `term.focus()` lived in exactly one
 * place — `switchVisibility()`, reached only when the ACTIVE SESSION changes —
 * so the first open focused the terminal (a session is created) while every
 * later open of the same session did not, and the user had to click. In the
 * other direction the panel hides with `display: none`, which blurs the xterm
 * textarea and drops focus onto `<body>` with nothing to pick it up: the next
 * keystroke went nowhere.
 *
 * Primitives only — no policy about WHEN the panel should be shown. That is
 * `terminalGate.ts`, which composes these; keeping the dependency one-way is
 * what stops the pair becoming a cycle.
 *
 * Every function is a no-op without a DOM, so a headless caller (or a `node`
 * test tier) gets nothing rather than a throw.
 *
 * @coordinates-with services/terminal/terminalGate.ts — show/hide + focus policy
 * @coordinates-with components/Terminal/terminalSessionRegistry.ts — focuses on session switch
 * @module services/terminal/terminalFocus
 */

import { useUIStore } from "@/stores/uiStore";
import { focusEditorSurface } from "@/services/editor/clipboardBridge";
import { resolveClipboardSurface } from "@/services/commands/clipboardCommands";
import { getTerminalForSession } from "./activeTerminal";
import { isTerminalSurface } from "@/utils/terminalSurface";

/** Run after the pending commit has painted, or as soon as possible without one. */
function soon(run: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
    return;
  }
  queueMicrotask(run);
}

/**
 * Focus the live terminal for the active session. Returns whether it took —
 * `false` means there is no active session, or its xterm is not mounted yet.
 */
export function focusActiveTerminal(): boolean {
  const sessionId = useUIStore.getState().terminal.activeSessionId;
  if (!sessionId) return false;
  const term = getTerminalForSession(sessionId);
  if (!term) return false;
  term.focus();
  return true;
}

/**
 * Focus the active terminal on the next frame.
 *
 * Deferred because the caller has just flipped `terminalVisible`: the panel is
 * still `display: none` in this tick, and focusing a hidden element silently
 * does nothing.
 */
export function focusActiveTerminalSoon(): void {
  soon(() => {
    focusActiveTerminal();
  });
}

/** Focus the editing surface the user is looking at (Source or WYSIWYG). */
export function focusEditorNow(): void {
  if (typeof document === "undefined") return;
  focusEditorSurface(resolveClipboardSurface());
}

/**
 * Give focus back to the editor, but only if nothing real owns it.
 *
 * "Orphaned" is `<body>` (the panel hid the element holding the caret) or a
 * terminal surface that is no longer visible. The condition is the point:
 * closing the terminal must not yank the caret out of a sidebar filter or a
 * find bar the user is typing into.
 */
export function restoreEditorFocusIfOrphaned(): void {
  if (typeof document === "undefined") return;
  const el = document.activeElement;
  const orphaned = !el || el === document.body || isTerminalSurface(el);
  if (!orphaned) return;
  focusEditorNow();
}
