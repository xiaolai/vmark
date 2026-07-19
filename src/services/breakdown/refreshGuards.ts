/**
 * Stale-response guards for pull-based coherence refreshes (audit D1–D5,
 * split from breakdownService for the file-size gate). Every refresh awaits
 * an async invoke; by the time it resolves the user may have switched or
 * closed the workspace, or a newer refresh of the same surface may have
 * started. These helpers let each refresh drop a stale/superseded response
 * instead of overwriting the mirror the user now sees.
 *
 * @coordinates-with services/breakdown/breakdownService — re-exports these
 * @coordinates-with services/breakdown/semanticActs, services/claims/claimService — consumers
 * @module services/breakdown/refreshGuards
 */
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * True while `workspaceRoot` is still the open workspace. A late response
 * for a workspace the user already left must NOT overwrite the new
 * workspace's mirror (audit D1–D5).
 */
export function isActiveWorkspace(workspaceRoot: string): boolean {
  return useWorkspaceStore.getState().rootPath === workspaceRoot;
}

/**
 * Per-surface request tickets (audit #4). The active-workspace check orders
 * refreshes ACROSS workspaces, but not two refreshes of the SAME root — an
 * A→B→A switch, or a slow then a fast refresh of one root, can both pass
 * `isActiveWorkspace`, letting an older response overwrite a newer one. Each
 * surface takes a monotonic ticket; only the newest ticket writes.
 */
const refreshTickets = new Map<string, number>();

export function takeRefreshTicket(surface: string): number {
  const next = (refreshTickets.get(surface) ?? 0) + 1;
  refreshTickets.set(surface, next);
  return next;
}

export function isLatestRefresh(surface: string, ticket: number): boolean {
  return refreshTickets.get(surface) === ticket;
}
