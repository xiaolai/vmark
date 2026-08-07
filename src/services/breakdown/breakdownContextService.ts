/**
 * Purpose: context lifecycle — create, enforce, and derive a context from a branch.
 *
 * Split out of breakdownService.ts (410 lines). A context is a distinct noun from
 * an edge: it scopes which claims constrain whom, and none of these calls touch
 * an edge.
 *
 * @coordinates-with src/services/breakdown/breakdownService.ts — re-exports these
 * @module services/breakdown/breakdownContextService
 */
import {
  invoke,
} from "@tauri-apps/api/core";

import {
  useBreakdownStore,
  type BranchCandidate,
  type ContextRow,
} from "@/stores/breakdownStore";

import {
  isActiveWorkspace,
  isLatestRefresh,
  takeRefreshTicket,
} from "./refreshGuards";
import { messageOf } from "./breakdownShared";

/** WI-2b.7: load the context set (implicit default always present). */
export async function refreshContexts(workspaceRoot: string): Promise<void> {
  if (!isActiveWorkspace(workspaceRoot)) return; // audit #4/#5: no ticket for a left workspace
  const ticket = takeRefreshTicket("contexts");
  try {
    const contexts = await invoke<ContextRow[]>("coherence_contexts", {
      workspaceRoot,
    });
    if (!isLatestRefresh("contexts", ticket) || !isActiveWorkspace(workspaceRoot))
      return;
    useBreakdownStore.getState().setContexts(contexts);
  } catch (error) {
    if (!isLatestRefresh("contexts", ticket) || !isActiveWorkspace(workspaceRoot))
      return; // D1–D5: no stale/superseded error
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/** Create a named greenhouse context (D1.4 — enforcement is opt-in later). */
export async function createContext(
  workspaceRoot: string,
  name: string,
): Promise<void> {
  try {
    await invoke("coherence_context_create", {
      workspaceRoot,
      name,
      parent: null,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshContexts(workspaceRoot);
}

/**
 * Flip enforcement. The EXPLICIT human confirmation (D4.3) must happen
 * at the call site before this runs — this seam only records it.
 */
export async function setContextEnforcement(
  workspaceRoot: string,
  context: string,
  enforcing: boolean,
): Promise<void> {
  try {
    await invoke("coherence_context_enforce", {
      workspaceRoot,
      context,
      enforcing,
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshContexts(workspaceRoot);
}

/** WI-3.6: the pull-only branch-context candidate for the current branch. */
export async function refreshBranchCandidate(workspaceRoot: string): Promise<void> {
  if (!isActiveWorkspace(workspaceRoot)) return; // audit #4/#5: no ticket for a left workspace
  const ticket = takeRefreshTicket("branch");
  try {
    const candidate = await invoke<BranchCandidate | null>(
      "coherence_branch_candidate",
      { workspaceRoot },
    );
    if (!isLatestRefresh("branch", ticket) || !isActiveWorkspace(workspaceRoot))
      return;
    useBreakdownStore.getState().setBranchCandidate(candidate);
  } catch (error) {
    if (!isLatestRefresh("branch", ticket) || !isActiveWorkspace(workspaceRoot))
      return; // D1–D5: no stale/superseded error
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/** WI-3.6: create a context mapped to the current branch (explicit act). */
export async function createContextFromBranch(workspaceRoot: string): Promise<void> {
  try {
    await invoke("coherence_context_from_branch", { workspaceRoot });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshContexts(workspaceRoot);
  await refreshBranchCandidate(workspaceRoot);
}
