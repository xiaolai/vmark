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

import { VMarkMcpServer } from '../server.js';

export function registerCoherenceTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'coherence',
      description:
        'READ-ONLY view of the workspace coherence layer — which derived documents are stale against their upstreams. Never modifies anything.\n\n' +
        'Actions:\n' +
        '- status: Kernel status counters. Returns {initialized, objects, open_items, quarantined, writer}. `initialized: false` means the workspace has no coherence ledger yet (no `.vmark/` directory).\n' +
        '- edges: The breakdown — every live, non-fresh dependency edge. Returns an array of {txf, input, upstream, upstream_path, pinned, downstream, downstream_path, downstream_rev, state} where `state` is e.g. "version-stale", "diverged", "waived". Empty array means everything is coherent.\n\n' +
        'Both actions require `workspace_root`: the absolute path of the workspace to query (learn it from the workspace/session tools).',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'edges'],
            description: 'The action to perform',
          },
          workspace_root: {
            type: 'string',
            description:
              'Absolute path of the workspace to query. Required for every action.',
          },
        },
        required: ['action', 'workspace_root'],
      },
    },
    async (args) => {
      const action = args.action;
      if (action !== 'status' && action !== 'edges') {
        return VMarkMcpServer.errorResult(
          `Invalid action: ${String(action)}. Expected: status, edges`,
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
        type: action === 'status' ? 'vmark.coherence.status' : 'vmark.coherence.edges',
        workspace_root: args.workspace_root,
      });
      return VMarkMcpServer.successJsonResult(data);
    },
  );
}
