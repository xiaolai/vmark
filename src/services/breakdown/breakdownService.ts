/**
 * Breakdown service (WI-1.9b) — ADR-013 services tier.
 *
 * The only writer of `breakdownStore`: pulls the live stale/diverged edge
 * list from the Rust coherence kernel (`coherence_breakdown`), appends
 * resolutions (`coherence_resolve` — WI-1.9a's append-only API), and opens
 * a downstream artifact for revision through the same window-scoped
 * open-file event the file explorer uses.
 *
 * Errors are surfaced through the store (`error`), never thrown past this
 * seam — the panel renders them; old rows are kept so a failed refresh
 * doesn't blank a list the user is working through.
 *
 * @coordinates-with src-tauri/src/coherence/commands.rs — the IPC surface
 * @coordinates-with stores/breakdownStore.ts — the mirror this writes
 * @module services/breakdown/breakdownService
 */import {
  invoke,
} from "@tauri-apps/api/core";

import {
  useBreakdownStore,
  type MergeNotice,
  type LogbookView,
} from "@/stores/breakdownStore";

import {
  isActiveWorkspace,
  isLatestRefresh,
  takeRefreshTicket,
} from "./refreshGuards";
import { messageOf } from "./breakdownShared";
import { refreshBreakdown } from "./breakdownRefresh";

// Split out for the 300-line limit and re-exported here, so every existing
// `from "@/services/breakdown/breakdownService"` import keeps resolving.
export { messageOf, resolveWorkspacePath } from "./breakdownShared";
export { refreshBreakdown } from "./breakdownRefresh";
export {
  refreshContexts,
  createContext,
  setContextEnforcement,
  refreshBranchCandidate,
  createContextFromBranch,
} from "./breakdownContextService";
export {
  resolveEdge,
  reviseEdge,
  checkEdge,
  fetchEdgeHeadings,
  setEdgeAnchor,
  judgeFlag,
} from "./breakdownEdgeService";

// Re-exported so existing consumers (semanticActs, claimService) keep
// importing the guards from this module.
export { isActiveWorkspace, isLatestRefresh, takeRefreshTicket };

/** Mirror of the Rust `ResolveRequest` (WI-1.9a). */
export interface ResolveEdgeRequest {
  action: "accept-newer" | "waive";
  txf: string;
  input: number;
  reason?: string;
  /** D3.2: optional waiver expiry (RFC 3339). */
  expires?: string;
}

// Stale-response guard (audit T12): a slow refresh for workspace A must
// never overwrite rows after the user switched to workspace B (or closed
// the workspace). Each refresh takes a generation ticket; only the
// newest writes.

/** WI-3.7: the latest completed-merge notice for the dismissible banner. */
export async function refreshMergeNotice(workspaceRoot: string): Promise<void> {
  if (!isActiveWorkspace(workspaceRoot)) return; // audit #4/#5: no ticket for a left workspace
  const ticket = takeRefreshTicket("merge");
  try {
    const notice = await invoke<MergeNotice | null>("coherence_recent_merge", {
      workspaceRoot,
    });
    if (!isLatestRefresh("merge", ticket) || !isActiveWorkspace(workspaceRoot))
      return;
    useBreakdownStore.getState().setMergeNotice(notice);
  } catch (error) {
    if (!isLatestRefresh("merge", ticket) || !isActiveWorkspace(workspaceRoot))
      return; // D1–D5: no stale/superseded error
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/**
 * Mark a document FROZEN (finished history) or back to LIVE.
 *
 * Measured motivation (2026-07-20): M2 read 0 relevant / 5 noise, and every
 * flag had the same cause — the downstream was already finished. Freezing stops
 * the interruption; the edge and its provenance stay recorded.
 *
 * Human-only by design: the layer may SUGGEST a freeze, never apply one.
 */
export async function setDocumentLifecycle(
  workspaceRoot: string,
  object: string,
  lifecycle: "live" | "frozen",
  reason?: string,
): Promise<void> {
  try {
    await invoke("coherence_set_lifecycle", {
      workspaceRoot,
      object,
      lifecycle,
      reason: reason ?? null,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshBreakdown(workspaceRoot);
}

/**
 * Read the coherence logbook — a projection over the ledger, so it works
 * retroactively on history recorded before the logbook existed. Read-only.
 */
export async function fetchLogbook(workspaceRoot: string): Promise<LogbookView | null> {
  try {
    return await invoke<LogbookView>("coherence_logbook", { workspaceRoot });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return null;
  }
}
