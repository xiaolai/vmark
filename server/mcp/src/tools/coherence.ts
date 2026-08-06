/**
 * Coherence tool — READ-ONLY view of a workspace's coherence layer.
 *
 * Surfaces the kernel's status counters and the breakdown of live
 * stale/diverged edges so an AI agent can see which derived documents
 * have upstreams that moved. Every action is answered entirely in Rust
 * (src-tauri/src/mcp_bridge/routing.rs) from the per-workspace kernel —
 * no webview hop, so they work even when the editor is suspended.
 *
 * The header said READ-ONLY for a while after it stopped being true: `resolve`
 * was added here and writes an audit-logged, non-undoable ledger entry, which
 * forced the whole tool to declare `destructiveHint: true`. It now lives in
 * `coherence_resolve`, so the name, the header and the annotation agree again
 * and a client can auto-approve the reads.
 *
 * Plan: dev-docs/plans/20260718-coherence-layer.md WI-1.10.
 *
 * @coordinates-with tools/coherenceResolve.ts (the one mutating action)
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import { RECOVERY } from '../utils/toolOutput.js';

const READ_ACTIONS = ['status', 'edges', 'claims', 'contexts'] as const;

export function registerCoherenceTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'coherence',
      title: 'VMark Workspace Coherence',
      // Every action reads the kernel and writes nothing. Closed-world: the
      // ledger lives inside the workspace's own `.vmark/` directory.
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'READ-ONLY view of the workspace coherence layer — which derived documents are stale against their upstreams. Never modifies anything; to act on a stale edge use `coherence_resolve`.\n\n' +
        'Actions:\n' +
        '- status: Kernel status counters. Returns {initialized, objects, open_items, quarantined, writer}. `initialized: false` means the workspace has no coherence ledger yet (no `.vmark/` directory).\n' +
        '- edges: The breakdown — every live, non-fresh dependency edge. Returns an array of {txf, input, upstream, upstream_path, pinned, downstream, downstream_path, downstream_rev, state} where `state` is e.g. "version-stale", "stale-contradicted", "diverged", "waived". Empty array means everything is coherent.\n' +
        '- claims: Current canon claims. Returns an array of {claim, entryId, statement, maturity, invalidAt, visible} — maturity is "draft"|"established"; only established claims constrain checks.\n' +
        '- contexts: The context set (the implicit default is always present). Returns an array of {id, name, parent, enforcement, visibleClaims, errors}.\n\n' +
        'All actions require `workspace_root`: the absolute path of the workspace to query (learn it from the workspace/session tools).',
      inputSchema: {
        action: z.enum(READ_ACTIONS).describe('The action to perform'),
        workspace_root: z
          .string()
          .min(1)
          .describe('Absolute path of the workspace to query. Required for every action.'),
      },
    },
    async (args) => {
      const action = args.action;
      if (
        typeof action !== 'string' ||
        !(READ_ACTIONS as readonly string[]).includes(action)
      ) {
        return VMarkMcpServer.errorResult(
          `Invalid action: ${String(action)}. Expected: ${READ_ACTIONS.join(', ')}`,
        );
      }
      if (
        typeof args.workspace_root !== 'string' ||
        args.workspace_root.length === 0
      ) {
        return VMarkMcpServer.errorResult(
          'workspace_root (string) is required — the absolute path of the workspace to query',
        );
      }
      const data = await server.sendBridgeRequest({
        type: `vmark.coherence.${action}` as
          | 'vmark.coherence.status'
          | 'vmark.coherence.edges'
          | 'vmark.coherence.claims'
          | 'vmark.coherence.contexts',
        workspace_root: args.workspace_root,
      });
      return VMarkMcpServer.successJsonResult(
        data,
        action === 'edges' ? RECOVERY.coherenceEdges : RECOVERY.default,
      );
    },
  );
}
