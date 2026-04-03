/**
 * MCP Bridge — Read-Only Guard
 *
 * Purpose: Blocks write operations when the active document is in read-only
 *   mode. Read operations (getContent, search, outline, etc.) pass through.
 *
 *   Uses an explicit set of write operation types. Unknown types pass through
 *   to the dispatcher's default handler.
 *
 * @coordinates-with index.ts — called before the switch dispatcher
 * @coordinates-with readOnlyGuard.ts (utils) — isActiveDocReadOnly()
 * @module hooks/mcpBridge/readOnlyGuard
 */

/**
 * Error message returned when a write tool is called on a read-only document.
 */
export const READ_ONLY_ERROR =
  "Document is in read-only mode. Toggle read-only mode off first.";

/**
 * Operation types that modify document content.
 * These are blocked when the active document is read-only.
 */
const WRITE_OPS = new Set([
  // Document write operations
  "document.setContent",
  "document.insertAtCursor",
  "document.insertAtPosition",
  "document.replaceInSource",
  // Selection mutation operations (set/move are navigation, not blocked)
  "selection.replace",
  "selection.delete",
  // Format operations
  "format.toggle",
  "format.setLink",
  "format.removeLink",
  "format.clear",
  // Editor mutation operations
  "editor.undo",
  "editor.redo",
  // Block operations
  "block.setType",
  "block.toggle",
  "block.insertHorizontalRule",
  // List operations
  "list.toggle",
  "list.increaseIndent",
  "list.decreaseIndent",
  // Table operations
  "table.insert",
  "table.delete",
  "table.addRowBefore",
  "table.addRowAfter",
  "table.deleteRow",
  "table.addColumnBefore",
  "table.addColumnAfter",
  "table.deleteColumn",
  "table.toggleHeaderRow",
  "table.batchModify",
  // List batch operations
  "list.batchModify",
  // VMark-specific insert operations
  "vmark.insertMathInline",
  "vmark.insertMathBlock",
  "vmark.insertMermaid",
  "vmark.insertMarkmap",
  "vmark.insertSvg",
  "vmark.insertWikiLink",
  "vmark.cjkPunctuationConvert",
  "vmark.cjkSpacingFix",
  "vmark.cjkFormat",
  // Mutation operations
  "mutation.batchEdit",
  "mutation.applyDiff",
  "mutation.replaceAnchored",
  // Section operations
  "section.update",
  "section.insert",
  "section.move",
  // Paragraph write operations
  "paragraph.write",
  // Smart insert and media
  "smartInsert",
  "insertMedia",
  // Suggestion operations (accept mutates)
  "suggestion.accept",
  "suggestion.acceptAll",
  // Genie invoke (may mutate)
  "genies.invoke",
]);

/**
 * Check if a given operation type is a write operation that should be
 * blocked in read-only mode.
 */
export function isBlockedInReadOnly(type: string): boolean {
  return WRITE_OPS.has(type);
}
