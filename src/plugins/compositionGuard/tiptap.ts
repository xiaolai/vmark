/**
 * Composition Guard Tiptap Extension
 *
 * Purpose: Protects IME (Input Method Editor) composition from interference by other
 * plugins, and fixes Safari-specific composition bugs in table header cells.
 *
 * Key decisions:
 *   - High priority (1200) to intercept events before other plugins process them
 *   - Tracks composition state (start position, data) to correctly handle composition end
 *   - filterTransaction allows doc-changing transactions during composition because
 *     ProseMirror may omit "composition" meta when storedMarks are present (#66)
 *   - Safari fix: ProseMirror's fixUpBadSafariComposition displaces cursor in table headers;
 *     this plugin uses appendTransaction to restore correct cursor position
 *   - Split-block fix: macOS WebKit can split headings during IME composition acceptance;
 *     appendTransaction detects the structural split (heading gains a new paragraph sibling),
 *     and the rAF cleanup repairs it once the composed text has been inserted
 *   - Grace period after compositionend prevents race conditions with queued actions
 *   - Flushes queued ProseMirror actions after composition ends
 *
 * Known limitations:
 *   - Safari table header fix uses heuristic position detection, may not cover all edge cases
 *
 * @coordinates-with utils/imeGuard.ts — IME state tracking and action queuing utilities
 * @coordinates-with plugins/compositionGuard/splitBlockFix.ts — split-block repair for headings
 * @module plugins/compositionGuard/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  flushProseMirrorCompositionQueue,
  getImeCleanupPrefixLength,
  HANGUL_RE,
  IME_GRACE_PERIOD_MS,
  isImeKeyEvent,
  isProseMirrorInCompositionGrace,
  markProseMirrorCompositionEnd,
} from "@/utils/imeGuard";
import { splitBlock } from "@tiptap/pm/commands";
import { fixCompositionSplitBlock } from "./splitBlockFix";

/** Tiptap extension that guards against IME composition artifacts in ProseMirror. */
export const compositionGuardExtension = Extension.create({
  name: "compositionGuard",
  priority: 1200,
  addProseMirrorPlugins() {
    let isComposing = false;
    let compositionStartPos: number | null = null;
    let compositionData = "";
    let compositionPinyin = "";

    // Korean Hangul: Enter during composition confirms the syllable AND
    // requests a newline. Our handleKeyDown blocks Enter to prevent premature
    // block splitting, but that also swallows the newline intent. This flag
    // queues a deferred splitBlock after the grace period (Tiptap #4108).
    let pendingEnterAfterComposition = false;
    let pendingEnterTimer: ReturnType<typeof setTimeout> | null = null;

    // Set to true by appendTransaction when it detects a heading→paragraph
    // split during composition. The rAF cleanup checks this flag to know
    // it should attempt the split-block fix (by which time the browser has
    // inserted the composed text into the paragraph).
    let splitDetected = false;

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

      // Try split-block fix (paragraph now has composed text)
      const splitFix = fixCompositionSplitBlock(
        state, compositionStartPos, compositionData, compositionPinyin,
      );
      if (splitFix) {
        view.dispatch(splitFix);
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
          // 1. Split-block detection: during/after composition, watch for the
          //    heading being split into heading + paragraph. The browser does
          //    this ~4ms BEFORE compositionend fires, so we can't fix it here
          //    (the composed text isn't in the paragraph yet). We flag it so
          //    the rAF cleanup knows to attempt the fix.
          if ((isComposing || compositionStartPos !== null) &&
              _transactions.some((tr) => tr.docChanged) &&
              compositionStartPos !== null &&
              !splitDetected) {
            try {
              const $start = newState.doc.resolve(compositionStartPos);
              if ($start.parent.type.name === "heading" &&
                  _oldState.doc.childCount < newState.doc.childCount) {
                splitDetected = true;
              }
            } catch { /* stale pos */ }
          }

          // 2. Table header cursor fix (Safari-specific).
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

          // Allow doc-changing transactions during composition (#66),
          // EXCEPT heading splits — reject those so ProseMirror resets the
          // DOM and the composed text stays in the heading. The browser
          // incorrectly splits headings when accepting IME candidates;
          // by rejecting the transaction, we prevent the split entirely.
          if (tr.docChanged) {
            if (compositionStartPos !== null &&
                tr.before.childCount < tr.doc.childCount) {
              try {
                const $start = tr.before.resolve(compositionStartPos);
                if ($start.parent.type.name === "heading") {
                  // Verify a paragraph appeared immediately after the heading
                  const afterPos = $start.after($start.depth);
                  if (afterPos < tr.doc.content.size) {
                    const $after = tr.doc.resolve(afterPos);
                    if ($after.nodeAfter?.type.name === "paragraph") {
                      return false; // Reject the heading→paragraph split
                    }
                  }
                }
              } catch { /* stale pos — allow */ }
            }
            return true;
          }

          return false;
        },
        props: {
          handleKeyDown(view, event) {
            const imeKey = isImeKeyEvent(event);
            const grace = isProseMirrorInCompositionGrace(view);
            if (imeKey || grace) {
              // Korean Hangul: Enter during composition confirms the syllable
              // AND requests a newline. We block it to prevent premature block
              // splitting, but queue a deferred split for after the grace
              // period so the newline intent is not lost (Tiptap #4108).
              if (
                event.key === "Enter" &&
                (isComposing || grace) &&
                compositionData &&
                HANGUL_RE.test(compositionData)
              ) {
                pendingEnterAfterComposition = true;
              }
              return true;
            }
            return false;
          },
          handleDOMEvents: {
            compositionstart(view) {
              isComposing = true;
              compositionData = "";
              compositionPinyin = "";
              splitDetected = false;
              pendingEnterAfterComposition = false;
              if (pendingEnterTimer) {
                clearTimeout(pendingEnterTimer);
                pendingEnterTimer = null;
              }

              // Multi-block selection fix (Tiptap #5416): if the selection
              // spans multiple blocks, pre-delete it so the composition
              // starts in a clean single block. Without this, ProseMirror
              // only deletes the first block, leaving orphaned content.
              const { from, to } = view.state.selection;
              if (typeof to === "number" && from !== to) {
                try {
                  const $from = view.state.doc.resolve(from);
                  const $to = view.state.doc.resolve(to);
                  if ($from.parent !== $to.parent) {
                    view.dispatch(view.state.tr.deleteSelection());
                  }
                } catch { /* pos out of range — skip pre-deletion */ }
              }
              compositionStartPos = view.state.selection.from;

              return false;
            },
            compositionupdate(_view, event) {
              const data = (event as CompositionEvent).data;
              compositionData = data ?? compositionData;
              return false;
            },
            compositionend(view, event) {
              isComposing = false;
              markProseMirrorCompositionEnd(view);
              const data = (event as CompositionEvent).data;
              compositionPinyin = compositionData;
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

              // Snapshot state before scheduling rAF — a new composition
              // session could start before the callback fires, corrupting
              // the mutable closure variables.
              const snapshotData = compositionData;
              const snapshotStartPos = compositionStartPos;
              const snapshotPinyin = compositionPinyin;
              const snapshotSplit = splitDetected;

              // Schedule cleanup via rAF as fallback for non-heading cases.
              // The filterTransaction prevention handles heading splits
              // synchronously, but normal pinyin cleanup still needs rAF.
              requestAnimationFrame(() => {
                // Stale callback — a new composition started before this fired
                if (compositionStartPos !== snapshotStartPos) return;

                /* v8 ignore start -- @preserve reason: IME composition split fallback; requires real ProseMirror + IME interaction not reproducible in unit tests */
                if (snapshotSplit) {
                  // Heading was split but filterTransaction didn't prevent it
                  // (shouldn't happen, but defensive fallback)
                  splitDetected = false;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (view as any).domObserver?.flush?.();
                  const { state } = view;
                  if (snapshotData && snapshotStartPos !== null) {
                    const fix = fixCompositionSplitBlock(
                      state, snapshotStartPos, snapshotData, snapshotPinyin,
                    );
                    if (fix) {
                      view.dispatch(fix);
                      flushProseMirrorCompositionQueue(view);
                      return;
                    }
                  }
                }
                /* v8 ignore stop */
                // Normal pinyin cleanup
                scheduleImeCleanup(view);
                flushProseMirrorCompositionQueue(view);

                // Korean Hangul deferred Enter: dispatch splitBlock after
                // cleanup so the committed character is in place (Tiptap #4108).
                if (pendingEnterAfterComposition) {
                  pendingEnterAfterComposition = false;
                  if (pendingEnterTimer) clearTimeout(pendingEnterTimer);
                  pendingEnterTimer = setTimeout(() => {
                    pendingEnterTimer = null;
                    // Guard: if a new composition started, don't split
                    if (!isComposing) {
                      splitBlock(view.state, view.dispatch);
                    }
                  }, IME_GRACE_PERIOD_MS);
                }
              });

              return false;
            },
            blur(view) {
              // Always cancel deferred Enter on blur — even if composition
              // already ended via compositionend (isComposing is false),
              // the timer may still be pending.
              pendingEnterAfterComposition = false;
              if (pendingEnterTimer) {
                clearTimeout(pendingEnterTimer);
                pendingEnterTimer = null;
              }
              if (!isComposing) return false;
              isComposing = false;
              compositionStartPos = null;
              compositionData = "";
              compositionPinyin = "";
              splitDetected = false;
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
