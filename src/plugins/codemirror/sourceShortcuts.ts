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
 *   - EVERY document mutation routes through the shared executor
 *     (runEditorAction, the menu's path — NOT executeCommand; WI-4.2). The last
 *     exception, `unlink`, had no `editor.*` action though both adapters
 *     implemented it; adding the ActionId closed the gap (WI-2.1). Direct
 *     handlers remain only for non-mutations — find/search, copy-as-HTML —
 *     gated by `__tests__/dispatchBoundary.test.ts`
 *   - Helper functions are extracted to sourceShortcutsHelpers.ts to keep this file focused
 *
 * Known limitations:
 *   - Some shortcuts overlap with system keybindings on different platforms
 *
 * @coordinates-with stores/shortcutsStore.ts — source of shortcut key definitions
 * @coordinates-with services/editor/runEditorAction.ts — executor for editor.* actions
 * @coordinates-with plugins/actions/types.ts — the ActionId union the bindings use
 * @coordinates-with plugins/codemirror/sourceShortcutsHelpers.ts — helper functions
 * @module plugins/codemirror/sourceShortcuts
 */

import type { KeyBinding } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { toggleBlockComment, selectLine } from "@codemirror/commands";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/settingsStore";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { runEditorAction } from "@/services/editor/runEditorAction";
import type { ActionId } from "@/plugins/actions/types";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { getCodeFenceInfo } from "@/plugins/sourceContextDetection/codeFenceDetection";
import { getSourceTableInfo } from "@/plugins/sourceContextDetection/tableDetection";
import { getBlockquoteInfo } from "@/plugins/sourceContextDetection/blockquoteDetection";
import { getListBlockBounds } from "@/plugins/sourceContextDetection/listDetection";
import {
  openFindBar,
  findNextMatch,
  findPreviousMatch,
  copySelectionAsHtml,
} from "./sourceShortcutsHelpers";

/** CodeMirror command running `editor.<actionId>` via the shared executor
 * (runEditorAction, the menu's path — NOT executeCommand, whose stricter palette
 * gate would drop keyboard formatting; WI-4.2). `setHeading.N` → level param. */
function runCommand(commandId: string): (view: EditorView) => boolean {
  const rest = commandId.replace(/^editor\./, "");
  const heading = rest.match(/^setHeading\.([1-6])$/);
  return () => {
    const windowLabel = getCurrentWindowLabel();
    if (heading) runEditorAction("setHeading", { windowLabel, params: { level: Number(heading[1]) } });
    else runEditorAction(rest as ActionId, { windowLabel });
    return true;
  };
}

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

  // --- Inline formatting (routed through the executor; see runCommand) ---
  bindIfKey(bindings, shortcuts.getShortcut("bold"), runCommand("editor.bold"));
  bindIfKey(bindings, shortcuts.getShortcut("italic"), runCommand("editor.italic"));
  bindIfKey(bindings, shortcuts.getShortcut("code"), runCommand("editor.code"));
  bindIfKey(bindings, shortcuts.getShortcut("strikethrough"), runCommand("editor.strikethrough"));
  bindIfKey(bindings, shortcuts.getShortcut("underline"), runCommand("editor.underline"));
  bindIfKey(bindings, shortcuts.getShortcut("link"), runCommand("editor.link"));
  bindIfKey(bindings, shortcuts.getShortcut("unlink"), runCommand("editor.unlink"));
  bindIfKey(bindings, shortcuts.getShortcut("wikiLink"), runCommand("editor.wikiLink"));
  bindIfKey(bindings, shortcuts.getShortcut("bookmarkLink"), runCommand("editor.bookmark"));
  bindIfKey(bindings, shortcuts.getShortcut("highlight"), runCommand("editor.highlight"));
  bindIfKey(bindings, shortcuts.getShortcut("subscript"), runCommand("editor.subscript"));
  bindIfKey(bindings, shortcuts.getShortcut("superscript"), runCommand("editor.superscript"));
  bindIfKey(bindings, shortcuts.getShortcut("inlineMath"), runCommand("editor.insertInlineMath"));
  bindIfKey(bindings, shortcuts.getShortcut("clearFormat"), runCommand("editor.clearFormatting"));
  // toggleComment has no editor.* command — keep the CodeMirror command directly.
  bindIfKey(bindings, shortcuts.getShortcut("toggleComment"), (view) => toggleBlockComment(view));

  // --- Block formatting: Headings ---
  bindIfKey(bindings, shortcuts.getShortcut("heading1"), runCommand("editor.setHeading.1"));
  bindIfKey(bindings, shortcuts.getShortcut("heading2"), runCommand("editor.setHeading.2"));
  bindIfKey(bindings, shortcuts.getShortcut("heading3"), runCommand("editor.setHeading.3"));
  bindIfKey(bindings, shortcuts.getShortcut("heading4"), runCommand("editor.setHeading.4"));
  bindIfKey(bindings, shortcuts.getShortcut("heading5"), runCommand("editor.setHeading.5"));
  bindIfKey(bindings, shortcuts.getShortcut("heading6"), runCommand("editor.setHeading.6"));
  bindIfKey(bindings, shortcuts.getShortcut("paragraph"), runCommand("editor.paragraph"));
  bindIfKey(bindings, shortcuts.getShortcut("increaseHeading"), runCommand("editor.increaseHeading"));
  bindIfKey(bindings, shortcuts.getShortcut("decreaseHeading"), runCommand("editor.decreaseHeading"));

  // --- Block formatting: Lists ---
  bindIfKey(bindings, shortcuts.getShortcut("bulletList"), runCommand("editor.bulletList"));
  bindIfKey(bindings, shortcuts.getShortcut("orderedList"), runCommand("editor.orderedList"));
  bindIfKey(bindings, shortcuts.getShortcut("taskList"), runCommand("editor.taskList"));
  bindIfKey(bindings, shortcuts.getShortcut("indent"), runCommand("editor.indent"));
  bindIfKey(bindings, shortcuts.getShortcut("outdent"), runCommand("editor.outdent"));

  // --- Block formatting: Other blocks ---
  bindIfKey(bindings, shortcuts.getShortcut("blockquote"), runCommand("editor.blockquote"));
  bindIfKey(bindings, shortcuts.getShortcut("codeBlock"), runCommand("editor.codeBlock"));
  bindIfKey(bindings, shortcuts.getShortcut("mathBlock"), runCommand("editor.insertMath"));
  bindIfKey(bindings, shortcuts.getShortcut("insertTable"), runCommand("editor.insertTable"));
  bindIfKey(bindings, shortcuts.getShortcut("formatTable"), runCommand("editor.formatTable"));
  bindIfKey(bindings, shortcuts.getShortcut("horizontalLine"), runCommand("editor.horizontalLine"));
  bindIfKey(bindings, shortcuts.getShortcut("insertImage"), runCommand("editor.insertImage"));

  // --- Block formatting: Alerts and details ---
  bindIfKey(bindings, shortcuts.getShortcut("insertNote"), runCommand("editor.insertAlertNote"));
  bindIfKey(bindings, shortcuts.getShortcut("insertTip"), runCommand("editor.insertAlertTip"));
  bindIfKey(bindings, shortcuts.getShortcut("insertWarning"), runCommand("editor.insertAlertWarning"));
  bindIfKey(bindings, shortcuts.getShortcut("insertImportant"), runCommand("editor.insertAlertImportant"));
  bindIfKey(bindings, shortcuts.getShortcut("insertCaution"), runCommand("editor.insertAlertCaution"));
  bindIfKey(bindings, shortcuts.getShortcut("insertCollapsible"), runCommand("editor.insertDetails"));

  // --- Navigation ---
  bindIfKey(bindings, shortcuts.getShortcut("selectLine"), (view) => selectLine(view));
  bindIfKey(bindings, shortcuts.getShortcut("findReplace"), () => openFindBar());
  bindIfKey(bindings, shortcuts.getShortcut("findNext"), findNextMatch);
  bindIfKey(bindings, shortcuts.getShortcut("findPrevious"), findPreviousMatch);

  // --- Editing ---
  bindIfKey(bindings, shortcuts.getShortcut("formatCJKSelection"), runCommand("editor.formatCJK"));
  bindIfKey(bindings, shortcuts.getShortcut("formatCJKFile"), runCommand("editor.formatCJKFile"));
  // copyAsHTML has no editor.* command — keep the source helper directly.
  bindIfKey(bindings, shortcuts.getShortcut("copyAsHTML"), copySelectionAsHtml);

  // --- Line operations ---
  bindIfKey(bindings, shortcuts.getShortcut("moveLineUp"), runCommand("editor.moveLineUp"));
  bindIfKey(bindings, shortcuts.getShortcut("moveLineDown"), runCommand("editor.moveLineDown"));
  bindIfKey(bindings, shortcuts.getShortcut("duplicateLine"), runCommand("editor.duplicateLine"));
  bindIfKey(bindings, shortcuts.getShortcut("deleteLine"), runCommand("editor.deleteLine"));
  bindIfKey(bindings, shortcuts.getShortcut("joinLines"), runCommand("editor.joinLines"));
  bindIfKey(bindings, shortcuts.getShortcut("sortLinesAsc"), runCommand("editor.sortLinesAsc"));
  bindIfKey(bindings, shortcuts.getShortcut("sortLinesDesc"), runCommand("editor.sortLinesDesc"));

  // --- Text transformations ---
  bindIfKey(bindings, shortcuts.getShortcut("transformUppercase"), runCommand("editor.transformUppercase"));
  bindIfKey(bindings, shortcuts.getShortcut("transformLowercase"), runCommand("editor.transformLowercase"));
  bindIfKey(bindings, shortcuts.getShortcut("transformTitleCase"), runCommand("editor.transformTitleCase"));
  bindIfKey(bindings, shortcuts.getShortcut("transformToggleCase"), runCommand("editor.transformToggleCase"));

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
