/**
 * WYSIWYG Adapter Utilities
 *
 * Purpose: Shared helper functions used across the WYSIWYG adapter modules.
 * Contains view connectivity checks, file path resolution, serialization
 * option helpers, and the full-document transform pipeline.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher imports these helpers
 * @coordinates-with wysiwygAdapterCjk.ts — CJK formatting uses applyFullDocumentTransform
 * @coordinates-with wysiwygAdapterInsert.ts — image insertion uses getActiveFilePath
 * @module plugins/toolbarActions/wysiwygAdapterUtils
 */
import type { EditorView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import { getWindowLabel } from "@/services/navigation/windowFocus";
import { hostDocument, activeFilePathForCurrentWindow } from "@/plugins/shared/hostDocument";
import { hostSettings } from "@/plugins/shared/hostSettings";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { wysiwygAdapterError } from "@/utils/debug";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import type { WysiwygToolbarContext } from "./types";

/**
 * Check if an editor view is still connected and valid.
 */
export function isViewConnected(view: EditorView): boolean {
  try {
    return view.dom?.isConnected ?? false;
  } catch {
    return false;
  }
}

/**
 * Get the active document file path for the current window.
 */
export function getActiveFilePath(): string | null {
  try {
    return activeFilePathForCurrentWindow();
  } catch {
    return null;
  }
}

/**
 * Get serialization options (line break preservation and hard break style)
 * based on current document and settings.
 */
export function getSerializeOptions(): {
  preserveLineBreaks: boolean;
  preserveBlankLines: boolean;
  hardBreakStyle: "twoSpaces" | "backslash";
} {
  const windowLabel = getWindowLabel();
  const hardBreakStyle = resolveHardBreakStyle(
    hostDocument.activeHardBreakStyle(windowLabel),
    hostSettings.hardBreakStyleOnSave()
  );
  return {
    preserveLineBreaks: hostSettings.preserveLineBreaks(),
    preserveBlankLines: hostSettings.preserveBlankLines(),
    hardBreakStyle,
  };
}

/**
 * Check if two-space hard breaks should be preserved during formatting.
 */
export function shouldPreserveTwoSpaceBreaks(): boolean {
  return getSerializeOptions().hardBreakStyle === "twoSpaces";
}

/**
 * Apply a full-document transformation via proper editor transaction.
 * Uses ProseMirror transaction with explicit addToHistory to ensure undo works.
 */
export function applyFullDocumentTransform(
  context: WysiwygToolbarContext,
  transform: (markdown: string) => string
): boolean {
  const { editor, view } = context;
  if (!editor || !view) return false;

  const serializeOpts = getSerializeOptions();

  // Serialize current editor content directly (avoids stale store data)
  const currentMarkdown = serializeMarkdown(editor.schema, editor.state.doc, serializeOpts);

  // Apply transformation
  const transformed = transform(currentMarkdown);

  // Only update if changed
  if (transformed === currentMarkdown) {
    return true;
  }

  // Parse back to ProseMirror doc and apply via transaction
  // Using replaceWith + setMeta ensures proper undo history
  try {
    const newDoc = parseMarkdown(editor.schema, transformed, {
      preserveLineBreaks: serializeOpts.preserveLineBreaks,
    });

    const { state, dispatch } = view;

    // Where the user was, before the document is replaced under them
    // (WI-CJKF6.3). ProseMirror maps a selection through a replacement of the
    // ENTIRE document by collapsing it to the end, so "Format CJK File" threw
    // the caret to the bottom of a long document — and took the scroll
    // position with it — for a command whose point is that nothing visible
    // changes. On a document that SHRANK it was worse: restoring nothing meant
    // the mapped position could fall outside the new doc and `TextSelection`
    // threw, which this catch turned into a silent no-op.
    const caretBefore = state.selection.head;
    const scrollBefore = view.dom.scrollTop;

    const tr = state.tr
      .replaceWith(0, state.doc.content.size, newDoc.content)
      .setMeta("addToHistory", true);

    // Clamped, not mapped: the offsets shift by however many spaces the rules
    // inserted, so this is a best effort at "roughly where you were" rather
    // than an exact restoration. `TextSelection.near` snaps to the closest
    // valid text position, so it is safe at a node boundary.
    const maxPos = tr.doc.content.size;
    const caretAfter = Math.max(0, Math.min(caretBefore, maxPos));
    tr.setSelection(TextSelection.near(tr.doc.resolve(caretAfter)));

    dispatch(tr);
    view.dom.scrollTop = scrollBefore;
    view.focus();
    return true;
  } catch (error) {
    wysiwygAdapterError("Failed to apply document transform:", error);
    return false;
  }
}
