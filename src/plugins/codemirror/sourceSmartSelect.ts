/**
 * Purpose: Source-mode smart select-all — Mod-A expands to the enclosing block
 * before the whole document, and Mod-Z steps that expansion back.
 *
 * Split from `sourceShortcuts.ts`, which is otherwise a flat table of
 * key-to-action bindings; this is the one entry with real state (a per-view
 * undo record) and real logic (block detection, expansion ordering). It is
 * also where two audit-found defects lived, both pinned by
 * `__tests__/smartSelectAll.test.ts`: expansion could run BACKWARDS on a third
 * press, and the undo lost a backward selection's direction.
 *
 * Key decisions:
 *   - Always returns true. Returning false hands the event to the browser,
 *     whose select-all highlights every selectable element in the window —
 *     including the sidebar — instead of staying inside the editor.
 *   - The whole-document check runs FIRST, before block detection. Placed
 *     after it, a document whose first block was detectable fell through both
 *     branches and shrank the selection back to that block.
 *   - The undo record stores anchor/head, not from/to: the normalised pair is
 *     identical for a selection dragged either way, so restoring from it put
 *     the caret at the wrong end.
 *
 * @coordinates-with plugins/codemirror/sourceShortcuts.ts — installs these
 * @coordinates-with sourceContextDetection/* — the block detectors
 * @module plugins/codemirror/sourceSmartSelect
 */
import type { EditorView, KeyBinding } from "@codemirror/view";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { getCodeFenceInfo } from "@/plugins/sourceContextDetection/codeFenceDetection";
import { getSourceTableInfo } from "@/plugins/sourceContextDetection/tableDetection";
import { getBlockquoteInfo } from "@/plugins/sourceContextDetection/blockquoteDetection";
import { getListBlockBounds } from "@/plugins/sourceContextDetection/listDetection";

// --- Source smart select-all state ---

interface SourceSelectUndo {
  /**
   * ANCHOR and HEAD, not from/to. `from`/`to` are normalised — a selection
   * dragged right-to-left has the same pair as one dragged left-to-right — so
   * restoring from them put the caret at the opposite end of the user's
   * selection and the next arrow key moved the wrong way.
   */
  prev: { anchor: number; head: number };
  expanded: { from: number; to: number };
}

const sourceSelectUndoState = new WeakMap<EditorView, SourceSelectUndo>();

/**
 * Get the bounds of the block containing the cursor in source mode.
 * Detection order: code fence -> table -> blockquote -> list.
 * Returns { from, to } or null if cursor is not in any block.
 */
export function getSourceBlockBounds(view: EditorView): { from: number; to: number } | null {
  // 1. Code fence
  const fenceInfo = getCodeFenceInfo(view);
  if (fenceInfo) {
    const doc = view.state.doc;
    // `endLine` is the CLOSING fence when the fence is closed, and the last
    // content line when it is not — treating both as a delimiter dropped the
    // final line of every unterminated fence, and returned nothing for a
    // one-line one.
    const lastContentLine = fenceInfo.closed ? fenceInfo.endLine - 1 : fenceInfo.endLine;
    if (lastContentLine < fenceInfo.startLine + 1) return null; // empty fence
    const contentStartLine = doc.line(fenceInfo.startLine + 1);
    const contentEndLine = doc.line(lastContentLine);
    return { from: contentStartLine.from, to: contentEndLine.to };
  }

  // 2. Table
  const tableInfo = getSourceTableInfo(view);
  if (tableInfo) {
    return { from: tableInfo.start, to: tableInfo.end };
  }

  // 3. Blockquote
  const bqInfo = getBlockquoteInfo(view);
  if (bqInfo) {
    return { from: bqInfo.from, to: bqInfo.to };
  }

  // 4. List block
  const listBounds = getListBlockBounds(view);
  if (listBounds) {
    return listBounds;
  }

  return null;
}

/** Builds the full CodeMirror keymap for source mode from user-configurable shortcuts. */

/** Install the smart select-all expansion and its undo. */
export function addSmartSelectBindings(bindings: KeyBinding[]): void {
  // --- Smart select-all: block-level expansion ---
  // Mod-a detects block context and selects block content first, then whole
  // document on second press. Detection order: code fence -> table ->
  // blockquote -> list -> default.
  //
  // Always returns true (preventDefault is set on the binding). Returning
  // false would hand the event back to the browser, whose default
  // `document.execCommand("selectAll")` highlights every selectable element
  // in the window — including the sidebar — instead of keeping the
  // selection scoped to the editor.
  bindings.push(
    guardCodeMirrorKeyBinding({
      key: "Mod-a",
      run: (view) => {
        const main = view.state.selection.main;
        const { from, to } = main;
        const docLen = view.state.doc.length;

        // Whole document already selected: there is nowhere further to expand.
        // This guard used to sit INSIDE the later branches, after block
        // detection — so a third press on a document whose first block was
        // detectable fell through and SHRANK the selection back to that block.
        if (from === 0 && to === docLen) {
          sourceSelectUndoState.delete(view);
          return true;
        }

        const blockBounds = getSourceBlockBounds(view);

        if (!blockBounds) {
          // No detectable block context — select the entire document so the
          // event is consumed inside the editor instead of escaping to the
          // browser's page-wide select-all.
          sourceSelectUndoState.delete(view);
          view.dispatch({ selection: { anchor: 0, head: docLen } });
          return true;
        }

        // Already selecting the entire block: progress to whole-document.
        // We dispatch the document-wide selection ourselves instead of
        // returning false (which would invoke the browser's spreading
        // select-all).
        if (from === blockBounds.from && to === blockBounds.to) {
          sourceSelectUndoState.delete(view);
          view.dispatch({ selection: { anchor: 0, head: docLen } });
          return true;
        }

        // Save the selection with its DIRECTION, then select the block.
        sourceSelectUndoState.set(view, {
          prev: { anchor: main.anchor, head: main.head },
          expanded: { from: blockBounds.from, to: blockBounds.to },
        });
        view.dispatch({
          selection: { anchor: blockBounds.from, head: blockBounds.to },
        });
        return true;
      },
      preventDefault: true,
    })
  );

  // --- Smart select-all undo ---
  // Mod-z restores the previous selection if the last action was a smart select-all expansion
  bindings.push(
    guardCodeMirrorKeyBinding({
      key: "Mod-z",
      run: (view) => {
        const undoInfo = sourceSelectUndoState.get(view);
        if (!undoInfo) return false;

        const { from, to } = view.state.selection.main;
        // Only restore if current selection matches the expansion
        if (from !== undoInfo.expanded.from || to !== undoInfo.expanded.to) {
          sourceSelectUndoState.delete(view);
          return false;
        }

        sourceSelectUndoState.delete(view);
        view.dispatch({
          selection: { anchor: undoInfo.prev.anchor, head: undoInfo.prev.head },
        });
        return true;
      },
      preventDefault: true,
    })
  );
}
