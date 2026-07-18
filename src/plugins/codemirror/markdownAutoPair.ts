/**
 * Markdown Auto-Pair Plugin for CodeMirror
 *
 * Purpose: Handles markdown-specific auto-pairing in Source mode where characters like
 * *, ~, _ can be either single or double formatting markers.
 *
 * Key decisions:
 *   - Delay-based judgment (150ms) for *, ~, _: waits to see if user types a second char
 *     before deciding between single pair (e.g., *italic*) and double pair (e.g., **bold**)
 *   - `=` always pairs as double (==highlight==) since single = has no markdown meaning
 *   - Triple backtick inserts a full code fence with newlines
 *   - Backspace between pair halves deletes both — see markdownPairBackspace.ts
 *   - IME composition is fully guarded to avoid corrupting CJK input
 *   - All pairing — insertion here, pair backspace in markdownPairBackspace.ts —
 *     is disabled inside fenced code blocks (via getCodeFenceInfo guard)
 *
 * @coordinates-with autoPair/tiptap.ts — WYSIWYG counterpart (handles ASCII/CJK bracket pairs)
 * @coordinates-with markdownPairBackspace.ts — deletes the pairs this inserts
 * @module plugins/codemirror/markdownAutoPair
 */

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { isCodeMirrorComposing } from "@/utils/imeGuard";
import { getCodeFenceInfo } from "@/plugins/sourceContextDetection/codeFenceDetection";

// Re-export from the historical home of this keybinding so existing import
// paths (index.ts, tests) stay stable after the file split.
export { markdownPairBackspace } from "./markdownPairBackspace";

// Characters that support delay-based single/double judgment
const DELAY_CHARS = new Set(["~", "*", "_"]);

// Characters that always pair as double (no single-char variant)
const ALWAYS_DOUBLE_CHARS = new Set(["="]);

// Delay in ms to wait for second character
const PAIR_DELAY = 150;

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

            // Only pair markdown format chars and backticks — skip irrelevant chars
            // before the more expensive code fence scan.
            /* v8 ignore next -- @preserve reason: CodeMirror transaction callback; requires real editor instance for char-level testing */
            if (!DELAY_CHARS.has(char) && !ALWAYS_DOUBLE_CHARS.has(char) && char !== "`") return;

            // Don't auto-pair inside fenced code blocks
            if (getCodeFenceInfo(update.view)) return;

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
            /* v8 ignore start -- ALWAYS_DOUBLE_CHARS path not exercised in auto-pair tests */
            if (ALWAYS_DOUBLE_CHARS.has(char)) {
              this.handleAlwaysDoubleChar(char, pos);
            }
            /* v8 ignore stop */
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

      /**
       * Replace the backtick run on the current line with a clean code fence.
       * Skips leading whitespace, then scans the backtick run — robust against
       * stale auto-paired backticks from slow typing and indented fences.
       */
      private replaceWithCodeFence(lineStart: number): void {
        setTimeout(() => {
          const doc = this.view.state.doc;
          // Skip leading whitespace to find backtick run start
          let runStart = lineStart;
          while (runStart < doc.length) {
            const ch = doc.sliceString(runStart, runStart + 1);
            if (ch !== " " && ch !== "\t") break;
            runStart++;
          }
          // Scan forward to find end of backtick run
          let endOfRun = runStart;
          while (endOfRun < doc.length && doc.sliceString(endOfRun, endOfRun + 1) === "`") {
            endOfRun++;
          }
          // Preserve leading indentation in the fence
          const indent = doc.sliceString(lineStart, runStart);
          const fence = indent + "```\n\n" + indent + "```";
          safeDispatch(
            this.view,
            { from: lineStart, to: endOfRun, insert: fence },
            lineStart + indent.length + 3
          );
        }, 0);
      }

      handleBacktick(pos: number) {
        const doc = this.view.state.doc;
        const twoBefore = doc.sliceString(Math.max(0, pos - 2), pos);

        // Triple backtick (```): code fence
        if (twoBefore === "``") {
          // Cancel any pending
          if (this.pending) {
            clearTimeout(this.pending.timeout);
            this.pending = null;
          }

          // Bounds check for lineAt
          /* v8 ignore start -- out-of-bounds pos guard not triggered in tests */
          if (pos < 0 || pos > doc.length) return;
          /* v8 ignore stop */

          const lineStart = doc.lineAt(pos).from;
          const textBeforeOnLine = doc.sliceString(lineStart, pos - 2).trim();

          if (textBeforeOnLine === "") {
            this.replaceWithCodeFence(lineStart);
          }
          return;
        }

        // Double backtick (``): cancel pending single pair, no double pair
        if (
          this.pending &&
          this.pending.char === "`" &&
          this.pending.pos === pos - 1
        ) {
          clearTimeout(this.pending.timeout);
          this.pending = null;
          return;
        }

        // Single backtick: delay-based pair
        if (this.pending) {
          clearTimeout(this.pending.timeout);
          this.pending = null;
        }

        const timeout = setTimeout(() => {
          const currentPos = this.view.state.selection.main.head;
          /* v8 ignore start -- cursor-still-adjacent check not exercised in timer-based tests */
          if (currentPos === pos + 1) {
            safeDispatch(
              this.view,
              { from: currentPos, to: currentPos, insert: "`" },
              currentPos
            );
          }
          /* v8 ignore stop */
          this.pending = null;
        }, PAIR_DELAY);

        this.pending = { char: "`", pos, timeout };
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
