/**
 * WYSIWYG Adapter - CJK Formatting
 *
 * Purpose: CJK text formatting actions for WYSIWYG mode — selection-level
 * formatting, block-level formatting, and whole-file formatting. Also handles
 * trailing space removal, blank line collapse, and line ending normalization.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates CJK/cleanup actions here
 * @coordinates-with wysiwygAdapterUtils.ts — uses applyFullDocumentTransform, getSerializeOptions
 * @coordinates-with cjkFormatter — formatting logic
 * @module plugins/toolbarActions/wysiwygAdapterCjk
 */
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { collapseNewlines, formatMarkdown, formatSelection, removeTrailingSpaces } from "@/lib/cjkFormatter";
import { normalizeLineEndings } from "@/utils/linebreaks";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import {
  applyFullDocumentTransform,
  getSerializeOptions,
  shouldPreserveTwoSpaceBreaks,
} from "./wysiwygAdapterUtils";
import type { WysiwygToolbarContext } from "./types";

/**
 * Format CJK text in selection or current block.
 * If selection exists, formats only selected text inline.
 * Otherwise, serializes and reformats the current top-level block.
 */
export function handleFormatCJK(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();

  // Check if there's a selection
  if (!editor.state.selection.empty) {
    const { state, dispatch } = view;
    const { from, to } = state.selection;
    const selectedText = state.doc.textBetween(from, to, "\n");
    const formatted = formatSelection(selectedText, config, { preserveTwoSpaceHardBreaks });
    if (formatted !== selectedText) {
      const tr = state.tr
        .replaceWith(from, to, state.schema.text(formatted))
        .setMeta("addToHistory", true);
      dispatch(tr);
      view.focus();
    }
    return true;
  }

  // No selection - format current block (paragraph, list, or table)
  return handleFormatCJKBlock(context);
}

/**
 * Format CJK text in the current top-level block (no selection needed).
 * Serializes the block to markdown, formats, and parses back.
 */
function handleFormatCJKBlock(context: WysiwygToolbarContext): boolean {
  const { editor, view } = context;
  if (!editor || !view) return false;

  const { $from } = editor.state.selection;
  if ($from.depth < 1) return false;

  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
  const serializeOpts = getSerializeOptions();

  // Find top-level block (direct child of doc)
  const blockNode = $from.node(1);
  const blockStart = $from.before(1);
  const blockEnd = $from.after(1);

  try {
    // Wrap in a temporary doc for serialization
    const tempDoc = editor.schema.nodes.doc.create(null, blockNode);
    const blockMarkdown = serializeMarkdown(editor.schema, tempDoc, serializeOpts);

    const formatted = formatMarkdown(blockMarkdown, config, { preserveTwoSpaceHardBreaks });
    if (formatted === blockMarkdown) return true;

    // Parse back and replace the block
    const newDoc = parseMarkdown(editor.schema, formatted, {
      preserveLineBreaks: serializeOpts.preserveLineBreaks,
    });

    const { state, dispatch } = view;
    const tr = state.tr
      .replaceWith(blockStart, blockEnd, newDoc.content)
      .setMeta("addToHistory", true);
    dispatch(tr);
    view.focus();
    return true;
  } catch (error) {
    console.error("[wysiwygAdapter] Failed to format CJK block:", error);
    return false;
  }
}

/**
 * Format CJK text in the entire document.
 */
export function handleFormatCJKFile(context: WysiwygToolbarContext): boolean {
  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();

  return applyFullDocumentTransform(context, (markdown) =>
    formatMarkdown(markdown, config, { preserveTwoSpaceHardBreaks })
  );
}

/**
 * Remove trailing whitespace from all lines in the document.
 */
export function handleRemoveTrailingSpaces(context: WysiwygToolbarContext): boolean {
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();

  return applyFullDocumentTransform(context, (markdown) =>
    removeTrailingSpaces(markdown, { preserveTwoSpaceHardBreaks })
  );
}

/**
 * Collapse consecutive blank lines into single blank lines.
 */
export function handleCollapseBlankLines(context: WysiwygToolbarContext): boolean {
  return applyFullDocumentTransform(context, collapseNewlines);
}

/**
 * Normalize line endings to LF or CRLF for the entire document.
 * Also updates the document's line ending metadata in the store.
 */
export function handleLineEndings(context: WysiwygToolbarContext, target: "lf" | "crlf"): boolean {
  const windowLabel = getWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;

  // Apply the transformation via proper editor transaction
  applyFullDocumentTransform(context, (content) => normalizeLineEndings(content, target));

  // Update metadata in store (this doesn't affect editor state)
  if (tabId) {
    useDocumentStore.getState().setLineMetadata(tabId, { lineEnding: target });
  }

  return true;
}
