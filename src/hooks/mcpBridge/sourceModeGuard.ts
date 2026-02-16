/**
 * MCP Bridge — Source Mode Guard
 *
 * Purpose: Blocks editor-dependent MCP tools when source mode is active.
 *   WYSIWYG (Tiptap) tools fail silently or cause desync in source mode,
 *   so we reject them early with a clear error message.
 *
 *   Uses an explicit blocklist of editor-dependent operations. Unknown
 *   operation types pass through to the dispatcher's default handler
 *   (which returns "Unknown request type"), avoiding misleading errors.
 *
 * @coordinates-with index.ts — called before the switch dispatcher
 * @coordinates-with editorStore.ts — reads sourceMode state
 * @module hooks/mcpBridge/sourceModeGuard
 */

/**
 * Error message returned when an editor-dependent tool is called in source mode.
 */
export const SOURCE_MODE_ERROR =
  "This tool requires WYSIWYG mode. Call editor.setMode with mode \"wysiwyg\" first, then retry.";

/**
 * Operation types that require WYSIWYG (Tiptap) mode.
 * These are blocked when source mode is active.
 *
 * Unknown types are NOT blocked — they pass through to the dispatcher's
 * default "unknown type" handler for proper error reporting.
 */
const EDITOR_DEPENDENT_OPS = new Set([
  // Document operations (read/write Tiptap state)
  "document.getContent",
  "document.setContent",
  "document.insertAtCursor",
  "document.insertAtPosition",
  "document.search",
  "document.replaceInSource",
  // Outline and metadata (read Tiptap DOM)
  "outline.get",
  "metadata.get",
  // Selection operations (Tiptap selection API)
  "selection.get",
  "selection.set",
  "selection.replace",
  // Suggestion operations (Tiptap suggestion marks)
  "suggestion.accept",
  "suggestion.reject",
  "suggestion.list",
  "suggestion.acceptAll",
  "suggestion.rejectAll",
  // Cursor operations (Tiptap cursor position)
  "cursor.getContext",
  "cursor.setPosition",
  // Format operations (Tiptap marks)
  "format.toggle",
  "format.setLink",
  "format.removeLink",
  "format.clear",
  // Editor focus (Tiptap DOM focus)
  "editor.focus",
  // Block operations (Tiptap node types)
  "block.setType",
  "block.insertHorizontalRule",
  // List operations (Tiptap list nodes)
  "list.toggle",
  "list.increaseIndent",
  "list.decreaseIndent",
  // Table operations (Tiptap table nodes)
  "table.insert",
  "table.delete",
  // VMark-specific insert operations (Tiptap custom nodes)
  "vmark.insertMathInline",
  "vmark.insertMathBlock",
  "vmark.insertMermaid",
  "vmark.insertMarkmap",
  "vmark.insertSvg",
  "vmark.insertWikiLink",
  "vmark.cjkPunctuationConvert",
  "vmark.cjkSpacingFix",
  // Structure operations (read Tiptap AST)
  "structure.getAst",
  "structure.getDigest",
  "structure.listBlocks",
  "structure.resolveTargets",
  "structure.getSection",
  // Mutation operations (Tiptap transactions)
  "mutation.batchEdit",
  "mutation.applyDiff",
  "mutation.replaceAnchored",
  // Section operations (Tiptap node manipulation)
  "section.update",
  "section.insert",
  "section.move",
  // Paragraph operations (Tiptap node access)
  "paragraph.read",
  "paragraph.write",
  // Smart insert and media (Tiptap insertion)
  "smartInsert",
  "insertMedia",
  // Batch operations (Tiptap table/list manipulation)
  "table.batchModify",
  "list.batchModify",
]);

/**
 * Check if a given operation type should be blocked in source mode.
 *
 * @returns true if the operation is a known editor-dependent type
 *   that requires WYSIWYG mode. Unknown types return false so they
 *   reach the dispatcher's default "unknown type" handler.
 */
export function isBlockedInSourceMode(type: string): boolean {
  return EDITOR_DEPENDENT_OPS.has(type);
}
