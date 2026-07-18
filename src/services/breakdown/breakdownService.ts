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
 */
import { invoke } from "@tauri-apps/api/core";

import { useBreakdownStore, type EdgeRow } from "@/stores/breakdownStore";
import { emitOpenFileInCurrentWindow } from "@/services/navigation/openFileEvent";

/** Mirror of the Rust `ResolveRequest` (WI-1.9a). */
export interface ResolveEdgeRequest {
  action: "accept-newer" | "waive";
  txf: string;
  input: number;
  reason?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Join a workspace-relative path onto the workspace root. Pure — no
 * platform path module: Tauri accepts forward slashes on every platform,
 * so only a trailing separator on the root needs normalizing.
 */
export function resolveWorkspacePath(workspaceRoot: string, relative: string): string {
  return `${workspaceRoot.replace(/[/\\]+$/, "")}/${relative}`;
}

/**
 * Pull-based refresh (R15): reconcile + project on the Rust side, then
 * mirror the rows. Loading is set before the invoke and always cleared;
 * a failure writes `error` and keeps the previous rows.
 */
export async function refreshBreakdown(workspaceRoot: string): Promise<void> {
  const store = useBreakdownStore.getState();
  store.setLoading(true);
  store.setError(null);
  try {
    const rows = await invoke<EdgeRow[]>("coherence_breakdown", { workspaceRoot });
    useBreakdownStore.getState().setRows(rows);
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
  } finally {
    useBreakdownStore.getState().setLoading(false);
  }
}

/**
 * Append a ratification (`accept-newer`) or waiver (`waive`) for one edge,
 * then refresh so the resolved edge drops out of the list. A rejection
 * (multi-head, missing waiver reason, unknown edge) lands in `error`
 * without refreshing — the stale list is still accurate.
 */
export async function resolveEdge(
  workspaceRoot: string,
  request: ResolveEdgeRequest,
): Promise<void> {
  try {
    await invoke("coherence_resolve", { workspaceRoot, request });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshBreakdown(workspaceRoot);
}

/**
 * "Revise" — open the downstream artifact in this window's editor (same
 * mechanism as the file explorer: the window-scoped open-file event).
 * Revising produces a new downstream revision, which retires the stale
 * edge per spec §9.2 edge liveness.
 */
export async function reviseEdge(
  workspaceRoot: string,
  downstreamPath: string,
): Promise<void> {
  try {
    await emitOpenFileInCurrentWindow(resolveWorkspacePath(workspaceRoot, downstreamPath));
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
  }
}
