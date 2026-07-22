/**
 * Source CJK Actions
 *
 * CJK formatting and text cleanup handlers for source (CodeMirror) mode.
 * Extracted from sourceAdapter.ts to keep files under ~300 lines.
 *
 * @coordinates-with sourceAdapter.ts — main dispatcher imports these handlers
 * @module plugins/toolbarActions/sourceCjkActions
 */

import type { EditorView } from "@codemirror/view";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore, type CJKFormattingSettings } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { getWindowLabel } from "@/services/navigation/windowFocus";
import { collapseNewlines, formatMarkdown, formatSelection, removeTrailingSpaces } from "@/lib/cjkFormatter";
import { normalizeLineEndings, resolveHardBreakStyle } from "@/utils/linebreaks";
import { getSourceBlockRange } from "@/utils/sourceSelection";

// --- CJK formatting helpers ---

function shouldPreserveTwoSpaceBreaks(): boolean {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : null;
    const hardBreakStyleOnSave = useSettingsStore.getState().markdown.hardBreakStyleOnSave;
    return resolveHardBreakStyle(doc?.hardBreakStyle ?? "unknown", hardBreakStyleOnSave) === "twoSpaces";
  } catch {
    /* v8 ignore next -- @preserve catch only fires if Tauri/store APIs throw; mocked in tests */
    return false;
  }
}

/** Formats CJK spacing in the selection, or the current block if nothing is selected. */
export function handleFormatCJK(view: EditorView): boolean {
  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
  const { from, to } = view.state.selection.main;

  if (from !== to) {
    // Format selection
    const selectedText = view.state.doc.sliceString(from, to);
    const formatted = formatSelection(selectedText, config, { preserveTwoSpaceHardBreaks });
    if (formatted !== selectedText) {
      view.dispatch({
        changes: { from, to, insert: formatted },
        selection: { anchor: from, head: from + formatted.length },
      });
    }
    return true;
  }

  // No selection - format current block (paragraph, list, or table)
  return formatCJKCurrentBlock(view, config, { preserveTwoSpaceHardBreaks });
}

/** Formats CJK spacing in the current block (paragraph, list item, or table cell). */
export function formatCJKCurrentBlock(
  view: EditorView,
  config: CJKFormattingSettings,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): boolean {
  const { head } = view.state.selection.main;
  const { from, to } = getSourceBlockRange(view.state, head, head);
  const blockText = view.state.doc.sliceString(from, to);
  const formatted = formatMarkdown(blockText, config, options);
  if (formatted !== blockText) {
    view.dispatch({
      changes: { from, to, insert: formatted },
    });
    view.focus();
  }
  return true;
}

/** Formats CJK spacing across the entire document, preserving cursor position. */
export function handleFormatCJKFile(view: EditorView): boolean {
  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
  const content = view.state.doc.toString();
  const formatted = formatMarkdown(content, config, { preserveTwoSpaceHardBreaks });

  if (formatted !== content) {
    // Preserve cursor position as best as possible
    const cursorPos = view.state.selection.main.head;
    const newCursorPos = Math.min(cursorPos, formatted.length);
    view.dispatch({
      changes: { from: 0, to: content.length, insert: formatted },
      selection: { anchor: newCursorPos },
    });
  }
  return true;
}

// --- Text cleanup helpers ---

/**
 * Apply a full-document transformation via proper CodeMirror transaction.
 * This preserves undo/redo history and reads directly from editor state.
 */
function applyFullDocumentTransform(
  view: EditorView,
  transform: (content: string) => string
): boolean {
  const content = view.state.doc.toString();
  const transformed = transform(content);

  if (transformed === content) {
    return true;
  }

  // Preserve cursor position as best as possible
  const cursorPos = view.state.selection.main.head;
  const newCursorPos = Math.min(cursorPos, transformed.length);

  view.dispatch({
    changes: { from: 0, to: content.length, insert: transformed },
    selection: { anchor: newCursorPos },
  });

  return true;
}

/** Removes trailing whitespace from all lines, respecting two-space hard break settings. */
export function handleRemoveTrailingSpaces(view: EditorView): boolean {
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
  return applyFullDocumentTransform(view, (content) =>
    removeTrailingSpaces(content, { preserveTwoSpaceHardBreaks })
  );
}

/** Collapses consecutive blank lines into a single blank line across the document. */
export function handleCollapseBlankLines(view: EditorView): boolean {
  return applyFullDocumentTransform(view, collapseNewlines);
}

/** Normalizes all line endings to the specified style and updates document metadata. */
export function handleLineEndings(view: EditorView, target: "lf" | "crlf"): boolean {
  const windowLabel = getWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;

  // Apply the transformation via proper transaction
  applyFullDocumentTransform(view, (content) => normalizeLineEndings(content, target));

  // Update metadata in store (this doesn't affect editor state)
  if (tabId) {
    useDocumentStore.getState().setLineMetadata(tabId, { lineEnding: target });
  }

  return true;
}
