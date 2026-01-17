/**
 * Workspace tools - Manage documents and windows.
 */

import { VMarkMcpServer, resolveWindowId } from '../server.js';
import type { WindowInfo } from '../bridge/types.js';

/**
 * Register all workspace tools on the server.
 */
export function registerWorkspaceTools(server: VMarkMcpServer): void {
  // workspace_list_windows - List all open windows
  server.registerTool(
    {
      name: 'workspace_list_windows',
      description:
        'List all open VMark windows that are exposed to AI. ' +
        'Returns window labels, titles, file paths, and focus state.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    async () => {
      try {
        const windows = await server.sendBridgeRequest<WindowInfo[]>({
          type: 'windows.list',
        });

        return VMarkMcpServer.successJsonResult(windows);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to list windows: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // workspace_get_focused - Get focused window
  server.registerTool(
    {
      name: 'workspace_get_focused',
      description:
        'Get the label of the currently focused window. ' +
        'Use this label as windowId in other tool calls.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    async () => {
      try {
        const focused = await server.sendBridgeRequest<string>({
          type: 'windows.getFocused',
        });

        return VMarkMcpServer.successResult(focused);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get focused window: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // workspace_focus_window - Focus a specific window
  server.registerTool(
    {
      name: 'workspace_focus_window',
      description:
        'Focus a specific window by its label. ' +
        'Brings the window to the front and makes it active.',
      inputSchema: {
        type: 'object',
        properties: {
          windowId: {
            type: 'string',
            description: 'The window label to focus.',
          },
        },
        required: ['windowId'],
      },
    },
    async (args) => {
      const windowId = args.windowId as string;

      if (typeof windowId !== 'string' || windowId.length === 0) {
        return VMarkMcpServer.errorResult('windowId must be a non-empty string');
      }

      try {
        await server.sendBridgeRequest<null>({
          type: 'windows.focus',
          windowId,
        });

        return VMarkMcpServer.successResult(`Focused window: ${windowId}`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to focus window: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // workspace_new_document - Create a new document
  server.registerTool(
    {
      name: 'workspace_new_document',
      description:
        'Create a new empty document in a new window. ' +
        'The new window becomes the focused window.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Optional title for the new document.',
          },
        },
      },
    },
    async (args) => {
      const title = args.title as string | undefined;

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
  );

  // workspace_open_document - Open an existing document
  server.registerTool(
    {
      name: 'workspace_open_document',
      description:
        'Open a document from the filesystem. ' +
        'Creates a new window with the document content.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the document file.',
          },
        },
        required: ['path'],
      },
    },
    async (args) => {
      const path = args.path as string;

      if (typeof path !== 'string' || path.length === 0) {
        return VMarkMcpServer.errorResult('path must be a non-empty string');
      }

      try {
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
  );

  // workspace_save_document - Save the current document
  server.registerTool(
    {
      name: 'workspace_save_document',
      description:
        'Save the current document to disk. ' +
        'If the document is untitled, this will fail (use save_as instead).',
      inputSchema: {
        type: 'object',
        properties: {
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);

      try {
        await server.sendBridgeRequest<null>({
          type: 'workspace.saveDocument',
          windowId,
        });

        return VMarkMcpServer.successResult('Document saved');
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to save document: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // workspace_close_window - Close a window
  server.registerTool(
    {
      name: 'workspace_close_window',
      description:
        'Close a window. If the document has unsaved changes, ' +
        'the user will be prompted to save.',
      inputSchema: {
        type: 'object',
        properties: {
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);

      try {
        await server.sendBridgeRequest<null>({
          type: 'workspace.closeWindow',
          windowId,
        });

        return VMarkMcpServer.successResult('Window closed');
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to close window: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // workspace_save_document_as - Save document with a new path
  server.registerTool(
    {
      name: 'workspace_save_document_as',
      description:
        'Save the current document with a new file path. ' +
        'This creates a copy of the document at the specified location.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The new file path to save the document to.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['path'],
      },
    },
    async (args) => {
      const path = args.path as string;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (typeof path !== 'string' || path.length === 0) {
        return VMarkMcpServer.errorResult('path must be a non-empty string');
      }

      try {
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
  );

  // workspace_get_document_info - Get document metadata
  server.registerTool(
    {
      name: 'workspace_get_document_info',
      description:
        'Get information about the current document including path, dirty state, ' +
        'word count, and character count.',
      inputSchema: {
        type: 'object',
        properties: {
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);

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
  );
}
