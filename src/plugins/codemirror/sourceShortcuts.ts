/**
 * Source Mode Keyboard Shortcuts
 *
 * Purpose: Defines all keyboard shortcuts for Source mode (CodeMirror 6), mapping
 * user-configurable shortcuts from shortcutsStore to Source-specific actions.
 *
 * Pipeline: shortcutsStore -> getSourceKeybindings() -> CodeMirror keymap extension
 *
 * Key decisions:
 *   - Shortcuts are resolved lazily from the store so user customizations take effect immediately
 *   - Some actions delegate to the sourceAdapter for cross-mode consistency
 *   - Text transformation shortcuts (uppercase, titlecase, etc.) operate directly on CM6 state
 *   - CJK formatting is done in-place on the markdown buffer
 *   - Helper functions are extracted to sourceShortcutsHelpers.ts to keep this file focused
 *
 * Known limitations:
 *   - Some shortcuts overlap with system keybindings on different platforms
 *
 * @coordinates-with stores/shortcutsStore.ts — source of shortcut key definitions
 * @coordinates-with toolbarActions/sourceAdapter.ts — action execution for format operations
 * @coordinates-with plugins/codemirror/sourceShortcutsHelpers.ts — helper functions
 * @module plugins/codemirror/sourceShortcuts
 */

import type { KeyBinding } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { toggleBlockComment, selectLine } from "@codemirror/commands";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { getCodeFenceInfo } from "@/plugins/sourceContextDetection/codeFenceDetection";
import { getSourceTableInfo } from "@/plugins/sourceContextDetection/tableDetection";
import { getBlockquoteInfo } from "@/plugins/sourceContextDetection/blockquoteDetection";
import { getListBlockBounds } from "@/plugins/sourceContextDetection/listDetection";
import {
  runSourceAction,
  setHeading,
  increaseHeadingLevel,
  decreaseHeadingLevel,
  toggleBlockquote,
  toggleList,
  openFindBar,
  findNextMatch,
  findPreviousMatch,
  formatCJKSelection,
  formatCJKFile,
  copySelectionAsHtml,
  doTransformUppercase,
  doTransformLowercase,
  doTransformTitleCase,
  doTransformToggleCase,
  doMoveLineUp,
  doMoveLineDown,
  doDuplicateLine,
  doDeleteLine,
  doJoinLines,
  doSortLinesAsc,
  doSortLinesDesc,
} from "./sourceShortcutsHelpers";

function bindIfKey(bindings: KeyBinding[], key: string, run: (view: EditorView) => boolean) {
  if (!key) return;
  bindings.push(
    guardCodeMirrorKeyBinding({
      key,
      run,
      preventDefault: true,
    })
  );
}

// --- Source smart select-all state ---

