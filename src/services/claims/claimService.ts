/**
 * Claim service (WI-2b.6) — the IPC seam for the claim lifecycle
 * (design-2a.md D2: four explicit human acts on a stable claim id).
 * Errors land in the store (`error`), never thrown past this seam —
 * the panel renders them; stale rows stay visible so a failed refresh
 * never blanks a list the user is working through.
 *
 * @coordinates-with src-tauri/src/coherence/claim_commands.rs — the IPC surface
 * @coordinates-with stores/claimStore.ts — the mirror this writes
 * @module services/claims/claimService
 */
import { invoke } from "@tauri-apps/api/core";
import { useClaimStore, type ClaimRow } from "@/stores/claimStore";
import {
  isActiveWorkspace,
  isLatestRefresh,
  takeRefreshTicket,
} from "@/services/breakdown/breakdownService";
// This file carried the THIRD copy of `messageOf`. `coherence_claim*` now
// rejects with a typed CommandError — a plain object, not an Error — so the old
// `String(error)` fallback would have put the literal "[object Object]" into
// `useClaimStore.setError`, i.e. in front of the user. One shared definition, so
// the next command migration cannot resurrect the bug in a fourth place.
import { messageOf } from "@/services/breakdown/breakdownShared";

/** The implicit default context's fixed id (spec §5.4.4 revision 1). */
export const DEFAULT_CONTEXT_ID = "00000000-0000-0000-0000-000000000000";

export async function refreshClaims(workspaceRoot: string): Promise<void> {
  // Never refresh a workspace the user has already left: the synchronous
  // loading/error writes below would land on the store the new workspace
  // shows, and taking a ticket here would starve the active refresh
  // (audit #4/#5).
  if (!isActiveWorkspace(workspaceRoot)) return;
  const ticket = takeRefreshTicket("claims");
  const store = useClaimStore.getState();
  store.setLoading(true);
  store.setError(null);
  try {
    const rows = await invoke<ClaimRow[]>("coherence_claims", { workspaceRoot });
    if (!isLatestRefresh("claims", ticket) || !isActiveWorkspace(workspaceRoot))
      return;
    useClaimStore.getState().setRows(rows);
  } catch (error) {
    if (!isLatestRefresh("claims", ticket) || !isActiveWorkspace(workspaceRoot))
      return; // D1–D5: no stale/superseded error
    useClaimStore.getState().setError(messageOf(error));
  } finally {
    // Runs even on the stale `return`; only the newest ticket owns loading,
    // so a superseded or left-workspace refresh never clears it prematurely.
    if (isLatestRefresh("claims", ticket)) {
      useClaimStore.getState().setLoading(false);
    }
  }
}

export interface ClaimActionRequest {
  action: "create" | "promote" | "correct" | "retire";
  claim?: string;
  statement?: string;
  valid_at?: string;
  invalid_at?: string;
  source_path?: string;
}

/** Append one lifecycle act, then refresh so the list reflects it. */
export async function performClaimAction(
  workspaceRoot: string,
  request: ClaimActionRequest,
): Promise<boolean> {
  try {
    await invoke("coherence_claim", { workspaceRoot, request });
  } catch (error) {
    useClaimStore.getState().setError(messageOf(error));
    return false;
  }
  await refreshClaims(workspaceRoot);
  return true;
}

/** D2.4: reversible visibility in the default context (v1 UI surface). */
export async function scopeClaim(
  workspaceRoot: string,
  claim: string,
  visible: boolean,
): Promise<void> {
  try {
    await invoke("coherence_claim_scope", {
      workspaceRoot,
      context: DEFAULT_CONTEXT_ID,
      claim,
      visible,
    });
  } catch (error) {
    useClaimStore.getState().setError(messageOf(error));
  }
}
