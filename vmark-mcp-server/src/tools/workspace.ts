/**
 * Workspace tool — file and window lifecycle.
 *
 * Covers everything that is NOT in-document mutation: creating /
 * opening / saving / closing files, switching tabs, focusing windows.
 * The pruned MCP surface depends on these because the AI cannot
 * derive them from text round-trip alone.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md WI-1.2.
 */

import { VMarkMcpServer } from '../server.js';

export function registerWorkspaceTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'workspace',
      description:
        'File and window lifecycle. Use these for everything that is not in-document mutation: creating, opening, saving, closing files; switching tabs; focusing windows.\n\n' +
        'Actions:\n' +
        '- new: Create a new untitled tab. Args: {kind?, windowLabel?}. Returns {tabId}.\n' +
        '- open: Open a file from disk. Args: {filePath, windowLabel?}. Returns {tabId}.\n' +
        '- save: Save a tab to its existing path. Args: {tabId?}. Returns {filePath, revision}.\n' +
        '- save_as: Save a tab to a new path. Args: {tabId?, filePath}. Returns {revision}.\n' +
        '- close: Close a tab. Args: {tabId, force?}. Refuses to close a dirty tab unless `force: true`; returns {closed: false, reason: "DIRTY"} in that case.\n' +
        '- switch_tab: Activate a tab. Args: {tabId}.\n' +
        '- focus_window: Focus a specific window. Args: {windowLabel}.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'new',
              'open',
              'save',
              'save_as',
              'close',
              'switch_tab',
              'focus_window',
            ],
            description: 'The action to perform',
          },
          tabId: { type: 'string' },
          filePath: { type: 'string' },
          windowLabel: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['markdown', 'yaml-workflow'],
            description: 'Hint for `new` (default: markdown).',
          },
          force: {
            type: 'boolean',
            description:
              '`close` only — discard a dirty tab without saving.',
          },
        },
        required: ['action'],
      },
    },
    async (args) => {
      const action = args.action;
      const tabId = typeof args.tabId === 'string' ? args.tabId : undefined;
      const windowLabel =
        typeof args.windowLabel === 'string' ? args.windowLabel : undefined;
      const kind = typeof args.kind === 'string' ? args.kind : undefined;

      switch (action) {
        case 'new': {
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.new',
            kind,
            windowLabel,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'open': {
          if (typeof args.filePath !== 'string') {
            return VMarkMcpServer.errorResult('filePath (string) is required');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.open',
            filePath: args.filePath,
            windowLabel,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'save': {
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.save',
            tabId,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'save_as': {
          if (typeof args.filePath !== 'string') {
            return VMarkMcpServer.errorResult('filePath (string) is required');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.save_as',
            tabId,
            filePath: args.filePath,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'close': {
          if (typeof args.tabId !== 'string') {
            return VMarkMcpServer.errorResult('tabId (string) is required');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.close',
            tabId: args.tabId,
            force: args.force === true,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'switch_tab': {
          if (typeof args.tabId !== 'string') {
            return VMarkMcpServer.errorResult('tabId (string) is required');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.switch_tab',
            tabId: args.tabId,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        case 'focus_window': {
          if (typeof args.windowLabel !== 'string') {
            return VMarkMcpServer.errorResult(
              'windowLabel (string) is required',
            );
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.workspace.focus_window',
            windowLabel: args.windowLabel,
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        default:
          return VMarkMcpServer.errorResult(
            `Invalid action: ${String(action)}`,
          );
      }
    },
  );
}
