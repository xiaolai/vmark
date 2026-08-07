/**
 * Purpose: the panel-wide breakdown refresh.
 *
 * Separate because BOTH the edge and context services call it after a mutation,
 * while breakdownService.ts re-exports those services — this is what keeps the
 * import graph acyclic.
 *
 * @coordinates-with src/services/breakdown/breakdownService.ts — re-exports these
 * @module services/breakdown/breakdownRefresh
 */
import {
  invoke,
} from "@tauri-apps/api/core";

import {
  useBreakdownStore,
  type EdgeRow,
} from "@/stores/breakdownStore";

import {
  isActiveWorkspace,
} from "./refreshGuards";
import { messageOf } from "./breakdownShared";

let refreshGeneration = 0;

/**
 * Pull-based refresh (R15): reconcile + project on the Rust side, then
 * mirror the rows. Loading is set before the invoke and always cleared;
 * a failure writes `error` and keeps the previous rows.
 */
export async function refreshBreakdown(workspaceRoot: string): Promise<void> {
  // Never refresh a workspace the user has already left: a stale caller
  // (e.g. a mutation completing after a switch) must not consume a ticket
  // and thereby starve the active workspace's refresh (audit #4/#5).
  if (!isActiveWorkspace(workspaceRoot)) return;
  const generation = ++refreshGeneration;
  const store = useBreakdownStore.getState();
  store.setLoading(true);
  store.setError(null);
  try {
    const context = useBreakdownStore.getState().selectedContext;
    const rows = await invoke<EdgeRow[]>("coherence_breakdown", {
      workspaceRoot,
      context,
    });
    if (generation !== refreshGeneration || !isActiveWorkspace(workspaceRoot))
      return; // superseded (audit T12) or workspace changed (D1)
    useBreakdownStore.getState().setRows(rows);
  } catch (error) {
    if (generation !== refreshGeneration || !isActiveWorkspace(workspaceRoot))
      return; // stale error must not surface on the new workspace (D1–D5)
    useBreakdownStore.getState().setError(messageOf(error));
  } finally {
    if (generation === refreshGeneration) {
      useBreakdownStore.getState().setLoading(false);
    }
  }
}
