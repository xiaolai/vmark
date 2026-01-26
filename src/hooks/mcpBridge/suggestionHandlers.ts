/**
 * MCP Bridge - AI Suggestion Handlers
 *
 * Wraps AI-generated content modifications in suggestions requiring user approval.
 * IMPORTANT: No document modifications until user accepts - preserves undo/redo integrity.
 *
 * When autoApproveEdits is enabled, changes are applied directly without preview.
 */

import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { respond, getEditor } from "./utils";

/**
 * Check if auto-approve is enabled for MCP edits.
 */
function isAutoApproveEnabled(): boolean {
  return useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
}

/**
 * Handle document.setContent request - BLOCKED for AI safety.
 * AI should not be able to replace the entire document.
 */
export async function handleSetContentBlocked(id: string): Promise<void> {
  await respond({
    id,
    success: false,
    error:
      "document.setContent is disabled for AI safety. Use document.insertAtCursor or selection.replace instead.",
  });
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
      editor.commands.insertContent(text);
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
      // Set selection to position and insert
      editor.chain().setTextSelection(position).insertContent(text).run();
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
 * Handle document.replace with suggestion wrapping.
 * If autoApproveEdits is enabled, applies directly. Otherwise creates suggestions.
 */
export async function handleDocumentReplaceWithSuggestion(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const search = args.search as string;
    const replace = args.replace as string;
    const replaceAll = (args.all as boolean) ?? false;

    if (typeof search !== "string") {
      throw new Error("search must be a string");
    }
    if (typeof replace !== "string") {
      throw new Error("replace must be a string");
    }

    // Find all matches in the document
    const doc = editor.state.doc;
    const matches: Array<{ from: number; to: number }> = [];

    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        let searchPos = 0;
        while (searchPos < node.text.length) {
          const idx = node.text.indexOf(search, searchPos);
          if (idx === -1) break;

          // Convert node-relative position to document position
          const from = pos + idx;
          const to = from + search.length;
          matches.push({ from, to });

          if (!replaceAll) return false; // Stop traversal after first match
          searchPos = idx + 1;
        }
      }
    });

    if (matches.length === 0) {
      await respond({
        id,
        success: true,
        data: { count: 0, message: "No matches found" },
      });
      return;
    }

    // Auto-approve: apply replacements directly
    if (isAutoApproveEnabled()) {
      // Apply in reverse order to maintain correct positions
      const chain = editor.chain();
      for (const match of [...matches].reverse()) {
        chain.setTextSelection({ from: match.from, to: match.to }).insertContent(replace);
      }
      chain.run();

      await respond({
        id,
        success: true,
        data: {
          count: matches.length,
          message: `${matches.length} replacement(s) applied (auto-approved).`,
        },
      });
      return;
    }

    // Create suggestions in reverse order to maintain correct positions
    const suggestionIds: string[] = [];
    const reversedMatches = [...matches].reverse();

    for (const match of reversedMatches) {
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        type: "replace",
        from: match.from,
        to: match.to,
        newContent: replace,
        originalContent: search,
      });
      suggestionIds.unshift(suggestionId); // Maintain original order in response
    }

    await respond({
      id,
      success: true,
      data: {
        suggestionIds,
        count: matches.length,
        message: `${matches.length} replacement(s) staged as suggestions. Awaiting user approval.`,
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
      editor.chain().setTextSelection({ from, to }).insertContent(text).run();
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
 * Handle selection.delete with suggestion wrapping.
 * If autoApproveEdits is enabled, deletes directly. Otherwise marks for deletion.
 */
export async function handleSelectionDeleteWithSuggestion(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const { from, to } = editor.state.selection;
    if (from === to) {
      throw new Error("No text selected");
    }

    // Get content that would be deleted
    const originalContent = editor.state.doc.textBetween(from, to, "\n");

    // Auto-approve: delete directly without suggestion preview
    if (isAutoApproveEnabled()) {
      editor.chain().setTextSelection({ from, to }).deleteSelection().run();
      await respond({
        id,
        success: true,
        data: {
          message: "Selection deleted (auto-approved).",
          range: { from, to },
          content: originalContent,
        },
      });
      return;
    }

    // Create suggestion - content shown with strikethrough decoration
    const suggestionId = useAiSuggestionStore.getState().addSuggestion({
      type: "delete",
      from,
      to,
      originalContent,
    });

    await respond({
      id,
      success: true,
      data: {
        suggestionId,
        message: "Content marked for deletion. Awaiting user approval.",
        range: { from, to },
        content: originalContent,
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
