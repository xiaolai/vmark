/**
 * MCP Bridge Hook — Central Dispatcher
 *
 * Purpose: Listens for mcp-bridge:request events from the Rust MCP server
 *   and routes each request to the appropriate handler module based on
 *   the operation type (document, selection, mutation, structure, etc.).
 *
 * Pipeline: AI client → MCP server (Rust) → WebSocket → Tauri event
 *   "mcp-bridge:request" → this dispatcher → handler function → respond()
 *   back to Rust → MCP server → AI client
 *
 * Key decisions:
 *   - Single switch statement routes ~60 operation types to handler functions
 *   - Handlers organized by domain: document, selection, mutation, structure, etc.
 *   - All mutations wrapped in AI suggestion layer for user approval
 *   - Idempotency cache prevents duplicate execution of identical requests
 *
 * @coordinates-with utils.ts — respond(), getEditor(), resolveWindowId()
 * @coordinates-with types.ts — McpRequestEvent, McpResponse
 * @module hooks/mcpBridge
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { McpRequestEvent, McpRequestEventRaw } from "./types";
import { respond } from "./utils";

// Document handlers (read-only operations)
import {
  handleGetContent,
  handleDocumentSearch,
  handleOutlineGet,
  handleMetadataGet,
} from "./documentHandlers";

// Selection handlers
import { handleSelectionGet, handleSelectionSet } from "./selectionHandlers";

// AI Suggestion handlers (wrap content modifications for approval)
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
import { handleUndo, handleRedo, handleFocus, handleGetUndoState } from "./editorHandlers";

// Block and list handlers
import {
  handleBlockSetType,
  handleListToggle,
  handleInsertHorizontalRule,
  handleListIncreaseIndent,
  handleListDecreaseIndent,
} from "./blockListHandlers";

// Table handlers
import {
  handleTableInsert,
  handleTableDelete,
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
  handleWorkspaceListRecentFiles,
  handleWorkspaceGetInfo,
  handleWorkspaceReloadDocument,
} from "./workspaceHandlers";

// Tab handlers
import {
  handleTabsList,
  handleTabsSwitch,
  handleTabsClose,
  handleTabsCreate,
  handleTabsGetInfo,
  handleTabsReopenClosed,
} from "./tabHandlers";

// VMark-specific handlers
import {
  handleInsertMathInline,
  handleInsertMathBlock,
  handleInsertMermaid,
  handleInsertMarkmap,
  handleInsertSvg,
  handleInsertWikiLink,
  handleCjkPunctuationConvert,
  handleCjkSpacingFix,
} from "./vmarkHandlers";

// Protocol handlers (AI-Oriented MCP Design)
import {
  handleGetCapabilities,
  handleGetRevision,
} from "./protocolHandlers";

// Structure handlers (AI-Oriented MCP Design)
import {
  handleGetAst,
  handleGetDigest,
  handleListBlocks,
  handleResolveTargets,
  handleGetSection,
} from "./structureHandlers";

// Mutation handlers (AI-Oriented MCP Design)
import {
  handleBatchEdit,
  handleApplyDiff,
  handleReplaceAnchored,
} from "./mutationHandlers";

// Section handlers (AI-Oriented MCP Design)
import {
  handleSectionUpdate,
  handleSectionInsert,
  handleSectionMove,
} from "./sectionHandlers";

// Paragraph handlers (for flat documents without headings)
import {
  handleParagraphRead,
  handleParagraphWrite,
} from "./paragraphHandlers";

// Smart insert handlers
import { handleSmartInsert } from "./smartInsertHandlers";

// Batch operation handlers (AI-Oriented MCP Design)
import {
  handleTableBatchModify,
  handleListBatchModify,
} from "./batchOpHandlers";

// Genie handlers
import {
  handleGeniesList,
  handleGeniesRead,
  handleGeniesInvoke,
} from "./genieHandlers";

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
        // Only allowed on empty documents for safety
        await handleSetContent(id, args);
        break;
      case "document.insertAtCursor":
        // Wrapped with suggestion for approval
        await handleInsertAtCursorWithSuggestion(id, args);
        break;
      case "document.insertAtPosition":
        // Wrapped with suggestion for approval
        await handleInsertAtPositionWithSuggestion(id, args);
        break;
      case "document.search":
        await handleDocumentSearch(id, args);
        break;
      case "document.replaceInSource":
        // Wrapped with suggestion for approval (source-level replace)
        await handleDocumentReplaceInSourceWithSuggestion(id, args);
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
      case "editor.getUndoState":
        await handleGetUndoState(id);
        break;

      // Block operations
      case "block.setType":
        await handleBlockSetType(id, args);
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
      case "table.delete":
        await handleTableDelete(id);
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
      case "workspace.listRecentFiles":
        await handleWorkspaceListRecentFiles(id);
        break;
      case "workspace.getInfo":
        await handleWorkspaceGetInfo(id);
        break;
      case "workspace.reloadDocument":
        await handleWorkspaceReloadDocument(id, args);
        break;

      // Tab operations
      case "tabs.list":
        await handleTabsList(id, args);
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
      case "tabs.reopenClosed":
        await handleTabsReopenClosed(id, args);
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
      case "vmark.insertMarkmap":
        await handleInsertMarkmap(id, args);
        break;
      case "vmark.insertSvg":
        await handleInsertSvg(id, args);
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

      // Protocol operations (AI-Oriented MCP Design)
      case "protocol.getCapabilities":
        await handleGetCapabilities(id);
        break;
      case "protocol.getRevision":
        await handleGetRevision(id);
        break;

      // Structure operations (AI-Oriented MCP Design)
      case "structure.getAst":
        await handleGetAst(id, args);
        break;
      case "structure.getDigest":
        await handleGetDigest(id);
        break;
      case "structure.listBlocks":
        await handleListBlocks(id, args);
        break;
      case "structure.resolveTargets":
        await handleResolveTargets(id, args);
        break;
      case "structure.getSection":
        await handleGetSection(id, args);
        break;

      // Mutation operations (AI-Oriented MCP Design)
      case "mutation.batchEdit":
        await handleBatchEdit(id, args);
        break;
      case "mutation.applyDiff":
        await handleApplyDiff(id, args);
        break;
      case "mutation.replaceAnchored":
        await handleReplaceAnchored(id, args);
        break;

      // Section operations (AI-Oriented MCP Design)
      case "section.update":
        await handleSectionUpdate(id, args);
        break;
      case "section.insert":
        await handleSectionInsert(id, args);
        break;
      case "section.move":
        await handleSectionMove(id, args);
        break;

      // Paragraph operations (for flat documents without headings)
      case "paragraph.read":
        await handleParagraphRead(id, args);
        break;
      case "paragraph.write":
        await handleParagraphWrite(id, args);
        break;

      // Smart insert (intuitive insertion at common locations)
      case "smartInsert":
        await handleSmartInsert(id, args);
        break;

      // Batch operations (AI-Oriented MCP Design)
      case "table.batchModify":
        await handleTableBatchModify(id, args);
        break;
      case "list.batchModify":
        await handleListBatchModify(id, args);
        break;

      // Genie operations
      case "genies.list":
        await handleGeniesList(id);
        break;
      case "genies.read":
        await handleGeniesRead(id, args);
        break;
      case "genies.invoke":
        await handleGeniesInvoke(id, args);
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
 *
 * Note: Properly handles React Strict Mode double-mount by tracking
 * mounted state and cleaning up async listener registration.
 */
