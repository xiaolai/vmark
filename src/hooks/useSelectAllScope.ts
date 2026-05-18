/**
 * useSelectAllScope
 *
 * Purpose: Stops Cmd/Ctrl+A from triggering the browser's page-wide
 *   `document.execCommand("selectAll")` when focus is not inside a text
 *   input. The default selects every selectable element in the window,
 *   so pressing Cmd+A while focus is on the sidebar or status bar
 *   highlights the entire UI — extending across the editor, status bar,
 *   and sidebar at once.
 *
 *   When focus IS inside an editor (Tiptap, CodeMirror), terminal
 *   (xterm), or a normal input/textarea/contenteditable element, this
 *   hook stays out of the way — those owners handle Cmd+A themselves
 *   and scope the selection to their own content.
 *
 *   The listener runs in the capture phase so it observes the keydown
 *   before bubble-phase handlers and the browser default, but it never
 *   stops propagation — it only suppresses the page-wide selection
 *   when the event would otherwise produce one.
 *
 * @module hooks/useSelectAllScope
 */

import { useEffect } from "react";

/** Returns true if `el` (or any ancestor) is an interactive text owner. */
export function isTextEditableContext(el: Element | null): boolean {
  if (!el) return false;

  // Inputs and textareas already scope their own select-all.
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return true;
  }

  // contentEditable host (Tiptap's prose-mirror surface lives here).
  if (el instanceof HTMLElement && el.isContentEditable) {
    return true;
  }

  // CodeMirror's content node — focus lands on `.cm-content` (which is
  // contentEditable), so the contentEditable check above usually catches it.
  // The closest() check below also covers older configurations.
  if (el.closest("[contenteditable='true'], [contenteditable='plaintext-only']")) {
    return true;
  }

  // CodeMirror Source mode editor.
  if (el.closest(".cm-editor")) return true;

  // xterm-rendered terminal viewport.
  if (el.closest(".xterm")) return true;

  return false;
}

/**
 * Install a window-level keydown listener that prevents the browser's
 * page-wide select-all when Cmd/Ctrl+A fires outside any text owner.
 *
 * Effect is mount-once (no deps); the listener is cheap (one quick string
 * comparison + a couple of closest() lookups) and runs only for Cmd/Ctrl+A.
 */
export function useSelectAllScope(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Cmd/Ctrl+A only, no extra modifiers.
      if (event.key !== "a" && event.key !== "A") return;
      const hasModKey = event.metaKey || event.ctrlKey;
      if (!hasModKey) return;
      if (event.shiftKey || event.altKey) return;
      if (event.defaultPrevented) return;

      // If a text owner (editor, terminal, input, contentEditable) is
      // focused, let that owner handle Cmd+A. Their handlers run on the
      // way up and scope the selection correctly.
      const target = event.target as Element | null;
      if (isTextEditableContext(target)) return;

      // No text owner is involved — the browser would otherwise run its
      // page-wide select-all and highlight the entire UI. Suppress it.
      event.preventDefault();
    }

    // Capture phase so we observe the event before any descendant
    // handler can stop propagation; we deliberately do NOT stop
    // propagation ourselves.
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);
}
