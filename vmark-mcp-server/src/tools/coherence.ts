/**
 * Coherence tool — READ-ONLY view of a workspace's coherence layer.
 *
 * Surfaces the kernel's status counters and the breakdown of live
 * stale/diverged edges so an AI agent can see which derived documents
 * have upstreams that moved. Both actions are answered entirely in Rust
 * (src-tauri/src/mcp_bridge/routing.rs) from the per-workspace kernel —
 * no webview hop, so they work even when the editor is suspended.
 *
 * Plan: dev-docs/plans/20260718-coherence-layer.md WI-1.10.
 */

import type { BridgeRequest } from '../bridge/core-types.js';
import { VMarkMcpServer } from '../server.js';

export function registerCoherenceTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'coherence',
      description:
        'READ-ONLY view of the workspace coherence layer — which derived documents are stale against their upstreams. Never modifies anything.\n\n' +
        'Actions:\n' +
        '- status: Kernel status counters. Returns {initialized, objects, open_items, quarantined, writer}. `initialized: false` means the workspace has no coherence ledger yet (no `.vmark/` directory).\n' +
        '- edges: The breakdown — every live, non-fresh dependency edge. Returns an array of {txf, input, upstream, upstream_path, pinned, downstream, downstream_path, downstream_rev, state} where `state` is e.g. "version-stale", "stale-contradicted", "diverged", "waived". Empty array means everything is coherent.\n' +
        '- claims: Current canon claims. Returns an array of {claim, entryId, statement, maturity, invalidAt, visible} — maturity is "draft"|"established"; only established claims constrain checks. Read-only.\n' +
        '- contexts: The context set (the implicit default is always present). Returns an array of {id, name, parent, enforcement, visibleClaims, errors}. Read-only.\n' +
        '- resolve: THE one mutating action — resolve a live stale edge as an explicitly delegated agent. Args {workspace_root, txf, input, resolution: "accept-newer"|"waive", reason? (required for waive)}. Authorization is fail-closed: the workspace owner must have granted YOUR authenticated bridge identity a live, unexpired delegation covering the resolution kind (granted in-app); the edge must be live. Every delegated resolution is audit-logged against the grant.\n\n' +
        'All actions require `workspace_root`: the absolute path of the workspace to query (learn it from the workspace/session tools).',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'edges', 'claims', 'contexts', 'resolve'],
            description: 'The action to perform',
          },
          workspace_root: {
            type: 'string',
            description:
              'Absolute path of the workspace to query. Required for every action.',
          },
          txf: {
            type: 'string',
            description: 'resolve only: the edge transformation id (from edges rows).',
          },
          input: {
            type: 'number',
            description: 'resolve only: the edge input index.',
          },
          resolution: {
            type: 'string',
            enum: ['accept-newer', 'waive'],
            description: 'resolve only: the resolution kind.',
          },
          reason: {
            type: 'string',
            description: 'resolve only: required when resolution is waive.',
          },
        },
        required: ['action', 'workspace_root'],
      },
    },
    async (args) => {
      const action = args.action;
      if (
        typeof action !== 'string' ||
        !['status', 'edges', 'claims', 'contexts', 'resolve'].includes(action)
      ) {
        return VMarkMcpServer.errorResult(
          `Invalid action: ${String(action)}. Expected: status, edges, claims, contexts, resolve`,
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
      const request: BridgeRequest =
        action === 'resolve'
          ? {
              type: 'vmark.coherence.resolve',
              workspace_root: args.workspace_root,
              txf: args.txf,
              input: args.input,
              resolution: args.resolution,
              ...(args.reason !== undefined ? { reason: args.reason } : {}),
            }
          : {
              type: `vmark.coherence.${action}` as
                | 'vmark.coherence.status'
                | 'vmark.coherence.edges'
                | 'vmark.coherence.claims'
                | 'vmark.coherence.contexts',
              workspace_root: args.workspace_root,
            };
      const data = await server.sendBridgeRequest(request);
      return VMarkMcpServer.successJsonResult(data);
    },
  );
}