export function useMcpBridge(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    listen<McpRequestEventRaw>("mcp-bridge:request", (event) => {
      // Parse args_json to avoid Tauri IPC double-encoding issues
      const raw = event.payload;

      if (import.meta.env.DEV) {
        console.debug("[MCP Bridge] Event received:", raw.type, raw.id);
      }

      // Try both snake_case and camelCase (Tauri might convert)
      const argsJsonStr = raw.args_json ?? raw.argsJson ?? "{}";

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsJsonStr);
      } catch {
        // Malformed JSON - respond with error (fire-and-forget with error logging)
        respond({
          id: raw.id,
          success: false,
          error: "Invalid JSON in request args",
        }).catch((err) => {
          console.error("[MCP Bridge] Failed to respond to malformed request:", err);
        });
        return;
      }

      const parsed: McpRequestEvent = {
        id: raw.id,
        type: raw.type,
        args,
      };
      // Fire-and-forget with error logging to prevent unhandled rejections
      handleRequest(parsed).catch((err) => {
        console.error("[MCP Bridge] Unhandled error in request handler:", err);
      });
    }).then((fn) => {
      // If unmounted before Promise resolved, clean up immediately
      if (!mounted) {
        fn();
        return;
      }
      unlisten = fn;
    }).catch((err) => {
      console.error("[MCP Bridge] Failed to register event listener:", err);
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);
}
