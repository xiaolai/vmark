/**
 * MCP Bridge — Document / selection / cursor / suggestion dispatcher.
 *
 * Returns `true` iff the request type matched a route here. The central
 * dispatcher chains these category sub-dispatchers and falls back to a
 * "Unknown request type" error when none claim the event.
 *
 * @module hooks/mcpBridge/dispatchers/documentDispatch
 */

import type { McpRequestEvent } from "../types";
import {
  handleGetContent,
  handleDocumentSearch,
  handleOutlineGet,
  handleMetadataGet,
} from "../documentHandlers";
import { handleSelectionGet, handleSelectionSet } from "../selectionHandlers";
import {
  handleSetContent,
  handleInsertAtCursorWithSuggestion,
  handleInsertAtPositionWithSuggestion,
  handleDocumentReplaceInSourceWithSuggestion,
  handleSelectionReplaceWithSuggestion,
  handleSuggestionAccept,
  handleSuggestionReject,
  handleSuggestionList,
  handleSuggestionAcceptAll,
  handleSuggestionRejectAll,
} from "../suggestionHandlers";
import { handleCursorGetContext, handleCursorSetPosition } from "../cursorHandlers";

export async function dispatchDocument(event: McpRequestEvent): Promise<boolean> {
  const { id, type, args } = event;
  switch (type) {
    // Document operations
    case "document.getContent":
      await handleGetContent(id);
      return true;
    case "document.setContent":
      // Only allowed on empty documents for safety
      await handleSetContent(id, args);
      return true;
    case "document.insertAtCursor":
      // Wrapped with suggestion for approval
      await handleInsertAtCursorWithSuggestion(id, args);
      return true;
    case "document.insertAtPosition":
      // Wrapped with suggestion for approval
      await handleInsertAtPositionWithSuggestion(id, args);
      return true;
    case "document.search":
      await handleDocumentSearch(id, args);
      return true;
    case "document.replaceInSource":
      // Wrapped with suggestion for approval (source-level replace)
      await handleDocumentReplaceInSourceWithSuggestion(id, args);
      return true;

    // Outline and metadata operations
    case "outline.get":
      await handleOutlineGet(id);
      return true;
    case "metadata.get":
      await handleMetadataGet(id);
      return true;

    // Selection operations
    case "selection.get":
      await handleSelectionGet(id);
      return true;
    case "selection.set":
      await handleSelectionSet(id, args);
      return true;
    case "selection.replace":
      // Wrapped with suggestion for approval
      await handleSelectionReplaceWithSuggestion(id, args);
      return true;

    // AI Suggestion operations
    case "suggestion.accept":
      await handleSuggestionAccept(id, args);
      return true;
    case "suggestion.reject":
      await handleSuggestionReject(id, args);
      return true;
    case "suggestion.list":
      await handleSuggestionList(id);
      return true;
    case "suggestion.acceptAll":
      await handleSuggestionAcceptAll(id);
      return true;
    case "suggestion.rejectAll":
      await handleSuggestionRejectAll(id);
      return true;

    // Cursor operations
    case "cursor.getContext":
      await handleCursorGetContext(id, args);
      return true;
    case "cursor.setPosition":
      await handleCursorSetPosition(id, args);
      return true;

    default:
      return false;
  }
}
