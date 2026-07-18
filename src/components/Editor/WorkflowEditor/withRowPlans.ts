/**
 * Purpose: Pure patch planning for StepForm's `with:` key/value rows.
 *   Computes which IRPatches to cancel and queue when a row is committed
 *   (blur) or removed, so the patch queue never retains stale keys.
 *
 * Key decisions:
 *   - Every row tracks `committedKey` — the key of its last queued
 *     with.set. A rename chain (a → b → c) cancels set(b) when c commits;
 *     without this the intermediate set(b) leaked into the saved YAML
 *     (Codex audit finding 1).
 *   - A commit whose (trimmed) key is already held by another row plans
 *     `duplicate` instead of queueing: with.set targets dedup by key, so
 *     two rows sharing a key would silently collapse to one entry while
 *     the UI shows both (finding 2). A duplicate row also cancels its own
 *     previously queued patches — an invalid row contributes nothing.
 *   - Cancel patches are with.set patches with an empty value; the store
 *     cancels by target (jobId, stepIndex, key), ignoring the value, and
 *     with.set / with.remove share a target.
 *   - Because targets are shared, a queued patch under key k is OWNED by
 *     whichever row last committed under k. Cancels (and removal's queued
 *     with.remove) are therefore guarded by the other rows' committedKeys:
 *     touching a target another row owns would destroy that row's patch
 *     (Codex verify regression C2 — cross-row rename onto a shared key).
 *
 * @coordinates-with StepForm.tsx — sole consumer; applies plans to the store
 * @coordinates-with src/stores/workflowStore.ts — patchTarget/dedup semantics
 * @module components/Editor/WorkflowEditor/withRowPlans
 */

import type { StepIR } from "@/lib/ghaWorkflow/types";
import type { IRPatch } from "@/stores/workflowStore";

export interface WithRow {
  key: string;
  value: string;
  /** Original key when this row was loaded from IR; null for newly added rows. */
  originalKey: string | null;
  /** Key of this row's last queued with.set; null when nothing is queued. */
  committedKey: string | null;
  /** True when the last commit was rejected because another row holds the key. */
  duplicateKey: boolean;
}

/** Context identifying which step's `with:` block the patches target. */
export interface WithRowContext {
  jobId: string;
  stepIndex: number;
}

/** The slice of every OTHER row the planners need for duplicate detection
 * (current key) and patch-ownership guards (committedKey). */
export type OtherRowClaim = Pick<WithRow, "key" | "committedKey">;

/** Trimmed committedKeys of the other rows — the targets they own. */
function ownedTargets(others: readonly OtherRowClaim[]): Set<string> {
  const owned = new Set<string>();
  for (const other of others) {
    if (other.committedKey) owned.add(other.committedKey.trim());
  }
  return owned;
}

export type WithRowCommitPlan =
  | { kind: "noop" }
  | { kind: "duplicate"; cancels: IRPatch[] }
  | {
      kind: "patches";
      cancels: IRPatch[];
      queues: IRPatch[];
      /** New committedKey for the row (null = nothing queued anymore). */
      committedKey: string | null;
    };

export function withRowsFromStep(step: StepIR): WithRow[] {
  if (!step.with) return [];
  return Object.entries(step.with).map(([key, value]) => ({
    key,
    value: value == null ? "" : String(value),
    originalKey: key,
    committedKey: null,
    duplicateKey: false,
  }));
}

/** A fresh, uncommitted row (empty by default; keyed for suggested inputs). */
export function newWithRow(key = ""): WithRow {
  return { key, value: "", originalKey: null, committedKey: null, duplicateKey: false };
}

function cancelSet(ctx: WithRowContext, key: string): IRPatch {
  return { kind: "with.set", ...ctx, key, value: "" };
}

/**
 * Plan the patches for committing `row` (key or value blur).
 * `others` carries every OTHER row's current key (duplicate detection) and
 * committedKey (patch-ownership guard). `stepWith` is the step's IR `with:`
 * block, the source of truth for "did the value actually change".
 */
