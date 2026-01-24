/**
 * MCP Bridge Hook - Handles MCP requests from AI assistants.
 *
 * Listens for mcp-bridge:request events from Tauri and executes
 * the corresponding editor operations.
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { McpRequestEvent } from "./types";
import { respond } from "./utils";

// Document handlers
import {
  handleGetContent,
  handleInsertAtPosition,
  handleDocumentSearch,
  handleDocumentReplace,
  handleOutlineGet,
  handleMetadataGet,
} from "./documentHandlers";

// Selection handlers
import { handleSelectionGet, handleSelectionSet } from "./selectionHandlers";

// AI Suggestion handlers (wrap content modifications for approval)
import {
  handleSetContentBlocked,
  handleInsertAtCursorWithSuggestion,
  handleSelectionReplaceWithSuggestion,
  handleSelectionDeleteWithSuggestion,
  handleSuggestionAccept,
  handleSuggestionReject,
  handleSuggestionList,
  handleSuggestionAcceptAll,
  handleSuggestionRejectAll,
} from "./suggestionHandlers";

// Cursor handlers
import { handleCursorGetContext, handleCursorSetPosition } from "./cursorHandlers";

// Format handlers
import {
  handleFormatToggle,
  handleFormatSetLink,
  handleFormatRemoveLink,
  handleFormatClear,
} from "./formatHandlers";

// Editor handlers
import { handleUndo, handleRedo, handleFocus } from "./editorHandlers";

// Block and list handlers
import {
  handleBlockSetType,
  handleBlockToggle,
  handleListToggle,
  handleInsertHorizontalRule,
  handleListIncreaseIndent,
  handleListDecreaseIndent,
} from "./blockListHandlers";

// Table handlers
import {
  handleTableInsert,
  handleTableAddRowBefore,
  handleTableAddRowAfter,
  handleTableAddColumnBefore,
  handleTableAddColumnAfter,
  handleTableDelete,
  handleTableDeleteRow,
  handleTableDeleteColumn,
  handleTableToggleHeaderRow,
} from "./tableHandlers";

// Workspace handlers
import {
  handleWindowsList,
  handleWindowsGetFocused,
  handleWindowsFocus,
  handleWorkspaceNewDocument,
  handleWorkspaceOpenDocument,
  handleWorkspaceSaveDocument,
  handleWorkspaceSaveDocumentAs,
  handleWorkspaceGetDocumentInfo,
  handleWorkspaceCloseWindow,
  handleAiNotImplemented,
} from "./workspaceHandlers";

// Tab handlers
import {
  handleTabsList,
  handleTabsGetActive,
  handleTabsSwitch,
  handleTabsClose,
  handleTabsCreate,
  handleTabsGetInfo,
} from "./tabHandlers";

// VMark-specific handlers
import {
  handleInsertMathInline,
  handleInsertMathBlock,
  handleInsertMermaid,
  handleInsertWikiLink,
  handleCjkPunctuationConvert,
  handleCjkSpacingFix,
} from "./vmarkHandlers";

/**
 * Route MCP request to appropriate handler.
 */
