/**
 * Semantic-layer acts split from breakdownService for the file-size
 * gate (WI-3.2/3.4): provenance recovery and delegation lifecycle over
 * the coherence IPC. Same error posture — failures land in the
 * breakdown store, never thrown past the seam.
 *
 * @coordinates-with src-tauri/src/coherence/provenance_commands.rs
 * @coordinates-with src-tauri/src/coherence/delegation_commands.rs
 * @module services/breakdown/semanticActs
 */
import { invoke } from "@tauri-apps/api/core";
import {
  useBreakdownStore,
  type DelegationRow,
  type ProposedInput,
  type ProvenanceCandidate,
} from "@/stores/breakdownStore";
import { refreshBreakdown } from "./breakdownService";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** WI-3.2: refresh the orphaned-but-recoverable candidates (pull-only). */
export async function refreshProvenance(workspaceRoot: string): Promise<void> {
  try {
    const candidates = await invoke<ProvenanceCandidate[]>(
      "coherence_provenance_candidates",
      { workspaceRoot },
    );
    useBreakdownStore.getState().setProvenance(candidates);
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/** Fetch the proposal for one candidate — head token + proposed inputs. */
export async function proposeInputs(
  workspaceRoot: string,
  path: string,
): Promise<{ head: string; inputs: ProposedInput[] } | null> {
  try {
    return await invoke<{ head: string; inputs: ProposedInput[] }>(
      "coherence_propose_inputs",
      { workspaceRoot, path },
    );
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return null;
  }
}

/**
 * Append the provenance-confirmation (idem minted here, once per
 * logical confirm — retries reuse it), then refresh both surfaces.
 */
export async function confirmInputs(
  workspaceRoot: string,
  path: string,
  head: string,
  inputs: ProposedInput[],
): Promise<void> {
  try {
    await invoke("coherence_confirm_inputs", {
      workspaceRoot,
      request: { path, head, inputs, idem: crypto.randomUUID() },
    });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshProvenance(workspaceRoot);
  await refreshBreakdown(workspaceRoot);
}

/** WI-3.4: live agent delegations. */
export async function refreshDelegations(workspaceRoot: string): Promise<void> {
  try {
    const rows = await invoke<DelegationRow[]>("coherence_delegations", {
      workspaceRoot,
    });
    useBreakdownStore.getState().setDelegations(rows);
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
  }
}

/**
 * Record a grant or revocation. The EXPLICIT human confirmation (D2.2)
 * happens at the call site before this runs.
 */
export async function delegate(
  workspaceRoot: string,
  request: {
    delegate: string;
    scope: string[];
    expires: string;
    revoke?: string;
  },
): Promise<void> {
  try {
    await invoke("coherence_delegate", { workspaceRoot, request });
  } catch (error) {
    useBreakdownStore.getState().setError(messageOf(error));
    return;
  }
  await refreshDelegations(workspaceRoot);
}
