/**
 * Purpose: Apply IR-level patches to a `yaml` Document while
 *   preserving comments, anchors, key order, and formatting.
 *
 *   The forms editor (Phase 7) accumulates IRPatches in the
 *   workflowEditStore; on save, each patch is dispatched to one of
 *   the per-family mutators below, then the Document is serialized
 *   via stringifyCst().
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md
 *   §6 Phase 8 / WI-8.2.
 *
 * Key decisions:
 *   - Patches are typed by `kind` so the dispatcher is exhaustive.
 *   - Unknown jobId / out-of-range stepIndex is a no-op rather than
 *     a throw — the caller may have stale state and a no-op is the
 *     least-surprising recovery.
 *   - Mutators always go through the Document/Map APIs so the CST is
 *     mutated rather than rewritten — that's what preserves comments.
 *
 * @coordinates-with src/lib/ghaWorkflow/save/cstParser.ts — parses + serializes
 * @coordinates-with src/stores/workflowEditStore.ts (Phase 7) — patch source
 * @module lib/ghaWorkflow/save/mutators
 */

import type { Document } from "yaml";
import { isMap, isSeq, isScalar, YAMLMap, YAMLSeq } from "yaml";

// ─── Patch types ──────────────────────────────────────────────────────

/** Set a top-level workflow field (name, run-name, env.X, etc.). */
export interface WorkflowSetPatch {
  kind: "workflow.set";
  /** Dotted path, e.g., "name" or "env.NODE_VERSION". */
  path: string;
  value: string | number | boolean | null;
}

/** Set a field on a specific job. path is dotted from the job's mapping. */
export interface JobSetPatch {
  kind: "job.set";
  jobId: string;
  path: string;
  value: string | number | boolean | null;
}

/** Set a field on a specific step (by index in the job's steps[]). */
export interface StepSetPatch {
  kind: "step.set";
  jobId: string;
  stepIndex: number;
  path: string;
  value: string | number | boolean | null;
}

/** Set a key in a step's `with:` block. */
export interface WithSetPatch {
  kind: "with.set";
  jobId: string;
  stepIndex: number;
  key: string;
  value: string | number | boolean;
}

/** Remove a key from a step's `with:` block. */
export interface WithRemovePatch {
  kind: "with.remove";
  jobId: string;
  stepIndex: number;
  key: string;
}

/** Add a job id to another job's `needs:`. */
export interface NeedsAddPatch {
  kind: "needs.add";
  jobId: string;
  ref: string;
}

/** Remove a job id from another job's `needs:`. */
export interface NeedsRemovePatch {
  kind: "needs.remove";
  jobId: string;
  ref: string;
}

export type IRPatch =
  | WorkflowSetPatch
  | JobSetPatch
  | StepSetPatch
  | WithSetPatch
  | WithRemovePatch
  | NeedsAddPatch
  | NeedsRemovePatch;

// ─── Dispatcher ──────────────────────────────────────────────────────

/**
 * Apply one patch to the Document in place. Unknown jobIds and
 * out-of-range stepIndexes are no-ops — caller may have stale IR
 * state; silent recovery beats surfacing an error mid-batch.
 */
export function applyPatch(doc: Document, patch: IRPatch): void {
  switch (patch.kind) {
    case "workflow.set":
      setByPath(doc, patch.path, patch.value);
      return;
    case "job.set":
      withJob(doc, patch.jobId, (jobMap) =>
        setMapByPath(jobMap, patch.path, patch.value),
      );
      return;
    case "step.set":
      withStep(doc, patch.jobId, patch.stepIndex, (stepMap) =>
        setMapByPath(stepMap, patch.path, patch.value),
      );
      return;
    case "with.set":
      withStep(doc, patch.jobId, patch.stepIndex, (stepMap) =>
        setNestedMapKey(stepMap, "with", patch.key, patch.value),
      );
      return;
    case "with.remove":
      withStep(doc, patch.jobId, patch.stepIndex, (stepMap) =>
        removeNestedMapKey(stepMap, "with", patch.key),
      );
      return;
    case "needs.add":
      withJob(doc, patch.jobId, (jobMap) => addNeeds(jobMap, patch.ref));
      return;
    case "needs.remove":
      withJob(doc, patch.jobId, (jobMap) =>
        removeNeeds(jobMap, patch.ref),
      );
      return;
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = patch;
      void _exhaustive;
    }
  }
}

