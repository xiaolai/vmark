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

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import { MCP_PROTOCOL_VERSION } from '../bridge/core-types.js';
import {
  RECOVERY,
  TRUNCATION_OUTPUT_SHAPE,
  structuredJsonResult,
} from '../utils/toolOutput.js';

export function registerSessionTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'session',
      title: 'VMark Session State',
      // The one genuinely read-only tool in the surface: `get_state` inspects
      // windows and tabs and mutates nothing, so repeating it is free.
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'One-shot session orientation — discover every open window, every tab, and the server\'s capabilities in a single call. Use this first to learn what is available; subsequent tool calls reference tabs by their `id`.\n\n' +
        'Action:\n' +
        '- get_state: Return windows[], capabilities. Document tabs carry {id, filePath, title, dirty, revision, kind, active, visible} where `kind` is `"markdown"` or `"yaml-workflow"` (use `document.write` or `workflow.apply_patch` respectively). Browser tabs carry {id, kind:"browser", title, url, active, loading, automationMode} — act on those with the `browser.*` tools.\n\n' +
        'Reading what is ON SCREEN: a tab can exist and be activatable without being shown. `active` marks its window\'s current tab; `visible` is false when the tab belongs to a workspace instance the window is not currently showing (`window.activeWorkspaceInstanceId` names the one it is). `window.focused` marks the window the USER is looking at, which need not be the window a request was routed to — so after activating a tab, confirm with get_state rather than trusting the activation result alone.\n\n' +
        'Returns: {windows, capabilities}.',
      inputSchema: {
        action: z.enum(['get_state']).describe('The action to perform'),
      },
      // Response shape is stable and single-action, so it is worth declaring.
      // Kept permissive in the leaves (`z.unknown()` inside the arrays) because
      // a tab's field set is versioned by the app, and a rejected payload would
      // turn a successful call into an SDK output-validation error.
      //
      // Round-2 audit finding 10 (tighten to per-action envelopes) does not
      // apply here — `get_state` is the tool's only action, so the schema is
      // already action-specific. What stays loose is the ARRAY ELEMENT, and
      // deliberately: `windows[].tabs[]` gains fields with app releases (browser
      // tabs arrived in protocol 0.3.0), and the sidecar ships on its own
      // cadence. Pinning the element shape here would make a newer VMark's
      // correct response an SDK protocol error against an older sidecar.
      outputSchema: {
        windows: z
          .array(z.unknown())
          .optional()
          .describe('Open windows, each {label, focused, tabs[]}.'),
        capabilities: z
          .unknown()
          .optional()
          .describe('{version, supportedKinds, mcpProtocol}.'),
        ...TRUNCATION_OUTPUT_SHAPE,
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
      // `get_state` takes no arguments and cannot be paginated, so the default
      // "target a specific tabId" hint would be impossible to act on.
      return structuredJsonResult(data, RECOVERY.sessionGetState);
    },
  );
}
