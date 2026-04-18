/**
 * AI suggestion handlers that CREATE suggestions or apply insertions.
 *
 * Covers: document.setContent, document.insertAtCursor, document.insertAtPosition,
 * selection.replace. Each honors `autoApproveEdits` — when enabled, changes
 * apply directly; otherwise the change is staged as an aiSuggestionStore entry
 * for user approval.
 *
 * @module hooks/mcpBridge/suggestion/insertHandlers
 */

import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import { respond, getEditor, isAutoApproveEnabled, getActiveTabId } from "../utils";
import { requireString, requireNumber } from "../validateArgs";

/** Check if the editor document is empty (no text content, ignoring whitespace). */
function isDocumentEmpty(editor: ReturnType<typeof getEditor>): boolean {
  /* v8 ignore start -- null editor path not exercised in tests */
  if (!editor) return false;
  /* v8 ignore stop */
  const text = editor.state.doc.textContent.trim();
  return text.length === 0;
}

/**
 * Handle document.setContent request.
 * Only allowed when document is empty (nothing to accidentally overwrite).
 * Otherwise blocked for AI safety.
 */
export async function handleSetContent(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    // Only allow setContent on empty documents
    if (!isDocumentEmpty(editor)) {
      await respond({
        id,
        success: false,
        error:
          "document.setContent is only allowed on empty documents. " +
          "Use document.insertAtCursor, apply_diff, or selection.replace for non-empty documents.",
      });
      return;
    }

    const content = requireString(args, "content");

    // Parse markdown and set as document content
    // Don't add to history — content loading shouldn't be undoable
    const slice = createMarkdownPasteSlice(editor.state, content);
    const tr = editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, slice.content)
      .setMeta("addToHistory", false)
      .scrollIntoView();
    editor.view.dispatch(tr);

    await respond({
      id,
      success: true,
      data: { message: "Document content set successfully." },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle document.insertAtCursor with suggestion wrapping.
 * If autoApproveEdits is enabled, applies directly. Otherwise stores suggestion for preview.
 */
export async function handleInsertAtCursorWithSuggestion(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const text = requireString(args, "text");

    const insertPos = editor.state.selection.from;

    // Auto-approve: apply directly without suggestion preview
    if (isAutoApproveEnabled()) {
      // Parse markdown and insert as rich content
      const slice = createMarkdownPasteSlice(editor.state, text);
      const tr = editor.state.tr.replaceSelection(slice).scrollIntoView();
      editor.view.dispatch(tr);
      await respond({
        id,
        success: true,
        data: {
          message: "Content inserted (auto-approved).",
          position: insertPos,
        },
      });
      return;
    }

    // Create suggestion WITHOUT modifying the document
    // Content will be shown as ghost text decoration
    const suggestionId = useAiSuggestionStore.getState().addSuggestion({
      tabId: getActiveTabId(),
      type: "insert",
      from: insertPos,
      to: insertPos, // Same position - insert point
      newContent: text,
    });

    await respond({
      id,
      success: true,
      data: {
        suggestionId,
        message: "Content staged as suggestion. Awaiting user approval.",
        position: insertPos,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle document.insertAtPosition with suggestion wrapping.
 * If autoApproveEdits is enabled, applies directly. Otherwise stores suggestion for preview.
 */
export async function handleInsertAtPositionWithSuggestion(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const text = requireString(args, "text");
    const position = requireNumber(args, "position");

    // Validate position is within document bounds
    const docSize = editor.state.doc.content.size;
    if (position < 0 || position > docSize) {
      throw new Error(`Invalid position: ${position} (document size: ${docSize})`);
    }

    // Auto-approve: apply directly without suggestion preview
    if (isAutoApproveEnabled()) {
      // Parse markdown and insert as rich content at position
      // Use replaceRange to preserve slice open depth and block structure
      const slice = createMarkdownPasteSlice(editor.state, text);
      const tr = editor.state.tr.replaceRange(position, position, slice).scrollIntoView();
      editor.view.dispatch(tr);
      await respond({
        id,
        success: true,
        data: {
          message: "Content inserted (auto-approved).",
          position,
        },
      });
      return;
    }

    // Create suggestion WITHOUT modifying the document
    const suggestionId = useAiSuggestionStore.getState().addSuggestion({
      tabId: getActiveTabId(),
      type: "insert",
      from: position,
      to: position,
      newContent: text,
    });

    await respond({
      id,
      success: true,
      data: {
        suggestionId,
        message: "Content staged as suggestion. Awaiting user approval.",
        position,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle selection.replace with suggestion wrapping.
 * If autoApproveEdits is enabled, applies directly. Otherwise stores suggestion for preview.
 */
export async function handleSelectionReplaceWithSuggestion(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const text = requireString(args, "text");

    const { from, to } = editor.state.selection;
    if (from === to) {
      // No selection - treat as insert at cursor
      await handleInsertAtCursorWithSuggestion(id, { text });
      return;
    }

    // Get original content that would be replaced
    const originalContent = editor.state.doc.textBetween(from, to, "\n");

    // Auto-approve: apply directly without suggestion preview
    if (isAutoApproveEnabled()) {
      // Parse markdown and replace selection with rich content
      const slice = createMarkdownPasteSlice(editor.state, text);
      const tr = editor.state.tr.replaceRange(from, to, slice).scrollIntoView();
      editor.view.dispatch(tr);
      await respond({
        id,
        success: true,
        data: {
          message: "Selection replaced (auto-approved).",
          range: { from, to },
          originalContent,
        },
      });
      return;
    }

    // Create suggestion WITHOUT modifying the document
    // Original content shown with strikethrough, new content as ghost text
    const suggestionId = useAiSuggestionStore.getState().addSuggestion({
      tabId: getActiveTabId(),
      type: "replace",
      from,
      to,
      newContent: text,
      originalContent,
    });

    await respond({
      id,
      success: true,
      data: {
        suggestionId,
        message: "Replacement staged as suggestion. Awaiting user approval.",
        range: { from, to },
        originalContent,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
