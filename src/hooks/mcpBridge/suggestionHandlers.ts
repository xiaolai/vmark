/**
 * MCP Bridge — AI Suggestion Handlers (barrel).
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

export {
  handleSetContent,
  handleInsertAtCursorWithSuggestion,
  handleInsertAtPositionWithSuggestion,
  handleSelectionReplaceWithSuggestion,
} from "./suggestion/insertHandlers";
export { handleDocumentReplaceInSourceWithSuggestion } from "./suggestion/replaceInSourceHandler";
export {
  handleSuggestionAccept,
  handleSuggestionReject,
  handleSuggestionList,
  handleSuggestionAcceptAll,
  handleSuggestionRejectAll,
} from "./suggestion/lifecycleHandlers";
