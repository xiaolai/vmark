/**
 * Session tool — one-shot orientation for AI agents.
 *
 * Replaces the legacy discovery surface (get_capabilities,
 * get_document_revision, tabs.list, workspace.get_focused,
 * workspace.list_windows, workspace.get_document_info) with a single
 * `get_state` action that returns every window, every tab, and per-tab
 * metadata (filePath, dirty, revision, kind).
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md ADR-6.
 */

import { VMarkMcpServer } from '../server.js';
import { MCP_PROTOCOL_VERSION } from '../bridge/core-types.js';

export function registerSessionTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'session',
      description:
        'One-shot session orientation — discover every open window, every tab, and the server\'s capabilities in a single call. Use this first to learn what is available; subsequent tool calls reference tabs by their `id`.\n\n' +
        'Action:\n' +
        '- get_state: Return windows[], capabilities. Document tabs carry {id, filePath, title, dirty, revision, kind} where `kind` is `"markdown"` or `"yaml-workflow"` (use `document.write` or `workflow.apply_patch` respectively). Browser tabs carry {id, kind:"browser", title, url, active, loading, automationMode} — act on those with the `browser.*` tools.\n\n' +
        'Returns: {windows, capabilities}.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get_state'],
            description: 'The action to perform',
          },
        },
        required: ['action'],
      },
    },
    async (args) => {
      const action = args.action;
      if (action !== 'get_state') {
        return VMarkMcpServer.errorResult(
          `Invalid action: ${String(action)}. Expected: get_state`,
        );
      }
      const data = await server.sendBridgeRequest({
        type: 'vmark.session.get_state',
        // Declare the protocol we speak so the app can gate versioned data
        // (browser tabs are withheld from clients older than 0.3.0).
        clientProtocol: MCP_PROTOCOL_VERSION,
      });
      return VMarkMcpServer.successJsonResult(data);
    },
  );
}
