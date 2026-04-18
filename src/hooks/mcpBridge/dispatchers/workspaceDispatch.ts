/**
 * MCP Bridge — Workspace / tabs / windows / genies dispatcher.
 *
 * @module hooks/mcpBridge/dispatchers/workspaceDispatch
 */

import type { McpRequestEvent } from "../types";
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
} from "../workspaceHandlers";
import {
  handleTabsList,
  handleTabsGetActive,
  handleTabsSwitch,
  handleTabsClose,
  handleTabsCreate,
  handleTabsGetInfo,
  handleTabsReopenClosed,
} from "../tabHandlers";
import {
  handleGeniesList,
  handleGeniesRead,
  handleGeniesInvoke,
} from "../genieHandlers";

export async function dispatchWorkspace(event: McpRequestEvent): Promise<boolean> {
  const { id, type, args } = event;
  switch (type) {
    // Window operations
    case "windows.list":
      await handleWindowsList(id);
      return true;
    case "windows.getFocused":
      await handleWindowsGetFocused(id);
      return true;
    case "windows.focus":
      await handleWindowsFocus(id, args);
      return true;

    // Workspace operations
    case "workspace.newDocument":
      await handleWorkspaceNewDocument(id);
      return true;
    case "workspace.openDocument":
      await handleWorkspaceOpenDocument(id, args);
      return true;
    case "workspace.saveDocument":
      await handleWorkspaceSaveDocument(id);
      return true;
    case "workspace.saveDocumentAs":
      await handleWorkspaceSaveDocumentAs(id, args);
      return true;
    case "workspace.getDocumentInfo":
      await handleWorkspaceGetDocumentInfo(id, args);
      return true;
    case "workspace.closeWindow":
      await handleWorkspaceCloseWindow(id, args);
      return true;
    case "workspace.listRecentFiles":
      await handleWorkspaceListRecentFiles(id);
      return true;
    case "workspace.getInfo":
      await handleWorkspaceGetInfo(id);
      return true;
    case "workspace.reloadDocument":
      await handleWorkspaceReloadDocument(id, args);
      return true;

    // Tab operations
    case "tabs.list":
      await handleTabsList(id, args);
      return true;
    case "tabs.getActive":
      await handleTabsGetActive(id, args);
      return true;
    case "tabs.switch":
      await handleTabsSwitch(id, args);
      return true;
    case "tabs.close":
      await handleTabsClose(id, args);
      return true;
    case "tabs.create":
      await handleTabsCreate(id, args);
      return true;
    case "tabs.getInfo":
      await handleTabsGetInfo(id, args);
      return true;
    case "tabs.reopenClosed":
      await handleTabsReopenClosed(id, args);
      return true;

    // Genie operations
    case "genies.list":
      await handleGeniesList(id);
      return true;
    case "genies.read":
      await handleGeniesRead(id, args);
      return true;
    case "genies.invoke":
      await handleGeniesInvoke(id, args);
      return true;

    default:
      return false;
  }
}
