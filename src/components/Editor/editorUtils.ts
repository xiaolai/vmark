/**
 * Editor Utility Functions
 *
 * Helper functions for editor focus management and cursor restoration.
 */

import { Editor as MilkdownEditor, editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import { restoreCursorInProseMirror } from "@/utils/cursorSync/prosemirror";
import type { CursorInfo } from "@/stores/editorStore";

// Timing constants for focus behavior
export const FOCUS_DELAY_MS = 50;
export const BLUR_REFOCUS_DELAY_MS = 10;

/**
 * Helper to wait for editor ready, then execute action with optional delay.
 * Returns a cancellable handle.
 */
export function whenEditorReady(
  getEditor: () => MilkdownEditor | undefined,
  action: (editor: MilkdownEditor) => void,
  options: { pollMs?: number; delayMs?: number } = {}
): { cancel: () => void } {
  const { pollMs = FOCUS_DELAY_MS, delayMs = 0 } = options;
  let cancelled = false;
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let actionTimeout: ReturnType<typeof setTimeout> | undefined;

  const tryExecute = () => {
    const editor = getEditor();
    if (!editor) return false;

    // Editor ready - execute action (with optional delay)
    if (delayMs > 0) {
      actionTimeout = setTimeout(() => {
        if (!cancelled) action(editor);
      }, delayMs);
    } else {
      action(editor);
    }
    return true;
  };

  // Try immediately, then poll if not ready
  if (!tryExecute()) {
    pollInterval = setInterval(() => {
      if (cancelled || tryExecute()) {
        if (pollInterval) clearInterval(pollInterval);
      }
    }, pollMs);
  }

  return {
    cancel: () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (actionTimeout) clearTimeout(actionTimeout);
    },
  };
}

/**
 * Focus editor and restore cursor position.
 */
export function focusEditorWithCursor(
  editor: MilkdownEditor,
  getCursorInfo: () => CursorInfo | null
) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.focus();

    const cursorInfo = getCursorInfo();
    if (cursorInfo) {
      restoreCursorInProseMirror(view, cursorInfo);
    } else {
      // Default to start of document
      const { state } = view;
      const selection = Selection.atStart(state.doc);
      view.dispatch(state.tr.setSelection(selection).scrollIntoView());
    }
  });
}

/**
 * Check if focus is on an interactive element that should not trigger editor refocus.
 */
export function isInteractiveElementFocused(): boolean {
  const activeElement = document.activeElement;
  return !!(
    activeElement?.tagName === "INPUT" ||
    activeElement?.tagName === "TEXTAREA" ||
    activeElement?.tagName === "SELECT" ||
    activeElement?.tagName === "BUTTON" ||
    activeElement?.closest("[role='dialog']") ||
    activeElement?.closest("[role='menu']") ||
    activeElement?.closest(".find-bar")
  );
}