// ─── Helpers — locating job/step ─────────────────────────────────────

function withJob(
  doc: Document,
  jobId: string,
  fn: (jobMap: YAMLMap) => void,
): void {
  const jobs = doc.get("jobs", true);
  if (!isMap(jobs)) return;
  const jobMap = jobs.get(jobId, true);
  if (!isMap(jobMap)) return;
  fn(jobMap);
}

function withStep(
  doc: Document,
  jobId: string,
  stepIndex: number,
  fn: (stepMap: YAMLMap) => void,
): void {
  withJob(doc, jobId, (jobMap) => {
    const steps = jobMap.get("steps", true);
    if (!isSeq(steps)) return;
    if (stepIndex < 0 || stepIndex >= steps.items.length) return;
    const step = steps.get(stepIndex, true) as YAMLMap | undefined;
    if (!isMap(step)) return;
    fn(step);
  });
}

// ─── Helpers — path-based set ────────────────────────────────────────

function setByPath(doc: Document, path: string, value: unknown): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    doc.set(parts[0], value);
    return;
  }
  // Walk into nested mappings, creating intermediates if missing.
  let cur: YAMLMap | unknown = doc.contents;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isMap(cur)) return;
    const next = cur.get(parts[i], true);
    if (isMap(next)) {
      cur = next;
    } else {
      const newMap = new YAMLMap();
      cur.set(parts[i], newMap);
      cur = newMap;
    }
  }
  if (isMap(cur)) cur.set(parts[parts.length - 1], value);
}

function setMapByPath(map: YAMLMap, path: string, value: unknown): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    map.set(parts[0], value);
    return;
  }
  let cur: unknown = map;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isMap(cur)) return;
    cur = cur.get(parts[i], true);
  }
  if (isMap(cur)) cur.set(parts[parts.length - 1], value);
}

function setNestedMapKey(
  parent: YAMLMap,
  parentKey: string,
  innerKey: string,
  value: unknown,
): void {
  const existing = parent.get(parentKey, true);
  let inner: YAMLMap;
  if (isMap(existing)) {
    inner = existing;
  } else {
    inner = new YAMLMap();
    parent.set(parentKey, inner);
  }
  inner.set(innerKey, value);
}

function removeNestedMapKey(
  parent: YAMLMap,
  parentKey: string,
  innerKey: string,
): void {
  const inner = parent.get(parentKey, true);
  if (!isMap(inner)) return;
  inner.delete(innerKey);
}

// ─── Helpers — needs[] ───────────────────────────────────────────────

function addNeeds(jobMap: YAMLMap, ref: string): void {
  const existing = jobMap.get("needs", true);
  if (existing == null) {
    const seq = new YAMLSeq();
    seq.add(ref);
    jobMap.set("needs", seq);
    return;
  }
  if (isScalar(existing)) {
    const oldVal = String(existing.value);
    if (oldVal === ref) return;
    const seq = new YAMLSeq();
    seq.add(oldVal);
    seq.add(ref);
    jobMap.set("needs", seq);
    return;
  }
  if (isSeq(existing)) {
    const seq = existing as YAMLSeq;
    const has = seq.items.some((it: unknown) => {
      if (isScalar(it)) return String(it.value) === ref;
      return false;
    });
    if (!has) seq.add(ref);
    return;
  }
}

function removeNeeds(jobMap: YAMLMap, ref: string): void {
  const existing = jobMap.get("needs", true);
  if (existing == null) return;
  if (isScalar(existing)) {
    if (String(existing.value) === ref) jobMap.delete("needs");
    return;
  }
  if (isSeq(existing)) {
    const seq = existing as YAMLSeq;
    const idx = seq.items.findIndex((it: unknown) => {
      if (isScalar(it)) return String(it.value) === ref;
      return false;
    });
    if (idx >= 0) seq.delete(idx);
    if (seq.items.length === 0) jobMap.delete("needs");
    return;
  }
}
