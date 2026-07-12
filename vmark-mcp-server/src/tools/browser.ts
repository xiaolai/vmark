/**
 * Browser tool — read and act on the embedded browser tab (WI-2.5 / R5).
 *
 * Exposes the live embedded browser to AI clients: `read` returns an ARIA
 * snapshot of the current page (the driver's isolated-world eval); `act` clicks
 * or types by ARIA role + accessible name. `act` is gated by the user's scoped
 * standing grants on the VMark side — an ungranted operation comes back with
 * `needsApproval: true` (ask the user), and `upload` is never permitted.
 *
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-2.5.
 */

import { VMarkMcpServer } from '../server.js';

export function registerBrowserTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'browser',
      description:
        'Read and act on the embedded browser tab.\n\n' +
        'Actions:\n' +
        "- read: Return {url, snapshot} where snapshot is a flat ARIA tree [{role,name}] of the page's interactive/structural elements. Pass `tabId` to target a specific browser tab; omit to use the focused tab. Read before acting so you target elements by their real accessible name.\n" +
        '- act: Click or type by ARIA role + accessible name. Args: {tabId?, operation: "click"|"type", role, name, text?}. Locating never crosses roles (a button named "Publish" is not a link named "Publish"). Actions are gated by the user\'s standing grants: an un-granted operation returns success:false with data.needsApproval:true — surface that to the user and wait for approval rather than retrying. Upload is never permitted (an AI-chosen file upload is an exfiltration path).',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'act'],
            description: 'The action to perform',
          },
          tabId: {
            type: 'string',
            description: 'Target browser tab id (from session.get_state). Omit to use the focused tab.',
          },
          operation: {
            type: 'string',
            enum: ['click', 'type'],
            description: 'The interaction to perform (act only).',
          },
          role: {
            type: 'string',
            description: 'ARIA role of the target, e.g. button/link/textbox (act only).',
          },
          name: {
            type: 'string',
            description: 'Accessible name of the target element (act only).',
          },
          text: {
            type: 'string',
            description: 'Text to type into the target (act, operation=type).',
          },
        },
        required: ['action'],
      },
    },
    async (args) => {
      const tabId = typeof args.tabId === 'string' ? args.tabId : undefined;

      if (args.action === 'read') {
        const data = await server.sendBridgeRequest({ type: 'vmark.browser.read', tabId });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (args.action === 'act') {
        const operation = typeof args.operation === 'string' ? args.operation : '';
        const role = typeof args.role === 'string' ? args.role : '';
        const name = typeof args.name === 'string' ? args.name : '';
        if (!operation || !role || !name) {
          return VMarkMcpServer.errorResult('act requires operation, role, and name');
        }
        const text = typeof args.text === 'string' ? args.text : undefined;
        const data = await server.sendBridgeRequest({
          type: 'vmark.browser.act',
          tabId,
          operation,
          role,
          name,
          ...(text !== undefined ? { text } : {}),
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      return VMarkMcpServer.errorResult(`unknown action: ${String(args.action)}`);
    },
  );
}
