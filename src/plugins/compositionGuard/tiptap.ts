/**
 * Composition Guard Tiptap Extension
 *
 * Purpose: Protects IME (Input Method Editor) composition from interference by other
 * plugins, and fixes Safari-specific composition bugs in table header cells.
 *
 * Key decisions:
 *   - High priority (1200) to intercept events before other plugins process them
 *   - Tracks composition state (start position, data) to correctly handle composition end
 *   - Safari fix: ProseMirror's fixUpBadSafariComposition displaces cursor in table headers;
 *     this plugin uses appendTransaction to restore correct cursor position
 *   - Grace period after compositionend prevents race conditions with queued actions
 *   - Flushes queued ProseMirror actions after composition ends
 *
 * Known limitations:
 *   - Safari table header fix uses heuristic position detection, may not cover all edge cases
 *
 * @coordinates-with utils/imeGuard.ts — IME state tracking and action queuing utilities
 * @module plugins/compositionGuard/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  flushProseMirrorCompositionQueue,
  getImeCleanupPrefixLength,
  isImeKeyEvent,
  isProseMirrorInCompositionGrace,
  markProseMirrorCompositionEnd,
} from "@/utils/imeGuard";

export const compositionGuardExtension = Extension.create({
  name: "compositionGuard",
  priority: 1200,
  addProseMirrorPlugins() {
    let isComposing = false;
    let compositionStartPos: number | null = null;
    let compositionData = "";

    // Set after compositionend in a tableHeader cell.
    // appendTransaction consumes this to fix cursor position after
    // ProseMirror's fixUpBadSafariComposition displaces it.
    let pendingHeaderCursorFix: { data: string } | null = null;

    const findTableCellDepth = (view: EditorView, pos: number): number | null => {
      const { doc } = view.state;
      const $pos = doc.resolve(pos);
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth);
        if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
          return depth;
        }
      }
      return null;
    };

    const scheduleImeCleanup = (view: EditorView) => {
      if (!compositionData || compositionStartPos === null) return;

      const { state } = view;
      let $start;
      try {
        $start = state.doc.resolve(compositionStartPos);
      } catch {
        return;
      }

      let cleanupEnd = $start.end();
      let allowNewlines = false;

      // Table cells can contain multiple paragraphs, so use the
      // cell boundary and allow newlines in the cleanup range.
      // For every other block (paragraph, heading, code block,
      // list item, blockquote, etc.) $start.end() is correct.
      const tableDepth = findTableCellDepth(view, compositionStartPos);
      if (tableDepth !== null) {
        cleanupEnd = $start.end(tableDepth);
        allowNewlines = true;
      }

      if (compositionStartPos > cleanupEnd) return;

      const textBetween = state.doc.textBetween(compositionStartPos, cleanupEnd, "\n");
      const prefixLen = getImeCleanupPrefixLength(textBetween, compositionData, { allowNewlines });
      if (!prefixLen) return;

      const deleteFrom = compositionStartPos;
      const deleteTo = compositionStartPos + prefixLen;
      view.dispatch(state.tr.delete(deleteFrom, deleteTo).setMeta("uiEvent", "composition-cleanup"));
    };

    return [
      new Plugin({
        appendTransaction(_transactions, _oldState, newState) {
          if (!pendingHeaderCursorFix) return null;

          const { data } = pendingHeaderCursorFix;

          // Only consume on doc-changing transactions (the composition flush)
          if (!_transactions.some((tr) => tr.docChanged)) return null;
          pendingHeaderCursorFix = null;

          try {
            const { from } = newState.selection;
            const $from = newState.doc.resolve(from);

            // Only fix when cursor is at start of paragraph inside tableHeader
            if ($from.parentOffset !== 0) return null;
            if ($from.parent.type.name !== "paragraph") return null;

            let inTableHeader = false;
            for (let d = $from.depth; d > 0; d -= 1) {
              if ($from.node(d).type.name === "tableHeader") {
                inTableHeader = true;
                break;
              }
            }
            if (!inTableHeader) return null;

            // Verify text starts with composed data
            if (!$from.parent.textContent.startsWith(data)) return null;

            // Move cursor to after composed text
            const correctPos = Math.min(from + data.length, newState.doc.content.size);
            return newState.tr.setSelection(TextSelection.create(newState.doc, correctPos));
          } catch {
            return null;
          }
        },
        filterTransaction(tr) {
          if (!isComposing) return true;

          const compositionMeta = tr.getMeta("composition");
          const uiEvent = tr.getMeta("uiEvent");
          if (compositionMeta) return true;
          if (uiEvent === "input" || uiEvent === "composition") return true;

          // Allow undo/redo during composition - users should be able to undo mistakes
          // while still in IME input mode (especially important for CJK users)
          const historyMeta = tr.getMeta("history$");
          if (historyMeta) return true;

          return false;
        },
        props: {
          handleKeyDown(view, event) {
            if (isImeKeyEvent(event)) return true;
            if (isProseMirrorInCompositionGrace(view)) return true;
            return false;
          },
          handleDOMEvents: {
            compositionstart(view) {
              isComposing = true;
              compositionStartPos = view.state.selection.from;
              compositionData = "";
              return false;
            },
            compositionupdate(_view, event) {
              compositionData = (event as CompositionEvent).data ?? compositionData;
              return false;
            },
            compositionend(view, event) {
              isComposing = false;
              markProseMirrorCompositionEnd(view);
              const data = (event as CompositionEvent).data;
              if (typeof data === "string" && data.length > 0) {
                compositionData = data;
              }

              // Flag cursor fix for tableHeader cells (Safari moves
              // composed text to TR level, ProseMirror shoves it back
              // but collapses cursor to cell start).
              if (compositionStartPos !== null && compositionData) {
                const depth = findTableCellDepth(view, compositionStartPos);
                if (depth !== null) {
                  try {
                    const cellNode = view.state.doc.resolve(compositionStartPos).node(depth);
                    if (cellNode.type.name === "tableHeader") {
                      pendingHeaderCursorFix = { data: compositionData };
                    }
                  } catch { /* stale pos */ }
                }
              }

              requestAnimationFrame(() => {
                scheduleImeCleanup(view);
                flushProseMirrorCompositionQueue(view);
              });

              return false;
            },
            blur(view) {
              if (!isComposing) return false;
              isComposing = false;
              compositionStartPos = null;
              compositionData = "";
              markProseMirrorCompositionEnd(view);
              requestAnimationFrame(() => {
                flushProseMirrorCompositionQueue(view);
              });
              return false;
            },
          },
        },
      }),
    ];
  },
});
