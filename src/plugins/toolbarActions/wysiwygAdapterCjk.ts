/**
 * WYSIWYG Adapter - CJK Formatting
 *
 * Purpose: CJK text formatting actions for WYSIWYG mode — block-level
 * formatting and whole-file formatting via markdown roundtrip (preserves
 * inline marks). Also handles trailing space removal, blank line collapse,
 * and the line-ending actions — which are METADATA-ONLY (WI-1.7): the buffer
 * stays LF-canonical and the convention is applied at save time.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates CJK/cleanup actions here
 * @coordinates-with wysiwygAdapterUtils.ts — uses applyFullDocumentTransform, getSerializeOptions
 * @coordinates-with cjkFormatter — formatting logic
 * Key decisions:
 *   - Formatting reaches only the top-level blocks the selection SPANS. The
 *     markdown round-trip is what preserves marks, not the scope; escalating a
 *     selection to the whole document reformatted the user's entire file.
 *
 * @module plugins/toolbarActions/wysiwygAdapterCjk
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import { useSettingsStore } from "@/stores/settingsStore";
import { collapseNewlines, formatMarkdown, removeTrailingSpaces } from "@/lib/cjkFormatter";
import { setDocumentLineEnding } from "@/services/formats/lineEndingMetadata";
import { wysiwygAdapterError } from "@/utils/debug";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import {
  applyFullDocumentTransform,
  getSerializeOptions,
  shouldPreserveTwoSpaceBreaks,
} from "./wysiwygAdapterUtils";
import type { WysiwygToolbarContext } from "./types";

/**
 * Format CJK text in selection or current block.
 * Uses markdown roundtrip to preserve marks (bold, italic, links, etc.).
 * Selection → full-doc roundtrip (safe for select-all).
 * No selection → single-block roundtrip.
 */
export function handleFormatCJK(context: WysiwygToolbarContext): boolean {
  // One path for both cases: round-trip the top-level blocks the selection
  // SPANS. A markdown round-trip is what preserves marks — the old
  // schema.text() path destroyed bold, italic and links — but escalating to the
  // whole document to get it meant selecting a single word reformatted the
  // entire file, a side effect no other formatting action has. A collapsed
  // cursor spans exactly one block, so the no-selection case is the same code.
  // The context guard lives in handleFormatCJKBlock, next to the code that
  // needs it — duplicating it here left the inner one unreachable.
  return handleFormatCJKBlock(context);
}

/**
 * Format CJK text across the top-level blocks the selection spans.
 * Serializes them to markdown, formats, and parses back so marks survive.
 */
function handleFormatCJKBlock(context: WysiwygToolbarContext): boolean {
  const { editor, view } = context;
  if (!editor || !view) return false;

  const { $from, $to } = editor.state.selection;
  // An AllSelection or a NodeSelection on the doc resolves at depth 0, where
  // there is no top-level block to span; the whole-document path handles it.
  if ($from.depth < 1 || $to.depth < 1) return handleFormatCJKFile(context);

  const config = useSettingsStore.getState().cjkFormatting;
  const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks();
  const serializeOpts = getSerializeOptions();

  // The span of top-level blocks the selection touches — one block for a
  // collapsed cursor, several when the selection crosses block boundaries.
  const blockStart = $from.before(1);
  const blockEnd = $to.after(1);
  const blockNodes: PMNode[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (offset >= blockStart && offset < blockEnd) blockNodes.push(node);
  });

  try {
    // Wrap in a temporary doc for serialization
    const tempDoc = editor.schema.nodes.doc.create(null, blockNodes);
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
    wysiwygAdapterError("Failed to format CJK block:", error);
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
 * Record the document's line-ending convention. METADATA-ONLY (WI-1.7): the
 * buffer stays LF-canonical and `saveToPath` applies the convention at write
 * time. The old buffer round-trip put literal `\r` into PM text nodes.
 */
export function handleLineEndings(_context: WysiwygToolbarContext, target: "lf" | "crlf"): boolean {
  return setDocumentLineEnding(target);
}
