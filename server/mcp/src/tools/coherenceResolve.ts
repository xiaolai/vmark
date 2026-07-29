/**
 * Coherence resolve tool — the one mutating action on the coherence layer.
 *
 * Split out of `coherence.ts` so that tool can go back to declaring
 * `readOnlyHint: true`. Four reads and one non-undoable ledger write shared a
 * single annotation set, which meant the whole tool had to advertise
 * `destructiveHint: true` and a client could not auto-approve so much as a
 * status counter.
 *
 * Its own tool is also the safer shape for what this does: resolving an edge
 * writes an audit-logged entry against a delegation grant the workspace owner
 * issued, and it cannot be undone. That deserves to be conspicuous in the tool
 * list rather than buried as one enum value among five.
 *
 * Authorization is entirely server-side (src-tauri/src/mcp_bridge/routing.rs)
 * and fail-closed — it keys off the authenticated bridge principal, never off
 * anything the client asserts, so this split changes no security property.
 *
 * Plan: dev-docs/plans/20260718-coherence-layer.md WI-1.10.
 *
 * @coordinates-with tools/coherence.ts (the read-only view)
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';

export function registerCoherenceResolveTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'coherence_resolve',
      title: 'VMark Coherence Resolve',
      // Writes an audit-logged ledger entry that cannot be undone. Closed-world:
      // the ledger lives inside the workspace's own `.vmark/` directory.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'Resolve a live stale edge in the workspace coherence layer as an explicitly delegated agent. ' +
        'THIS WRITES: every resolution appends a non-undoable, audit-logged entry to the workspace ledger. ' +
        'Find the edge first with `coherence` action `edges` — `txf` and `input` come from its rows.\n\n' +
        'Authorization is fail-closed: the workspace owner must have granted YOUR authenticated bridge ' +
        'identity a live, unexpired delegation covering the resolution kind (granted in-app), and the edge ' +
        'must still be live. A refusal means the grant is missing or expired — ask the user to grant it ' +
        'rather than retrying.\n\n' +
        'Actions:\n' +
        '- resolve: Args {workspace_root, txf, input, resolution: "accept-newer"|"waive", reason? (required for waive)}.',
      inputSchema: {
        action: z.enum(['resolve']).describe('The action to perform'),
        workspace_root: z
          .string()
          .min(1)
          .describe('Absolute path of the workspace whose edge is being resolved.'),
        txf: z.string().optional().describe('The edge transformation id (from coherence edges rows).'),
        input: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('The edge input index (from coherence edges rows).'),
        resolution: z
          .enum(['accept-newer', 'waive'])
          .optional()
          .describe('The resolution kind.'),
        reason: z.string().optional().describe('Required when resolution is waive.'),
      },
    },
    async (args) => {
      if (args.action !== 'resolve') {
        return VMarkMcpServer.errorResult(
          `Invalid action: ${String(args.action)}. Expected: resolve`,
        );
      }
      if (
        typeof args.workspace_root !== 'string' ||
        args.workspace_root.length === 0
      ) {
        return VMarkMcpServer.errorResult(
          'workspace_root (string) is required — the absolute path of the workspace to resolve in',
        );
      }
      const data = await server.sendBridgeRequest({
        type: 'vmark.coherence.resolve',
        workspace_root: args.workspace_root,
        txf: args.txf,
        input: args.input,
        resolution: args.resolution,
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      });
      return VMarkMcpServer.successJsonResult(data);
    },
  );
}
