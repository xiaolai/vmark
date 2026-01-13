/**
 * Markdown Auto-Pair Plugin for CodeMirror
 *
 * Handles special markdown pairing:
 * - ~, *, _: Delay-based judgment for single vs double (e.g., ~ vs ~~)
 * - =: Immediate double pairing (== only, no single = format)
 * - ```: Insert code fence with newlines
 *
 * Also handles backspace to delete both halves of a pair.
 */

import { EditorView, ViewPlugin, ViewUpdate, KeyBinding } from "@codemirror/view";
import { guardCodeMirrorKeyBinding, isCodeMirrorComposing } from "@/utils/imeGuard";

// Characters that support delay-based single/double judgment
const DELAY_CHARS = new Set(["~", "*", "_"]);

// Characters that always pair as double (no single-char variant)
const ALWAYS_DOUBLE_CHARS = new Set(["="]);

// Delay in ms to wait for second character
const PAIR_DELAY = 150;

// Pairs for backspace deletion (char -> same char for symmetric pairs)
const SYMMETRIC_PAIRS: Record<string, string> = {
  "~": "~",
  "*": "*",
  "_": "_",
  "=": "=",
  "^": "^",
};

interface PendingPair {
  char: string;
  pos: number;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Safely dispatch a transaction to the view.
 * Returns false if view is destroyed or dispatch fails.
 */
function safeDispatch(
  view: EditorView,
  changes: { from: number; to: number; insert: string },
  anchor: number
): boolean {
  try {
    // Check if view is still valid (not destroyed)
    if (!view.dom.isConnected) return false;
    if (isCodeMirrorComposing(view)) return false;

    view.dispatch({
      changes,
      selection: { anchor },
    });
    return true;
  } catch {
    // View may have been destroyed or state is invalid
    return false;
  }
}

/**
 * Backspace handler: delete both halves of symmetric pairs.
 * Works for both single (e.g., *|*) and double (e.g., ~~|~~) pairs.
 */
export const markdownPairBackspace: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Backspace",
  run: (view) => {
    const { state } = view;
    const { from, to } = state.selection.main;

    // Only handle when no selection
    if (from !== to) return false;
    if (from === 0) return false;

    const charBefore = state.doc.sliceString(from - 1, from);
    const charAfter = state.doc.sliceString(from, from + 1);

    // Check for double-char pairs first (~~, **, __, ==)
    if (from >= 2) {
      const twoBefore = state.doc.sliceString(from - 2, from);
      const twoAfter = state.doc.sliceString(from, from + 2);

      // Check if we're between double pairs like ~~|~~
      if (
        twoBefore.length === 2 &&
        twoBefore[0] === twoBefore[1] &&
        twoAfter === twoBefore &&
        SYMMETRIC_PAIRS[twoBefore[0]]
      ) {
        view.dispatch({
          changes: { from: from - 2, to: from + 2 },
          selection: { anchor: from - 2 },
        });
        return true;
      }
    }

    // Check for single-char pairs like *|*
    if (SYMMETRIC_PAIRS[charBefore] && charAfter === charBefore) {
      view.dispatch({
        changes: { from: from - 1, to: from + 1 },
        selection: { anchor: from - 1 },
      });
      return true;
    }

    return false; // Let default backspace handle it
  },
});

/**
 * Creates the markdown auto-pair plugin with delay-based judgment.
 */
export function createMarkdownAutoPairPlugin() {
  return ViewPlugin.fromClass(
    class {
      pending: PendingPair | null = null;

      constructor(private view: EditorView) {}

      update(update: ViewUpdate) {
        if (isCodeMirrorComposing(update.view)) return;
        // Check for user input transactions
        if (!update.docChanged) return;

        for (const tr of update.transactions) {
          if (!tr.isUserEvent("input.type")) continue;

          // Get the inserted text
          tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
            const text = inserted.toString();
            if (text.length !== 1) return;

            const char = text;
            const pos = fromB;

            // Handle triple backtick for code fence
            if (char === "`") {
              this.handleBacktick(pos);
              return;
            }

            // Handle delay-based chars (~, *, _)
            if (DELAY_CHARS.has(char)) {
              this.handleDelayChar(char, pos);
              return;
            }

            // Handle always-double chars (=) - immediate double pairing
            if (ALWAYS_DOUBLE_CHARS.has(char)) {
              this.handleAlwaysDoubleChar(char, pos);
            }
          });
        }
      }

      /**
       * Insert closing pair at current cursor position.
       * Used by multiple handlers to avoid duplication.
       */
      private insertClosingPair(closing: string): void {
        setTimeout(() => {
          const currentPos = this.view.state.selection.main.head;
          safeDispatch(
            this.view,
            { from: currentPos, to: currentPos, insert: closing },
            currentPos
          );
        }, 0);
      }

      handleBacktick(pos: number) {
        const doc = this.view.state.doc;
        const before = doc.sliceString(Math.max(0, pos - 2), pos);

        // Check if we just completed ``` (three backticks)
        if (before !== "``") return;

        // Bounds check for lineAt
        if (pos < 0 || pos > doc.length) return;

        const lineStart = doc.lineAt(pos).from;
        const textBeforeOnLine = doc.sliceString(lineStart, pos - 2).trim();

        if (textBeforeOnLine === "") {
          // Insert: cursor stays after ```, then \n\n```
          // Result: ```|cursor\n\n```
          this.insertClosingPair("\n\n```");
        }
      }

      handleAlwaysDoubleChar(char: string, pos: number) {
        const doc = this.view.state.doc;
        const charBefore = doc.sliceString(pos - 1, pos);

        // If this is the second char of a double (e.g., user typed == quickly)
        if (charBefore === char) {
          // User just completed ==, insert closing ==
          this.insertClosingPair(char + char);
        }
        // If this is the first =, do nothing - wait for second
      }

      handleDelayChar(char: string, pos: number) {
        // If we have a pending char of the same type at adjacent position
        if (
          this.pending &&
          this.pending.char === char &&
          this.pending.pos === pos - 1
        ) {
          // User typed double char quickly - cancel single pair, do double pair
          clearTimeout(this.pending.timeout);
          this.pending = null;

          // Insert double closing (e.g., ~~ -> ~~~~ with cursor in middle)
          this.insertClosingPair(char + char);
          return;
        }

        // Clear any existing pending
        if (this.pending) {
          clearTimeout(this.pending.timeout);
          this.pending = null;
        }

        // Set up new pending with delay
        const timeout = setTimeout(() => {
          // Timeout expired - user only typed single char, insert single closing
          const currentPos = this.view.state.selection.main.head;
          // Only insert if cursor is still at expected position
          if (currentPos === pos + 1) {
            safeDispatch(
              this.view,
              { from: currentPos, to: currentPos, insert: char },
              currentPos
            );
          }
          this.pending = null;
        }, PAIR_DELAY);

        this.pending = { char, pos, timeout };
      }

      destroy() {
        if (this.pending) {
          clearTimeout(this.pending.timeout);
        }
      }
    }
  );
}