interface SourceSelectUndo {
  prev: { from: number; to: number };
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
    // Empty fence — no content to select
    if (fenceInfo.endLine - fenceInfo.startLine <= 1) return null;
    const contentStartLine = doc.line(fenceInfo.startLine + 1);
    const contentEndLine = doc.line(fenceInfo.endLine - 1);
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
export function buildSourceShortcutKeymap(): KeyBinding[] {
  const shortcuts = useShortcutsStore.getState();
  const bindings: KeyBinding[] = [];

  // --- View shortcuts ---
  bindIfKey(bindings, shortcuts.getShortcut("toggleSidebar"), () => {
    useUIStore.getState().toggleSidebar();
    return true;
  });

  // Capture sourceMode shortcut to prevent CodeMirror's default comment toggle.
  // The actual toggle is handled by useViewShortcuts hook at window level.
  bindIfKey(bindings, shortcuts.getShortcut("sourceMode"), () => {
    // Just mark as handled - window handler does the actual toggle
    return true;
  });

  // --- Inline formatting ---
  bindIfKey(bindings, shortcuts.getShortcut("bold"), runSourceAction("bold"));
  bindIfKey(bindings, shortcuts.getShortcut("italic"), runSourceAction("italic"));
  bindIfKey(bindings, shortcuts.getShortcut("code"), runSourceAction("code"));
  bindIfKey(bindings, shortcuts.getShortcut("strikethrough"), runSourceAction("strikethrough"));
  bindIfKey(bindings, shortcuts.getShortcut("underline"), runSourceAction("underline"));
  bindIfKey(bindings, shortcuts.getShortcut("link"), runSourceAction("link"));
  bindIfKey(bindings, shortcuts.getShortcut("unlink"), runSourceAction("unlink"));
  bindIfKey(bindings, shortcuts.getShortcut("wikiLink"), runSourceAction("link:wiki"));
  bindIfKey(bindings, shortcuts.getShortcut("bookmarkLink"), runSourceAction("link:bookmark"));
  bindIfKey(bindings, shortcuts.getShortcut("highlight"), runSourceAction("highlight"));
  bindIfKey(bindings, shortcuts.getShortcut("subscript"), runSourceAction("subscript"));
  bindIfKey(bindings, shortcuts.getShortcut("superscript"), runSourceAction("superscript"));
  bindIfKey(bindings, shortcuts.getShortcut("inlineMath"), runSourceAction("insertInlineMath"));
  bindIfKey(bindings, shortcuts.getShortcut("clearFormat"), runSourceAction("clearFormatting"));
  bindIfKey(bindings, shortcuts.getShortcut("toggleComment"), (view) => toggleBlockComment(view));

  // --- Block formatting: Headings ---
  bindIfKey(bindings, shortcuts.getShortcut("heading1"), setHeading(1));
  bindIfKey(bindings, shortcuts.getShortcut("heading2"), setHeading(2));
  bindIfKey(bindings, shortcuts.getShortcut("heading3"), setHeading(3));
  bindIfKey(bindings, shortcuts.getShortcut("heading4"), setHeading(4));
  bindIfKey(bindings, shortcuts.getShortcut("heading5"), setHeading(5));
  bindIfKey(bindings, shortcuts.getShortcut("heading6"), setHeading(6));
  bindIfKey(bindings, shortcuts.getShortcut("paragraph"), setHeading(0));
  bindIfKey(bindings, shortcuts.getShortcut("increaseHeading"), increaseHeadingLevel);
  bindIfKey(bindings, shortcuts.getShortcut("decreaseHeading"), decreaseHeadingLevel);

  // --- Block formatting: Lists ---
  bindIfKey(bindings, shortcuts.getShortcut("bulletList"), (view) => toggleList(view, "bullet"));
  bindIfKey(bindings, shortcuts.getShortcut("orderedList"), (view) => toggleList(view, "ordered"));
  bindIfKey(bindings, shortcuts.getShortcut("taskList"), (view) => toggleList(view, "task"));
  bindIfKey(bindings, shortcuts.getShortcut("indent"), runSourceAction("indent"));
  bindIfKey(bindings, shortcuts.getShortcut("outdent"), runSourceAction("outdent"));

  // --- Block formatting: Other blocks ---
  bindIfKey(bindings, shortcuts.getShortcut("blockquote"), toggleBlockquote);
  bindIfKey(bindings, shortcuts.getShortcut("codeBlock"), runSourceAction("insertCodeBlock"));
  bindIfKey(bindings, shortcuts.getShortcut("mathBlock"), runSourceAction("insertMath"));
  bindIfKey(bindings, shortcuts.getShortcut("insertTable"), runSourceAction("insertTable"));
  bindIfKey(bindings, shortcuts.getShortcut("formatTable"), runSourceAction("formatTable"));
  bindIfKey(bindings, shortcuts.getShortcut("horizontalLine"), runSourceAction("insertDivider"));
  bindIfKey(bindings, shortcuts.getShortcut("insertImage"), runSourceAction("insertImage"));

  // --- Block formatting: Alerts and details ---
  bindIfKey(bindings, shortcuts.getShortcut("insertNote"), runSourceAction("insertAlertNote"));
  bindIfKey(bindings, shortcuts.getShortcut("insertTip"), runSourceAction("insertAlertTip"));
  bindIfKey(bindings, shortcuts.getShortcut("insertWarning"), runSourceAction("insertAlertWarning"));
  bindIfKey(bindings, shortcuts.getShortcut("insertImportant"), runSourceAction("insertAlertImportant"));
  bindIfKey(bindings, shortcuts.getShortcut("insertCaution"), runSourceAction("insertAlertCaution"));
  bindIfKey(bindings, shortcuts.getShortcut("insertCollapsible"), runSourceAction("insertDetails"));

  // --- Navigation ---
  bindIfKey(bindings, shortcuts.getShortcut("selectLine"), (view) => selectLine(view));
  bindIfKey(bindings, shortcuts.getShortcut("findReplace"), () => openFindBar());
  bindIfKey(bindings, shortcuts.getShortcut("findNext"), findNextMatch);
  bindIfKey(bindings, shortcuts.getShortcut("findPrevious"), findPreviousMatch);

  // --- Editing ---
  bindIfKey(bindings, shortcuts.getShortcut("formatCJKSelection"), formatCJKSelection);
  bindIfKey(bindings, shortcuts.getShortcut("formatCJKFile"), formatCJKFile);
  bindIfKey(bindings, shortcuts.getShortcut("copyAsHTML"), copySelectionAsHtml);

  // --- Line operations ---
  bindIfKey(bindings, shortcuts.getShortcut("moveLineUp"), doMoveLineUp);
  bindIfKey(bindings, shortcuts.getShortcut("moveLineDown"), doMoveLineDown);
  bindIfKey(bindings, shortcuts.getShortcut("duplicateLine"), doDuplicateLine);
  bindIfKey(bindings, shortcuts.getShortcut("deleteLine"), doDeleteLine);
  bindIfKey(bindings, shortcuts.getShortcut("joinLines"), doJoinLines);
  bindIfKey(bindings, shortcuts.getShortcut("sortLinesAsc"), doSortLinesAsc);
  bindIfKey(bindings, shortcuts.getShortcut("sortLinesDesc"), doSortLinesDesc);

  // --- Text transformations ---
  bindIfKey(bindings, shortcuts.getShortcut("transformUppercase"), doTransformUppercase);
  bindIfKey(bindings, shortcuts.getShortcut("transformLowercase"), doTransformLowercase);
  bindIfKey(bindings, shortcuts.getShortcut("transformTitleCase"), doTransformTitleCase);
  bindIfKey(bindings, shortcuts.getShortcut("transformToggleCase"), doTransformToggleCase);

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
        const { from, to } = view.state.selection.main;
        const docLen = view.state.doc.length;

        const blockBounds = getSourceBlockBounds(view);

        if (!blockBounds) {
          // No detectable block context — select the entire document so the
          // event is consumed inside the editor instead of escaping to the
          // browser's page-wide select-all.
          sourceSelectUndoState.delete(view);
          if (from === 0 && to === docLen) return true;
          view.dispatch({ selection: { anchor: 0, head: docLen } });
          return true;
        }

        // Already selecting the entire block: progress to whole-document.
        // We dispatch the document-wide selection ourselves instead of
        // returning false (which would invoke the browser's spreading
        // select-all).
        if (from === blockBounds.from && to === blockBounds.to) {
          sourceSelectUndoState.delete(view);
          if (from === 0 && to === docLen) return true;
          view.dispatch({ selection: { anchor: 0, head: docLen } });
          return true;
        }

        // Save current selection for undo, then select block
        sourceSelectUndoState.set(view, {
          prev: { from, to },
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
          selection: { anchor: undoInfo.prev.from, head: undoInfo.prev.to },
        });
        return true;
      },
      preventDefault: true,
    })
  );

  return bindings;
}
