/**
 * Merge-audit service (Phase 5, WI-5.3 frontend) — ADR-013 services tier.
 *
 * A thin `invoke` wrapper over `coherence_merge_audit` (read-only): the edges a
 * completed git merge touched, for the human to re-check. Empty when HEAD is not
 * a completed merge. The audit only surfaces the edges; resolving them stays a
 * human act (§14 — never auto-reconcile).
 *
 * @coordinates-with src-tauri/src/coherence/merge_audit.rs — the IPC surface
 * @module services/coherence/mergeAuditService
 */
import { invoke } from "@tauri-apps/api/core";

/** One merge-affected edge — mirrors Rust `MergeAffectedEdge` (camelCase). */
export interface MergeAffectedEdge {
  txf: string;
  input: number;
  upstream: string;
  downstream: string;
  /** Origin-edge kind wire tag (`dependency`, `conformance`, …). */
  kind: string;
}

/** The edges the workspace's current-HEAD merge touched (empty for a non-merge). */
export async function fetchMergeAffectedEdges(
  workspaceRoot: string,
): Promise<MergeAffectedEdge[]> {
  return invoke<MergeAffectedEdge[]>("coherence_merge_audit", { workspaceRoot });
}
