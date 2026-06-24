/**
 * MCP Bridge Path Guard (store adapter)
 *
 * Purpose: Resolve the set of allowed root directories for MCP-bridge file
 *   operations from live app state, then delegate the boundary decision to
 *   the pure policy in `utils/mcpBridgePathPolicy`.
 *
 *   Allowed roots = the open workspace root (when in workspace mode) ∪ the
 *   parent directory of every currently open document. This encodes the
 *   guarantee "the agent may act only within what the user has already
 *   opened" — consent by user action, not an arbitrary fixed boundary. A
 *   maintainer who later wants to tighten (workspace-root only) or widen
 *   (a user-configured allowlist) edits `collectAllowedRoots` here; the pure
 *   policy and its tests stay untouched.
 *
 *   `services/` tier per ADR-013: may read stores; the pure decision lives
 *   in `utils/`.
 *
 * @coordinates-with utils/mcpBridgePathPolicy.ts — pure decision function
 * @coordinates-with stores/workspaceStore.ts — rootPath / isWorkspaceMode
 * @coordinates-with stores/documentStore.ts — open documents' filePaths
 * @module services/mcpBridge/bridgePathGuard
 */

import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getParentDir } from "@/utils/paths";
import {
  resolveBridgePathDecision,
  type BridgePathDecision,
} from "@/utils/mcpBridgePathPolicy";

/**
 * Collect the directories the bridge may read/write within, from current
 * app state: the workspace root (if in workspace mode) plus the parent of
 * every open document.
 */
export function collectAllowedRoots(): string[] {
  const roots = new Set<string>();

  const ws = useWorkspaceStore.getState();
  if (ws.isWorkspaceMode && ws.rootPath) {
    roots.add(ws.rootPath);
  }

  const docs = useDocumentStore.getState().documents;
  for (const doc of Object.values(docs)) {
    if (doc.filePath) {
      const parent = getParentDir(doc.filePath);
      if (parent) roots.add(parent);
    }
  }

  return [...roots];
}

/**
 * Decide whether the bridge may touch `filePath`. Pulls allowed roots from
 * the stores and delegates to the pure policy.
 */
export function checkBridgePath(filePath: string): BridgePathDecision {
  return resolveBridgePathDecision(filePath, {
    allowedRoots: collectAllowedRoots(),
  });
}
