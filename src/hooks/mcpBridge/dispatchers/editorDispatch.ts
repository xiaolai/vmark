/**
 * MCP Bridge — Format / editor / block / list / table dispatcher.
 *
 * @module hooks/mcpBridge/dispatchers/editorDispatch
 */

import type { McpRequestEvent } from "../types";
import {
  handleFormatToggle,
  handleFormatSetLink,
  handleFormatRemoveLink,
  handleFormatClear,
} from "../formatHandlers";
import {
  handleUndo,
  handleRedo,
  handleFocus,
  handleGetUndoState,
  handleSetMode,
} from "../editorHandlers";
import {
  handleBlockSetType,
  handleListToggle,
  handleInsertHorizontalRule,
  handleListIncreaseIndent,
  handleListDecreaseIndent,
} from "../blockListHandlers";
import { handleTableInsert, handleTableDelete } from "../tableHandlers";

export async function dispatchEditor(event: McpRequestEvent): Promise<boolean> {
  const { id, type, args } = event;
  switch (type) {
    // Format operations
    case "format.toggle":
      await handleFormatToggle(id, args);
      return true;
    case "format.setLink":
      await handleFormatSetLink(id, args);
      return true;
    case "format.removeLink":
      await handleFormatRemoveLink(id);
      return true;
    case "format.clear":
      await handleFormatClear(id);
      return true;

    // Editor operations
    case "editor.undo":
      await handleUndo(id);
      return true;
    case "editor.redo":
      await handleRedo(id);
      return true;
    case "editor.focus":
      await handleFocus(id);
      return true;
    case "editor.getUndoState":
      await handleGetUndoState(id);
      return true;
    case "editor.setMode":
      await handleSetMode(id, args);
      return true;

    // Block operations
    case "block.setType":
      await handleBlockSetType(id, args);
      return true;
    case "block.insertHorizontalRule":
      await handleInsertHorizontalRule(id);
      return true;

    // List operations
    case "list.toggle":
      await handleListToggle(id, args);
      return true;
    case "list.increaseIndent":
      await handleListIncreaseIndent(id);
      return true;
    case "list.decreaseIndent":
      await handleListDecreaseIndent(id);
      return true;

    // Table operations
    case "table.insert":
      await handleTableInsert(id, args);
      return true;
    case "table.delete":
      await handleTableDelete(id);
      return true;

    default:
      return false;
  }
}
