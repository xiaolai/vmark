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
 *   Enforcement is call-site discipline, not types: every bridge handler that
 *   touches `@tauri-apps/plugin-fs` must call `checkBridgePath` first. The fs
 *   capability also grants mkdir/copy/rename/remove — none are exposed on the
 *   bridge today, but a future handler that adds one MUST wire this guard too.
 *   `v2/__tests__/fsGuardInvariant.test.ts` makes that structural: a bridge
 *   file importing plugin-fs without referencing `checkBridgePath` fails CI.
 *
 * @coordinates-with utils/mcpBridgePathPolicy.ts — pure decision function
 * @coordinates-with stores/workspaceStore.ts — rootPath / isWorkspaceMode
 * @coordinates-with stores/documentStore.ts — open documents' filePaths
 * @module services/mcpBridge/bridgePathGuard
 */

import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDocumentStore } from "@/stores/documentStore";
import { invoke } from "@tauri-apps/api/core";
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
 * the stores, delegates to the pure policy for cheap lexical rejection, then
 * asks Rust to resolve symlinks for existing paths / ancestors.
 */
export async function checkBridgePath(
  filePath: string,
): Promise<BridgePathDecision> {
  const allowedRoots = collectAllowedRoots();
  const lexicalDecision = resolveBridgePathDecision(filePath, { allowedRoots });
  if (!lexicalDecision.allowed) return lexicalDecision;

  try {
    await invoke("mcp_bridge_check_path", { filePath, allowedRoots });
    return { allowed: true };
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
