/**
 * Tab tools - Manage editor tabs within windows.
 */

import { VMarkMcpServer, resolveWindowId } from '../server.js';

/**
 * Tab information returned by tab tools.
 */
export interface TabInfo {
  id: string;
  title: string;
  filePath: string | null;
  isDirty: boolean;
  isActive: boolean;
}

/**
 * Register all tab management tools on the server.
 */
export function registerTabTools(server: VMarkMcpServer): void {
  // tabs_list - List all tabs in a window
  server.registerTool(
    {
      name: 'tabs_list',
      description:
        'List all tabs in the specified window. ' +
        'Returns tab IDs, titles, file paths, and dirty state.',
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
        const tabs = await server.sendBridgeRequest<TabInfo[]>({
          type: 'tabs.list',
          windowId,
        });

        return VMarkMcpServer.successJsonResult(tabs);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to list tabs: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // tabs_get_active - Get the active tab
  server.registerTool(
    {
      name: 'tabs_get_active',
      description:
        'Get information about the currently active tab in the window.',
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
        const tab = await server.sendBridgeRequest<TabInfo | null>({
          type: 'tabs.getActive',
          windowId,
        });

        if (!tab) {
          return VMarkMcpServer.errorResult('No active tab');
        }

        return VMarkMcpServer.successJsonResult(tab);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get active tab: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // tabs_switch - Switch to a specific tab
  server.registerTool(
    {
      name: 'tabs_switch',
      description:
        'Switch to a specific tab by its ID. Makes the tab active.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'string',
            description: 'The ID of the tab to switch to.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['tabId'],
      },
    },
    async (args) => {
      const tabId = args.tabId as string;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (typeof tabId !== 'string' || tabId.length === 0) {
        return VMarkMcpServer.errorResult('tabId must be a non-empty string');
      }

      try {
        await server.sendBridgeRequest<null>({
          type: 'tabs.switch',
          tabId,
          windowId,
        });

        return VMarkMcpServer.successResult(`Switched to tab: ${tabId}`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to switch tab: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // tabs_close - Close a specific tab
  server.registerTool(
    {
      name: 'tabs_close',
      description:
        'Close a specific tab by its ID. ' +
        'If the tab has unsaved changes, the user will be prompted.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'string',
            description: 'The ID of the tab to close. If omitted, closes the active tab.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const tabId = args.tabId as string | undefined;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      try {
        await server.sendBridgeRequest<null>({
          type: 'tabs.close',
          tabId,
          windowId,
        });

        return VMarkMcpServer.successResult(tabId ? `Closed tab: ${tabId}` : 'Closed active tab');
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to close tab: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // tabs_create - Create a new empty tab
  server.registerTool(
    {
      name: 'tabs_create',
      description:
        'Create a new empty tab in the window. ' +
        'The new tab becomes the active tab.',
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
        const result = await server.sendBridgeRequest<{ tabId: string }>({
          type: 'tabs.create',
          windowId,
        });

        return VMarkMcpServer.successResult(`Created new tab: ${result.tabId}`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to create tab: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // tabs_get_info - Get detailed info about a specific tab
  server.registerTool(
    {
      name: 'tabs_get_info',
      description:
        'Get detailed information about a specific tab including path, dirty state, and title.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'string',
            description: 'The ID of the tab. If omitted, returns info for active tab.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const tabId = args.tabId as string | undefined;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      try {
        const tab = await server.sendBridgeRequest<TabInfo>({
          type: 'tabs.getInfo',
          tabId,
          windowId,
        });

        return VMarkMcpServer.successJsonResult(tab);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get tab info: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
