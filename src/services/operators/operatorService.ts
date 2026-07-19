/**
 * Operator service (Phase 3, WI-3.5/3.6 frontend) — ADR-013 services tier.
 *
 * Thin `invoke` wrappers over the Rust forward-operator commands
 * (`coherence_operator_propose` / `_preview` / `_accept`). `propose` and
 * `preview` are read-only; `accept` is the human-only commit. A candidate is
 * content-addressed and resubmitted whole (v4.6), and the `preview`'s
 * `structuralClasses` are held by the caller and passed back to `accept` — the
 * kernel reprojects them under a lock, so a concurrent change is rejected.
 *
 * Errors surface to the caller (the panel renders them); nothing is thrown past
 * a mapped Error.
 *
 * @coordinates-with src-tauri/src/coherence/operator_commands.rs — the IPC surface
 * @module services/operators/operatorService
 */
import { invoke } from "@tauri-apps/api/core";

/** A candidate on the wire — mirrors Rust `OperatorCandidate` (camelCase). */
export interface OperatorCandidate {
  object: string;
  content: string;
  base: string;
  inputs?: unknown[];
  operator: string;
  summary: string;
  /** Display only; the server recomputes it (the tamper check). */
  revision: string;
}

/** Unique physical edge identity — the reproject map key (v4.3). */
export interface PhysicalEdgeId {
  txf: string;
  input: number;
  downstream: string;
  downstreamRev: string;
}

/** One affected edge whose class changes under the candidate (the blast radius). */
interface PreviewDelta {
  edge: PhysicalEdgeId;
  before: unknown;
  after: unknown;
}

export interface PreviewResult {
  candidateRevision: string;
  localDelta: PreviewDelta[];
  /** The snapshot resubmitted to `accept` (v4.3/v4.6). */
  structuralClasses: [PhysicalEdgeId, unknown][];
  truncated: boolean;
}

export interface AcceptReceipt {
  entryId: string;
  revision: string;
  /** False when a retry returned the original entry (idempotent). */
  committed: boolean;
}

/** Run the operator over an object's live text → its candidates (read-only). */
export async function proposeOperator(
  workspaceRoot: string,
  object: string,
  content: string,
): Promise<OperatorCandidate[]> {
  return invoke<OperatorCandidate[]>("coherence_operator_propose", {
    workspaceRoot,
    object,
    content,
  });
}

/** Project a candidate without committing (read-only) → delta + class snapshot. */
export async function previewCandidate(
  workspaceRoot: string,
  candidate: OperatorCandidate,
): Promise<PreviewResult> {
  return invoke<PreviewResult>("coherence_operator_preview", {
    workspaceRoot,
    candidate,
  });
}

/** Accept a previewed candidate (human-only). Resubmit the candidate + classes. */
export async function acceptCandidate(
  workspaceRoot: string,
  candidate: OperatorCandidate,
  structuralClasses: [PhysicalEdgeId, unknown][],
): Promise<AcceptReceipt> {
  return invoke<AcceptReceipt>("coherence_operator_accept", {
    workspaceRoot,
    candidate,
    structuralClasses,
  });
}