export function planWithRowCommit(
  ctx: WithRowContext,
  row: WithRow,
  others: readonly OtherRowClaim[],
  stepWith: StepIR["with"],
): WithRowCommitPlan {
  const trimmedKey = row.key.trim();
  if (!trimmedKey) return { kind: "noop" };

  const owned = ownedTargets(others);
  const cancelUnlessOwned = (cancels: IRPatch[], key: string): void => {
    // A target another row committed under holds THAT row's patch now
    // (same-target patches replace each other) — cancelling would destroy it.
    if (!owned.has(key.trim())) cancels.push(cancelSet(ctx, key));
  };

  if (others.some((other) => other.key.trim() === trimmedKey)) {
    // Another row holds this key: queueing would silently collapse both
    // rows into one patch. Cancel anything this row previously queued so
    // the invalid row contributes nothing until the conflict is resolved.
    const cancels: IRPatch[] = [];
    if (row.committedKey) cancelUnlessOwned(cancels, row.committedKey);
    if (row.originalKey && row.originalKey !== row.committedKey) {
      cancelUnlessOwned(cancels, row.originalKey);
    }
    return { kind: "duplicate", cancels };
  }

  const cancels: IRPatch[] = [];
  // Rename chain (a → b → c): drop the intermediate key's set before
  // queueing under the new key, or set(b) survives into the YAML.
  if (
    row.committedKey &&
    row.committedKey !== row.key &&
    row.committedKey !== row.originalKey
  ) {
    cancelUnlessOwned(cancels, row.committedKey);
  }

  const renamed = row.originalKey !== null && row.originalKey !== row.key;
  // Look up the original value via the IR (not stale local state) so blur
  // events without an actual edit don't dirty the queue with no-op patches.
  const originalValue =
    row.originalKey && stepWith ? String(stepWith[row.originalKey] ?? "") : null;
  const valueChanged = originalValue === null || row.value !== originalValue;

  if (!renamed && !valueChanged) {
    // Reverted to the IR original: drop any queued patch under this key
    // (with.set and with.remove share a target, so this also clears a
    // pending remove from an earlier rename).
    cancelUnlessOwned(cancels, row.originalKey ?? row.key);
    return { kind: "patches", cancels, queues: [], committedKey: null };
  }

  const queues: IRPatch[] = [];
  // Skip the remove when another row committed under our ORIGINAL key (it
  // took the key over — queueing remove would replace that row's set). The
  // set(row.key) below needs no guard: a row owning that target while
  // displaying it is caught by duplicate detection above, and a row renaming
  // AWAY from it leaves an obsolete patch that replacing is correct.
  if (renamed && !owned.has(row.originalKey!.trim())) {
    queues.push({ kind: "with.remove", ...ctx, key: row.originalKey! });
  }
  queues.push({ kind: "with.set", ...ctx, key: row.key, value: row.value });
  return { kind: "patches", cancels, queues, committedKey: row.key };
}

/**
 * Plan the patches for removing `row`. A removed row must leave no queued
 * with.set behind — cancel the set under its CURRENT key and under its last
 * COMMITTED key (they differ when the key was retyped without a blur); a
 * pre-existing row then queues with.remove for its original key.
 *
 * Both cancels and the queued with.remove skip targets another row has
 * committed under: cancelling would destroy that row's patch, and queueing
 * a remove would replace its set (shared target) — the surviving row's set
 * overwrites the original value on save, which is the intended outcome.
 */
export function planWithRowRemoval(
  ctx: WithRowContext,
  row: WithRow,
  others: readonly OtherRowClaim[],
): { cancels: IRPatch[]; queues: IRPatch[] } {
  const owned = ownedTargets(others);
  const cancels: IRPatch[] = [];
  if (row.key && row.key !== row.originalKey && !owned.has(row.key.trim())) {
    cancels.push(cancelSet(ctx, row.key));
  }
  if (
    row.committedKey &&
    row.committedKey !== row.key &&
    row.committedKey !== row.originalKey &&
    !owned.has(row.committedKey.trim())
  ) {
    cancels.push(cancelSet(ctx, row.committedKey));
  }
  const queues: IRPatch[] = [];
  if (row.originalKey && !owned.has(row.originalKey.trim())) {
    queues.push({ kind: "with.remove", ...ctx, key: row.originalKey });
  }
  return { cancels, queues };
}
