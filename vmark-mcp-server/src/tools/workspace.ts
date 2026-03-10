/**
 * Workspace composite tool — manage documents, windows, and workspace state.
 */

import {
  VMarkMcpServer,
  getWindowIdArg,
  getStringArg,
  requireStringArg,
  getBooleanArg,
} from '../server.js';
import type { WindowInfo, RecentFile, WorkspaceInfo } from '../bridge/types.js';

export function registerWorkspaceTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'workspace',
      description:
        'Manage documents, windows, and workspace state.\n\n' +
        'Actions:\n' +
        '- list_windows: List all open VMark windows\n' +
        '- get_focused: Get focused window label\n' +
        '- focus_window: Focus a window by windowId\n' +
        '- new_document: Create new empty document in new window\n' +
        '- open_document: Open document from filesystem by path\n' +
        '- save: Save current document to disk\n' +
        '- save_as: Save document with new file path\n' +
        '- get_document_info: Get document metadata (path, dirty, word count)\n' +
        '- close_window: Close window (prompts if unsaved)\n' +
        '- list_recent_files: List recently opened files\n' +
        '- get_info: Get workspace state (mode, root path, name)\n' +
        '- reload_document: Reload document from disk',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: [
              'list_windows', 'get_focused', 'focus_window',
              'new_document', 'open_document', 'save', 'save_as',
              'get_document_info', 'close_window', 'list_recent_files',
              'get_info', 'reload_document',
            ],
          },
          path: {
            type: 'string',
            description: 'File path (for open_document, save_as).',
          },
          title: {
            type: 'string',
            description: 'Document title (for new_document).',
          },
          force: {
            type: 'boolean',
            description: 'Force reload even with unsaved changes (for reload_document).',
          },
          windowId: {
            type: 'string',
            description: 'Window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const action = args.action as string;
      const windowId = getWindowIdArg(args);

      switch (action) {
        case 'list_windows':
          return handleListWindows(server);
        case 'get_focused':
          return handleGetFocused(server);
        case 'focus_window':
          return handleFocusWindow(server, args);
        case 'new_document':
          return handleNewDocument(server, args);
        case 'open_document':
          return handleOpenDocument(server, args);
        case 'save':
          return handleSave(server, windowId);
        case 'save_as':
          return handleSaveAs(server, windowId, args);
        case 'get_document_info':
          return handleGetDocumentInfo(server, windowId);
        case 'close_window':
          return handleCloseWindow(server, windowId);
        case 'list_recent_files':
          return handleListRecentFiles(server);
        case 'get_info':
          return handleGetInfo(server, windowId);
        case 'reload_document':
          return handleReloadDocument(server, windowId, args);
        default:
          return VMarkMcpServer.errorResult(`Unknown workspace action: ${action}`);
      }
    }
  );
}

async function handleListWindows(server: VMarkMcpServer) {
  try {
    const windows = await server.sendBridgeRequest<WindowInfo[]>({ type: 'windows.list' });
    return VMarkMcpServer.successJsonResult(windows);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to list windows: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleGetFocused(server: VMarkMcpServer) {
  try {
    const focused = await server.sendBridgeRequest<string>({ type: 'windows.getFocused' });
    return VMarkMcpServer.successResult(focused);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to get focused window: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleFocusWindow(server: VMarkMcpServer, args: Record<string, unknown>) {
  try {
    const windowId = requireStringArg(args, 'windowId');
    await server.sendBridgeRequest<null>({ type: 'windows.focus', windowId });
    return VMarkMcpServer.successResult(`Focused window: ${windowId}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to focus window: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleNewDocument(server: VMarkMcpServer, args: Record<string, unknown>) {
  const title = getStringArg(args, 'title');

  try {
    const result = await server.sendBridgeRequest<{ windowId: string }>({
      type: 'workspace.newDocument',
      title,
    });
    return VMarkMcpServer.successResult(`Created new document: ${result.windowId}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to create document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleOpenDocument(server: VMarkMcpServer, args: Record<string, unknown>) {
  try {
    const path = requireStringArg(args, 'path');
    const result = await server.sendBridgeRequest<{ windowId: string }>({
      type: 'workspace.openDocument',
      path,
    });
    return VMarkMcpServer.successResult(`Opened document: ${result.windowId}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to open document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleSave(server: VMarkMcpServer, windowId: string) {
  try {
    await server.sendBridgeRequest<null>({ type: 'workspace.saveDocument', windowId });
    return VMarkMcpServer.successResult('Document saved');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to save document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleSaveAs(
  server: VMarkMcpServer,
  windowId: string,
  args: Record<string, unknown>
) {
  try {
    const path = requireStringArg(args, 'path');
    await server.sendBridgeRequest<null>({
      type: 'workspace.saveDocumentAs',
      path,
      windowId,
    });
    return VMarkMcpServer.successResult(`Document saved to: ${path}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to save document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleGetDocumentInfo(server: VMarkMcpServer, windowId: string) {
  try {
    const info = await server.sendBridgeRequest<{
      filePath: string | null;
      isDirty: boolean;
      title: string;
      wordCount: number;
      charCount: number;
    }>({
      type: 'workspace.getDocumentInfo',
      windowId,
    });
    return VMarkMcpServer.successJsonResult(info);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to get document info: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleCloseWindow(server: VMarkMcpServer, windowId: string) {
  try {
    await server.sendBridgeRequest<null>({ type: 'workspace.closeWindow', windowId });
    return VMarkMcpServer.successResult('Window closed');
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to close window: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleListRecentFiles(server: VMarkMcpServer) {
  try {
    const files = await server.sendBridgeRequest<RecentFile[]>({
      type: 'workspace.listRecentFiles',
    });

    if (files.length === 0) {
      return VMarkMcpServer.successResult('No recent files');
    }
    return VMarkMcpServer.successJsonResult(files);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to list recent files: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleGetInfo(server: VMarkMcpServer, windowId: string) {
  try {
    const info = await server.sendBridgeRequest<WorkspaceInfo>({
      type: 'workspace.getInfo',
      windowId,
    });
    return VMarkMcpServer.successJsonResult(info);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to get workspace info: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleReloadDocument(
  server: VMarkMcpServer,
  windowId: string,
  args: Record<string, unknown>
) {
  const force = getBooleanArg(args, 'force') ?? false;

  try {
    const result = await server.sendBridgeRequest<{ filePath: string }>({
      type: 'workspace.reloadDocument',
      force,
      windowId,
    });
    return VMarkMcpServer.successResult(`Reloaded document from: ${result.filePath}`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to reload document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
