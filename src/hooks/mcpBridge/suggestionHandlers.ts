/**
 * MCP Bridge — AI Suggestion Handlers
 *
 * Purpose: Wraps AI-generated content modifications in suggestions that require
 *   user approval before applying — preserves undo/redo integrity. When
 *   autoApproveEdits is enabled, changes apply directly without preview.
 *
 * Key decisions:
 *   - No document modifications until user accepts (safety first)
 *   - Suggestions stored in aiSuggestionStore for UI rendering
 *   - Accept/reject/list/accept-all/reject-all operations supported
 *   - Auto-approve mode bypasses preview for trusted AI workflows
 *
 * @coordinates-with aiSuggestionStore.ts — stores pending suggestions
 * @module hooks/mcpBridge/suggestionHandlers
 */

import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { respond, getEditor, isAutoApproveEnabled, getActiveTabId } from "./utils";

/**
 * Check if the editor document is empty.
 * Empty means: no text content (ignoring whitespace).
 */
function isDocumentEmpty(editor: ReturnType<typeof getEditor>): boolean {
  if (!editor) return false;
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

    const content = args.content as string;
    if (typeof content !== "string") {
      throw new Error("content must be a string");
    }

    // Parse markdown and set as document content
    // Don't add to history — content loading shouldn't be undoable
    const slice = createMarkdownPasteSlice(editor.state, content);
    const tr = editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, slice.content)
      .setMeta("addToHistory", false);
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

    const text = args.text as string;
    if (typeof text !== "string") {
      throw new Error("text must be a string");
    }

    const insertPos = editor.state.selection.from;

    // Auto-approve: apply directly without suggestion preview
    if (isAutoApproveEnabled()) {
      // Parse markdown and insert as rich content
      const slice = createMarkdownPasteSlice(editor.state, text);
      const tr = editor.state.tr.replaceSelection(slice);
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

    const text = args.text as string;
    const position = args.position as number;

    if (typeof text !== "string") {
      throw new Error("text must be a string");
    }
    if (typeof position !== "number") {
      throw new Error("position must be a number");
    }

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
      const tr = editor.state.tr.replaceRange(position, position, slice);
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

    const text = args.text as string;
    if (typeof text !== "string") {
      throw new Error("text must be a string");
    }

    const { from, to } = editor.state.selection;
    if (from === to) {
      // No selection - treat as insert at cursor
      return handleInsertAtCursorWithSuggestion(id, { text });
    }

    // Get original content that would be replaced
    const originalContent = editor.state.doc.textBetween(from, to, "\n");

    // Auto-approve: apply directly without suggestion preview
    if (isAutoApproveEnabled()) {
      // Parse markdown and replace selection with rich content
      const slice = createMarkdownPasteSlice(editor.state, text);
      const tr = editor.state.tr.replaceRange(from, to, slice);
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

/**
 * Handle document.replaceInSource - find/replace at the markdown source level.
 * Serializes the document to markdown, performs string replacement, then re-parses.
 * This bypasses ProseMirror node boundaries so it can match text across formatting marks.
 */
export async function handleDocumentReplaceInSourceWithSuggestion(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const search = args.search as string;
    const replace = args.replace as string;
    const replaceAll = (args.all as boolean) ?? false;

    if (typeof search !== "string" || search.length === 0) {
      throw new Error("search must be a non-empty string");
    }
    if (typeof replace !== "string") {
      throw new Error("replace must be a string");
    }

    // Serialize current document to markdown
    const markdown = serializeMarkdown(editor.state.schema, editor.state.doc);

    // Count non-overlapping matches (consistent with split/join replacement)
    const parts = markdown.split(search);
    const totalMatches = parts.length - 1;

    if (totalMatches === 0) {
      await respond({
        id,
        success: true,
        data: { count: 0, message: "No matches found" },
      });
      return;
    }

    const count = replaceAll ? totalMatches : 1;

    // Perform the replacement on the markdown string
    let newMarkdown: string;
    if (replaceAll) {
      newMarkdown = parts.join(replace);
    } else {
      const firstIdx = markdown.indexOf(search);
      newMarkdown =
        markdown.substring(0, firstIdx) +
        replace +
        markdown.substring(firstIdx + search.length);
    }

    // Auto-approve: parse and replace entire document
    if (isAutoApproveEnabled()) {
      const slice = createMarkdownPasteSlice(editor.state, newMarkdown);
      const tr = editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        slice.content
      );
      editor.view.dispatch(tr);

      await respond({
        id,
        success: true,
        data: {
          count,
          message: `${count} replacement(s) applied in source (auto-approved).`,
          applied: true,
        },
      });
      return;
    }

    // Suggestion mode: create a single whole-document replacement suggestion
    const suggestionId = useAiSuggestionStore.getState().addSuggestion({
      tabId: getActiveTabId(),
      type: "replace",
      from: 0,
      to: editor.state.doc.content.size,
      newContent: newMarkdown,
      originalContent: markdown,
    });

    await respond({
      id,
      success: true,
      data: {
        count,
        suggestionIds: [suggestionId],
        message: `${count} replacement(s) staged as suggestion. Awaiting user approval.`,
        applied: false,
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
 * Handle suggestion.accept request.
 * Accepts a specific suggestion by ID.
 */
export async function handleSuggestionAccept(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const suggestionId = args.suggestionId as string;
    if (typeof suggestionId !== "string") {
      throw new Error("suggestionId must be a string");
    }

    const store = useAiSuggestionStore.getState();
    const suggestion = store.getSuggestion(suggestionId);

    if (!suggestion) {
      throw new Error(`Suggestion not found: ${suggestionId}`);
    }

    store.acceptSuggestion(suggestionId);

    await respond({
      id,
      success: true,
      data: { message: "Suggestion accepted", suggestionId },
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
 * Handle suggestion.reject request.
 * Rejects a specific suggestion by ID.
 */
export async function handleSuggestionReject(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const suggestionId = args.suggestionId as string;
    if (typeof suggestionId !== "string") {
      throw new Error("suggestionId must be a string");
    }

    const store = useAiSuggestionStore.getState();
    const suggestion = store.getSuggestion(suggestionId);

    if (!suggestion) {
      throw new Error(`Suggestion not found: ${suggestionId}`);
    }

    store.rejectSuggestion(suggestionId);

    await respond({
      id,
      success: true,
      data: { message: "Suggestion rejected", suggestionId },
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
 * Handle suggestion.list request.
 * Returns all pending suggestions.
 */
export async function handleSuggestionList(id: string): Promise<void> {
  try {
    const store = useAiSuggestionStore.getState();
    const suggestions = store.getSortedSuggestions().map((s) => ({
      id: s.id,
      type: s.type,
      from: s.from,
      to: s.to,
      newContent: s.newContent,
      originalContent: s.originalContent,
      createdAt: s.createdAt,
    }));

    await respond({
      id,
      success: true,
      data: {
        suggestions,
        count: suggestions.length,
        focusedId: store.focusedSuggestionId,
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
 * Handle suggestion.acceptAll request.
 * Accepts all pending suggestions.
 */
export async function handleSuggestionAcceptAll(id: string): Promise<void> {
  try {
    const store = useAiSuggestionStore.getState();
    const count = store.suggestions.size;

    store.acceptAll();

    await respond({
      id,
      success: true,
      data: { message: `Accepted ${count} suggestions`, count },
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
 * Handle suggestion.rejectAll request.
 * Rejects all pending suggestions.
 */
export async function handleSuggestionRejectAll(id: string): Promise<void> {
  try {
    const store = useAiSuggestionStore.getState();
    const count = store.suggestions.size;

    store.rejectAll();

    await respond({
      id,
      success: true,
      data: { message: `Rejected ${count} suggestions`, count },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