async function handleRequest(event: McpRequestEvent): Promise<void> {
  const { id, type, args } = event;

  try {
    switch (type) {
      // Document operations
      case "document.getContent":
        await handleGetContent(id);
        break;
      case "document.setContent":
        // BLOCKED: AI cannot replace entire document for safety
        await handleSetContentBlocked(id);
        break;
      case "document.insertAtCursor":
        // Wrapped with suggestion for approval
        await handleInsertAtCursorWithSuggestion(id, args);
        break;
      case "document.insertAtPosition":
        await handleInsertAtPosition(id, args);
        break;
      case "document.search":
        await handleDocumentSearch(id, args);
        break;
      case "document.replace":
        await handleDocumentReplace(id, args);
        break;

      // Outline and metadata operations
      case "outline.get":
        await handleOutlineGet(id);
        break;
      case "metadata.get":
        await handleMetadataGet(id);
        break;

      // Selection operations
      case "selection.get":
        await handleSelectionGet(id);
        break;
      case "selection.set":
        await handleSelectionSet(id, args);
        break;
      case "selection.replace":
        // Wrapped with suggestion for approval
        await handleSelectionReplaceWithSuggestion(id, args);
        break;
      case "selection.delete":
        // Wrapped with suggestion for approval (soft delete)
        await handleSelectionDeleteWithSuggestion(id);
        break;

      // AI Suggestion operations
      case "suggestion.accept":
        await handleSuggestionAccept(id, args);
        break;
      case "suggestion.reject":
        await handleSuggestionReject(id, args);
        break;
      case "suggestion.list":
        await handleSuggestionList(id);
        break;
      case "suggestion.acceptAll":
        await handleSuggestionAcceptAll(id);
        break;
      case "suggestion.rejectAll":
        await handleSuggestionRejectAll(id);
        break;

      // Cursor operations
      case "cursor.getContext":
        await handleCursorGetContext(id, args);
        break;
      case "cursor.setPosition":
        await handleCursorSetPosition(id, args);
        break;

      // Format operations
      case "format.toggle":
        await handleFormatToggle(id, args);
        break;
      case "format.setLink":
        await handleFormatSetLink(id, args);
        break;
      case "format.removeLink":
        await handleFormatRemoveLink(id);
        break;
      case "format.clear":
        await handleFormatClear(id);
        break;

      // Editor operations
      case "editor.undo":
        await handleUndo(id);
        break;
      case "editor.redo":
        await handleRedo(id);
        break;
      case "editor.focus":
        await handleFocus(id);
        break;

      // Block operations
      case "block.setType":
        await handleBlockSetType(id, args);
        break;
      case "block.toggle":
        await handleBlockToggle(id, args);
        break;
      case "block.insertHorizontalRule":
        await handleInsertHorizontalRule(id);
        break;

      // List operations
      case "list.toggle":
        await handleListToggle(id, args);
        break;
      case "list.increaseIndent":
        await handleListIncreaseIndent(id);
        break;
      case "list.decreaseIndent":
        await handleListDecreaseIndent(id);
        break;

      // Table operations
      case "table.insert":
        await handleTableInsert(id, args);
        break;
      case "table.addRowBefore":
        await handleTableAddRowBefore(id);
        break;
      case "table.addRowAfter":
        await handleTableAddRowAfter(id);
        break;
      case "table.addColumnBefore":
        await handleTableAddColumnBefore(id);
        break;
      case "table.addColumnAfter":
        await handleTableAddColumnAfter(id);
        break;
      case "table.delete":
        await handleTableDelete(id);
        break;
      case "table.deleteRow":
        await handleTableDeleteRow(id);
        break;
      case "table.deleteColumn":
        await handleTableDeleteColumn(id);
        break;
      case "table.toggleHeaderRow":
        await handleTableToggleHeaderRow(id);
        break;

      // Window operations
      case "windows.list":
        await handleWindowsList(id);
        break;
      case "windows.getFocused":
        await handleWindowsGetFocused(id);
        break;
      case "windows.focus":
        await handleWindowsFocus(id, args);
        break;

      // Workspace operations
      case "workspace.newDocument":
        await handleWorkspaceNewDocument(id);
        break;
      case "workspace.openDocument":
        await handleWorkspaceOpenDocument(id, args);
        break;
      case "workspace.saveDocument":
        await handleWorkspaceSaveDocument(id);
        break;
      case "workspace.saveDocumentAs":
        await handleWorkspaceSaveDocumentAs(id, args);
        break;
      case "workspace.getDocumentInfo":
        await handleWorkspaceGetDocumentInfo(id, args);
        break;
      case "workspace.closeWindow":
        await handleWorkspaceCloseWindow(id, args);
        break;

      // Tab operations
      case "tabs.list":
        await handleTabsList(id, args);
        break;
      case "tabs.getActive":
        await handleTabsGetActive(id, args);
        break;
      case "tabs.switch":
        await handleTabsSwitch(id, args);
        break;
      case "tabs.close":
        await handleTabsClose(id, args);
        break;
      case "tabs.create":
        await handleTabsCreate(id, args);
        break;
      case "tabs.getInfo":
        await handleTabsGetInfo(id, args);
        break;

      // VMark-specific operations
      case "vmark.insertMathInline":
        await handleInsertMathInline(id, args);
        break;
      case "vmark.insertMathBlock":
        await handleInsertMathBlock(id, args);
        break;
      case "vmark.insertMermaid":
        await handleInsertMermaid(id, args);
        break;
      case "vmark.insertWikiLink":
        await handleInsertWikiLink(id, args);
        break;
      case "vmark.cjkPunctuationConvert":
        await handleCjkPunctuationConvert(id, args);
        break;
      case "vmark.cjkSpacingFix":
        await handleCjkSpacingFix(id, args);
        break;

      // AI operations (not implemented - require external AI service)
      case "ai.improveWriting":
      case "ai.fixGrammar":
      case "ai.translate":
      case "ai.summarize":
      case "ai.expand":
        await handleAiNotImplemented(id, type);
        break;

      default:
        await respond({
          id,
          success: false,
          error: `Unknown request type: ${type}`,
        });
    }
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Hook to enable MCP bridge request handling.
 * Should be used once in the main app component.
 */
export function useMcpBridge(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<McpRequestEvent>("mcp-bridge:request", (event) => {
      handleRequest(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
