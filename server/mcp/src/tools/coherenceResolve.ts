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
 * Origin: Coherence layer plan (2026-07-18, retired) WI-1.10.
 *
 * @coordinates-with tools/coherence.ts (the read-only view)
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';

export const COHERENCE_RESOLVE_TOOL = 'coherence_resolve' as const;
export const COHERENCE_RESOLVE_ACTIONS = ['resolve'] as const;

export function registerCoherenceResolveTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: COHERENCE_RESOLVE_TOOL,
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
        action: z.enum(COHERENCE_RESOLVE_ACTIONS).describe('The action to perform'),
        workspace_root: z
          .string()
          .min(1)
          .describe('Absolute path of the workspace whose edge is being resolved.'),
        // REQUIRED, not optional: `resolve` is the only action, and it needs
        // all three. Declaring them optional made a request missing any of
        // them valid against the ADVERTISED schema, and the handler then
        // forwarded `undefined` into a non-undoable, audit-logged ledger write
        // (audit R2 #221).
        txf: z.string().trim().min(1).describe('The edge transformation id (from coherence edges rows).'),
        input: z
          .number()
          .int()
          .nonnegative()
          .describe('The edge input index (from coherence edges rows).'),
        resolution: z.enum(['accept-newer', 'waive']).describe('The resolution kind.'),
        reason: z.string().optional().describe('Required when resolution is waive.'),
      },
    },
    async (args) => {
      // The valid action comes from the exported list the schema also uses.
      // Spelling it again created a second source of truth that a new action
      // would leave stale — the refusal would name only `resolve` while the
      // schema accepted more (audit R3 #223).
      if (!(COHERENCE_RESOLVE_ACTIONS as readonly string[]).includes(String(args.action))) {
        return VMarkMcpServer.errorResult(
          `Invalid action: ${String(args.action)}. Expected: ${COHERENCE_RESOLVE_ACTIONS.join(', ')}`,
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
      // The defensive half. `VMarkMcpServer.callTool` performs no schema
      // validation, so the schema above is not what holds for an in-process
      // caller — and this write cannot be undone (audit R2 #221).
      if (typeof args.txf !== 'string' || args.txf.trim().length === 0) {
        return VMarkMcpServer.errorResult('txf (non-empty string) is required — take it from a `coherence` action `edges` row');
      }
      if (typeof args.input !== 'number' || !Number.isInteger(args.input) || args.input < 0) {
        return VMarkMcpServer.errorResult('input (non-negative integer) is required — take it from a `coherence` action `edges` row');
      }
      if (args.resolution !== 'accept-newer' && args.resolution !== 'waive') {
        return VMarkMcpServer.errorResult('resolution must be "accept-newer" or "waive"');
      }
      // A waiver with no reason is an unauditable entry in an audit log, and
      // the tool's own description already calls the reason required for it
      // (audit R2 #222).
      if (args.resolution === 'waive' && (typeof args.reason !== 'string' || args.reason.trim().length === 0)) {
        return VMarkMcpServer.errorResult('reason (non-blank string) is required when resolution is "waive" — the ledger entry is permanent and auditable');
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
