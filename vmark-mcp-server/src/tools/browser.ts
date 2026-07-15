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
import type { ToolArgs } from '../server.js';
import { isNeedsApproval } from '../bridge/core-types.js';

/**
 * Turn a bridge failure into a tool result.
 *
 * An approval refusal is not an ordinary error — it is a request for human
 * consent. Render it so the AI can tell the user exactly what is being asked
 * for, and tell it not to just retry (a retry re-raises the same request).
 */
function toErrorResult(error: unknown) {
  const data = (error as { data?: unknown })?.data;
  if (isNeedsApproval(data)) {
    return VMarkMcpServer.errorResult(
      `approval required: '${data.operation}' on ${data.url}. ` +
        'Ask the user to approve this action in VMark, then try again. ' +
        'Do not retry until they have approved — a retry only re-raises the same request.',
    );
  }
  return VMarkMcpServer.errorResult(error instanceof Error ? error.message : String(error));
}

function timeoutMs(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  return value >= 1 && value <= 12_000 ? value : undefined;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string when provided`);
  }
  return value;
}

export function registerBrowserTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'browser',
      description:
        'Read and act on the embedded browser tab.\n\n' +
        'Actions:\n' +
        "- read: Return {url, snapshot} where snapshot is a flat ARIA tree [{role,name}] of the page's interactive/structural elements. Pass `tabId` to target a specific browser tab; omit to use the focused tab. Read before acting so you target elements by their real accessible name.\n" +
        '- act: Click or type by ARIA role + accessible name. Args: {tabId?, operation: "click"|"type", role, name, text?}. Locating never crosses roles (a button named "Publish" is not a link named "Publish"). Actions are gated by the user\'s standing grants: an un-granted operation returns success:false with data.needsApproval:true — surface that to the user and wait for approval rather than retrying. Upload is never permitted (an AI-chosen file upload is an exfiltration path).\n' +
        '- open: Create an AI-owned browser tab at an HTTP(S) URL and wait for its navigation.\n' +
        '- navigate: Navigate an AI-owned tab and wait for the returned navigation ticket.\n' +
        '- wait: Wait for an existing navigation ticket without starting a new navigation. All waits are bounded to 12 seconds.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'act', 'open', 'navigate', 'wait'],
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
          url: {
            type: 'string',
            description: 'HTTP(S) destination (open/navigate only).',
          },
          navigationId: {
            type: 'string',
            description: 'Existing navigation ticket (wait only).',
          },
          timeoutMs: {
            type: 'integer',
            minimum: 1,
            maximum: 12000,
            description: 'Maximum wait in milliseconds (default 12000).',
          },
        },
        required: ['action'],
      },
    },
    async (args: ToolArgs) => {
      // tabId: omit → focused tab. If explicitly provided it must be a
      // non-blank string; a blank/garbled id must not silently fall through to
      // the active tab and read or mutate the wrong one.
      let tabId: string | undefined;
      try {
        tabId = optionalId(args.tabId, 'tabId');
      } catch (error) {
        return VMarkMcpServer.errorResult(error instanceof Error ? error.message : String(error));
      }

      try {
        if (args.action === 'read') {
          const data = await server.sendBridgeRequest({ type: 'vmark.browser.read', tabId });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (args.action === 'act') {
          const operation = typeof args.operation === 'string' ? args.operation : '';
          const role = typeof args.role === 'string' ? args.role : '';
          const name = typeof args.name === 'string' ? args.name : '';
          // A blank role/name would target the first unnamed matching element —
          // an unintended click or edit. Refuse rather than guess.
          if (!operation || !role || !name) {
            return VMarkMcpServer.errorResult('act requires operation, role, and name');
          }
          // `type` MUST carry a text string. Omitting it previously reached the
          // frontend as missing data, was coerced to "", and cleared the target
          // field — an incomplete call silently destroying user data. An explicit
          // "" is still allowed (intentional clear); undefined is not.
          if (operation === 'type' && typeof args.text !== 'string') {
            return VMarkMcpServer.errorResult(
              "act operation 'type' requires a 'text' string (pass \"\" to intentionally clear the field)",
            );
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
        if (args.action === 'open') {
          if (typeof args.url !== 'string' || args.url.trim().length === 0) {
            return VMarkMcpServer.errorResult('url must be a non-empty string');
          }
          const wait = timeoutMs(args.timeoutMs);
          if (args.timeoutMs !== undefined && wait === undefined) {
            return VMarkMcpServer.errorResult('timeoutMs must be an integer from 1 to 12000');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.open',
            url: args.url,
            ...(wait === undefined ? {} : { timeoutMs: wait }),
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (args.action === 'navigate') {
          if (typeof args.url !== 'string' || args.url.trim().length === 0) {
            return VMarkMcpServer.errorResult('url must be a non-empty string');
          }
          const wait = timeoutMs(args.timeoutMs);
          if (args.timeoutMs !== undefined && wait === undefined) {
            return VMarkMcpServer.errorResult('timeoutMs must be an integer from 1 to 12000');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.navigate',
            ...(tabId === undefined ? {} : { tabId }),
            url: args.url,
            ...(wait === undefined ? {} : { timeoutMs: wait }),
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        if (args.action === 'wait') {
          let navigationId: string | undefined;
          try {
            navigationId = optionalId(args.navigationId, 'navigationId');
          } catch (error) {
            return VMarkMcpServer.errorResult(error instanceof Error ? error.message : String(error));
          }
          const wait = timeoutMs(args.timeoutMs);
          if (args.timeoutMs !== undefined && wait === undefined) {
            return VMarkMcpServer.errorResult('timeoutMs must be an integer from 1 to 12000');
          }
          const data = await server.sendBridgeRequest({
            type: 'vmark.browser.wait',
            ...(tabId === undefined ? {} : { tabId }),
            ...(navigationId === undefined ? {} : { navigationId }),
            ...(wait === undefined ? {} : { timeoutMs: wait }),
          });
          return VMarkMcpServer.successJsonResult(data);
        }
        return VMarkMcpServer.errorResult(`unknown action: ${String(args.action)}`);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
