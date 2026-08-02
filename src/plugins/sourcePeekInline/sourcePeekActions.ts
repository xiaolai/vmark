/**
 * Source Peek Actions
 *
 * Open, commit, and revert operations for inline Source Peek.
 *
 * @coordinates-with sourcePeekEditor.ts (cleanupCMView)
 * @coordinates-with tiptap.ts (EDITING_STATE_CHANGED meta key)
 */

import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { peekStore } from "./peekStore";
import { hostSettings } from "@/plugins/shared/hostSettings";
import { hostDocument } from "@/plugins/shared/hostDocument";
import { applySourcePeekMarkdown, serializeSourcePeekRange, getExpandedSourcePeekRange } from "@/services/editor/sourcePeek";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { cleanupCMView } from "./sourcePeekEditor";

/**
 * Block types that should NOT use Source Peek.
 * These have their own editing mechanisms or no editable content.
 */
const SOURCE_PEEK_EXCLUDED_TYPES = new Set([
  "codeBlock",
  "code_block",
  "block_image",
  "frontmatter",
  "html_block",
  "horizontalRule",
]);

/** Meta key to signal editing state changes */
export const EDITING_STATE_CHANGED = "sourcePeekEditingChanged";

/**
 * Get current tab ID for unified history.
 */
function currentWindow(): string {
  return getCurrentWebviewWindow().label;
}

/**
 * Get markdown pipeline options.
 */
export function getMarkdownOptions() {
  const windowLabel = currentWindow();
  return {
    preserveLineBreaks: hostSettings.preserveLineBreaks(),
    hardBreakStyle: resolveHardBreakStyle(
      hostDocument.activeHardBreakStyle(windowLabel) as never,
      hostSettings.hardBreakStyleOnSave() as never
    ),
  };
}

/**
 * Check if a block type should use Source Peek.
 * Returns false for blocks with their own editing mechanisms.
 */
export function canUseSourcePeek(typeName: string): boolean {
  return !SOURCE_PEEK_EXCLUDED_TYPES.has(typeName);
}

/**
 * Open Source Peek for editing the block at cursor.
 * Creates a checkpoint in unified history for revert.
 * Returns false if the block type is excluded from Source Peek.
 */
/**
 * Whether an inline Source Peek is currently open.
 *
 * Exported so the editor keymap can ask without importing the store itself —
 * Escape and the sourcePeek chord both need "is it open?" to decide between
 * closing this and falling through (ADR-015).
 */
export function isSourcePeekOpen(): boolean {
  return peekStore().getState().isOpen;
}

export function openSourcePeekInline(view: EditorView): boolean {
  const range = getExpandedSourcePeekRange(view.state);

  // Get block type name for header
  const node = view.state.doc.nodeAt(range.from);
  const blockTypeName = node?.type.name ?? "unknown";

  // Skip excluded block types
  if (!canUseSourcePeek(blockTypeName)) {
    return false;
  }

  const options = getMarkdownOptions();
  const markdown = serializeSourcePeekRange(view.state, range, options);

  // Create checkpoint in unified history
  const windowLabel = currentWindow();
  hostDocument.checkpoint(windowLabel, {
    markdown: hostDocument.activeContent(windowLabel),
    mode: "wysiwyg",
  });

  // Open the store
  peekStore().getState().open({
    markdown,
    range,
    blockTypeName,
  });

  // Dispatch to trigger decoration rebuild
  const tr = view.state.tr.setMeta(EDITING_STATE_CHANGED, true);
  view.dispatch(tr);

  return true;
}

/**
 * Commit changes and close Source Peek.
 */
export function commitSourcePeek(view: EditorView): void {
  const store = peekStore().getState();
  const { markdown, range, originalMarkdown } = store;

  if (!range) return;

  // Check for empty content
  if (markdown.trim() === "") {
    // Create empty paragraph instead
    const paragraphType = view.state.schema.nodes.paragraph;
    if (paragraphType) {
      const emptyParagraph = paragraphType.create();
      const tr = view.state.tr.replaceWith(range.from, range.to, emptyParagraph);
      tr.setSelection(TextSelection.near(tr.doc.resolve(range.from)));
      tr.setMeta(EDITING_STATE_CHANGED, true);
      view.dispatch(tr);
    }
    store.close();
    cleanupCMView();
    view.focus();
    return;
  }

  // Only apply if content changed
  if (markdown !== originalMarkdown) {
    const options = getMarkdownOptions();
    applySourcePeekMarkdown(view, range, markdown, options);
  }

  store.close();
  cleanupCMView();

  // Dispatch to trigger decoration removal
  const tr = view.state.tr.setMeta(EDITING_STATE_CHANGED, true);
  view.dispatch(tr);

  view.focus();
}

/**
 * Revert to original content and close Source Peek.
 */
export function revertAndCloseSourcePeek(view: EditorView): void {
  const store = peekStore().getState();

  // Just close - no changes applied
  store.close();
  cleanupCMView();

  // Dispatch to trigger decoration removal
  const tr = view.state.tr.setMeta(EDITING_STATE_CHANGED, true);
  view.dispatch(tr);

  view.focus();
}
