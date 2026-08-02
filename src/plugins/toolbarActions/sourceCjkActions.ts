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
import { hostDocument } from "@/plugins/shared/hostDocument";
import { hostSettings } from "@/plugins/shared/hostSettings";
import type { CJKFormattingSettings } from "@/lib/cjkFormatter/types";
import { getWindowLabel } from "@/services/navigation/windowFocus";
import { collapseNewlines, formatMarkdown, formatSelection, removeTrailingSpaces } from "@/lib/cjkFormatter";
import { selectionBlockSpan } from "@/plugins/shared/blockSpan";
import { setDocumentLineEnding } from "@/services/formats/lineEndingMetadata";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { getSourceBlockRange } from "@/utils/sourceSelection";

// --- CJK formatting helpers ---

function shouldPreserveTwoSpaceBreaks(): boolean {
  try {
    const windowLabel = getWindowLabel();
    return (
      resolveHardBreakStyle(
        hostDocument.activeHardBreakStyle(windowLabel),
        hostSettings.hardBreakStyleOnSave()
      ) === "twoSpaces"
    );
  } catch {
    /* v8 ignore next -- @preserve catch only fires if Tauri/store APIs throw; mocked in tests */
    return false;
  }
}

/** Formats CJK spacing in the selection, or the current block if nothing is selected. */
export function handleFormatCJK(view: EditorView): boolean {
  const config = hostSettings.cjkFormatting();
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
  const { from, to } = view.state.selection.main;

  if (from !== to) {
    // The BLOCKS the selection spans, not the selected characters. CJK spacing
    // is a property of the boundary BETWEEN two adjacent characters, and a
    // sub-word selection cannot express one — selecting the Latin word in
    // `中文段落brown混排English文本` contains no boundary at all, so source did
    // nothing while WYSIWYG spaced the whole line. Widening makes the selection
    // name a region to fix rather than the exact text to rewrite.
    const doc = view.state.doc;
    const all = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text);
    const span = selectionBlockSpan(all, from, to, (offset) => doc.lineAt(offset).number);
    const blockFrom = doc.line(span.start + 1).from;
    const blockTo = doc.line(span.end + 1).to;

    const selectedText = doc.sliceString(blockFrom, blockTo);
    const formatted = formatSelection(selectedText, config, { preserveTwoSpaceHardBreaks });
    if (formatted !== selectedText) {
      view.dispatch({
        changes: { from: blockFrom, to: blockTo, insert: formatted },
        selection: { anchor: blockFrom, head: blockFrom + formatted.length },
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
  const config = hostSettings.cjkFormatting();
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

/**
 * Record the document's line-ending convention. METADATA-ONLY (WI-1.7): the
 * buffer is LF-canonical — CodeMirror normalises CRLF on insert anyway, so the
 * old whole-document round-trip changed nothing while adding a useless undo
 * entry and collapsing the selection.
 */
export function handleLineEndings(_view: EditorView, target: "lf" | "crlf"): boolean {
  return setDocumentLineEnding(target);
}
