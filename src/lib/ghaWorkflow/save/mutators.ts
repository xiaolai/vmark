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
import { irToYamlMap } from "@/lib/ghaWorkflow/permissions/scopes";

// ─── Patch types ──────────────────────────────────────────────────────

/** Set a top-level workflow field (name, run-name, env.X, etc.). */
export interface WorkflowSetPatch {
  kind: "workflow.set";
  /** Dotted path, e.g., "name" or "env.NODE_VERSION". */
  path: string;
  value: string | number | boolean | null | string[];
}

/** Set a field on a specific job. path is dotted from the job's mapping. */
export interface JobSetPatch {
  kind: "job.set";
  jobId: string;
  path: string;
  value: string | number | boolean | null | string[];
}

/** Set a field on a specific step (by index in the job's steps[]). */
export interface StepSetPatch {
  kind: "step.set";
  jobId: string;
  stepIndex: number;
  path: string;
  value: string | number | boolean | null | string[];
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

/**
 * Replace a trigger's filter array (branches / paths / types etc.).
 *
 * Empty `value` removes the filter key entirely so the YAML stays clean.
 * Only supported when the YAML already encodes the trigger as a mapping
 * (i.e. `on: { push: { branches: [...] } }`), since reshaping
 * `on: push` (scalar) into a mapping changes the document's structural
 * shape and is better expressed in source. The mutator no-ops silently
 * for the scalar/array forms — the form layer hides the editable fields
 * in that case.
 */
export type TriggerFilter =
  | "branches"
  | "branches-ignore"
  | "tags"
  | "tags-ignore"
  | "paths"
  | "paths-ignore"
  | "types";

export interface TriggerSetFiltersPatch {
  kind: "trigger.setFilters";
  event: string;
  filter: TriggerFilter;
  value: string[];
}

/** Add a new job to jobs:. WI-C.1 */
export interface JobCreatePatch {
  kind: "job.create";
  jobId: string;
  runsOn?: string;
}

/** Remove a job from jobs:. WI-C.1 */
export interface JobDeletePatch {
  kind: "job.delete";
  jobId: string;
}

/** Insert a new step in a job's steps[] at the given index. WI-C.2 */
export interface StepInsertPatch {
  kind: "step.insert";
  jobId: string;
  index: number;
  step: { name?: string; uses?: string; run?: string };
}

/** Delete a step. WI-C.2 */
export interface StepDeletePatch {
  kind: "step.delete";
  jobId: string;
  stepIndex: number;
}

/** Move a step to a new index within the same job. WI-C.2 */
export interface StepMovePatch {
  kind: "step.move";
  jobId: string;
  fromIndex: number;
  toIndex: number;
}

/** Set workflow-level permissions. WI-C.3 */
export interface PermissionsSetPatch {
  kind: "workflow.permissions.set";
  /** "read-all" | "write-all" | "none" | record of scope→level | null (delete to restore default). */
  value:
    | "read-all"
    | "write-all"
    | "none"
    | Record<string, "read" | "write" | "none">
    | null;
}

/** Set workflow-level concurrency. WI-C.3 */
export interface ConcurrencySetPatch {
  kind: "workflow.concurrency.set";
  value:
    | string
    | { group: string; cancelInProgress: boolean }
    | null /* clear */;
}

export type IRPatch =
  | WorkflowSetPatch
  | JobSetPatch
  | StepSetPatch
  | WithSetPatch
  | WithRemovePatch
  | NeedsAddPatch
  | NeedsRemovePatch
  | TriggerSetFiltersPatch
  | JobCreatePatch
  | JobDeletePatch
  | StepInsertPatch
  | StepDeletePatch
  | StepMovePatch
  | PermissionsSetPatch
  | ConcurrencySetPatch;

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
    case "trigger.setFilters":
      setTriggerFilters(doc, patch.event, patch.filter, patch.value);
      return;
    case "job.create":
      createJob(doc, patch.jobId, patch.runsOn ?? "ubuntu-latest");
      return;
    case "job.delete":
      deleteJob(doc, patch.jobId);
      return;
    case "step.insert":
      insertStep(doc, patch.jobId, patch.index, patch.step);
      return;
    case "step.delete":
      deleteStep(doc, patch.jobId, patch.stepIndex);
      return;
    case "step.move":
      moveStep(doc, patch.jobId, patch.fromIndex, patch.toIndex);
      return;
    case "workflow.permissions.set":
      setPermissions(doc, patch.value);
      return;
    case "workflow.concurrency.set":
      setConcurrency(doc, patch.value);
      return;
    default: {
      const _exhaustive: never = patch;
      void _exhaustive;
    }
  }
}

// ─── Job CRUD (WI-C.1) ─────────────────────────────────────────────────

function createJob(doc: Document, jobId: string, runsOn: string): void {
  let jobs = doc.get("jobs", true);
  if (!isMap(jobs)) {
    // jobs: doesn't exist; create it. Rare for a real workflow file
    // but possible for skeletal templates.
    jobs = new YAMLMap();
    doc.set("jobs", jobs);
  }
  // Refuse to overwrite an existing job — silent no-op per the
  // file's "stale state should not throw" rule.
  if ((jobs as YAMLMap).get(jobId, true)) return;
  const jobMap = new YAMLMap();
  jobMap.set("runs-on", runsOn);
  const stepsSeq = new YAMLSeq();
  jobMap.set("steps", stepsSeq);
  (jobs as YAMLMap).set(jobId, jobMap);
}

function deleteJob(doc: Document, jobId: string): void {
  const jobs = doc.get("jobs", true);
  if (!isMap(jobs)) return;
  jobs.delete(jobId);
}

// ─── Step CRUD (WI-C.2) ───────────────────────────────────────────────

function insertStep(
  doc: Document,
  jobId: string,
  index: number,
  step: { name?: string; uses?: string; run?: string },
): void {
  withJob(doc, jobId, (jobMap) => {
    let seq = jobMap.get("steps", true) as unknown as YAMLSeq | undefined;
    if (!isSeq(seq)) {
      seq = new YAMLSeq();
      jobMap.set("steps", seq);
    }
    const stepMap = new YAMLMap();
    if (step.name) stepMap.set("name", step.name);
    if (step.uses) stepMap.set("uses", step.uses);
    if (step.run) stepMap.set("run", step.run);
    if (!step.uses && !step.run && !step.name) {
      stepMap.set("run", "echo TODO");
    }
    const seqRef = seq!;
    const clamped = Math.max(0, Math.min(index, seqRef.items.length));
    seqRef.items.splice(clamped, 0, stepMap);
  });
}

function deleteStep(doc: Document, jobId: string, stepIndex: number): void {
  withJob(doc, jobId, (jobMap) => {
    const steps = jobMap.get("steps", true);
    if (!isSeq(steps)) return;
    if (stepIndex < 0 || stepIndex >= steps.items.length) return;
    steps.items.splice(stepIndex, 1);
  });
}

function moveStep(
  doc: Document,
  jobId: string,
  fromIndex: number,
  toIndex: number,
): void {
  withJob(doc, jobId, (jobMap) => {
    const steps = jobMap.get("steps", true);
    if (!isSeq(steps)) return;
    const len = steps.items.length;
    if (fromIndex < 0 || fromIndex >= len) return;
    const clampedTo = Math.max(0, Math.min(toIndex, len - 1));
    if (clampedTo === fromIndex) return;
    const [item] = steps.items.splice(fromIndex, 1);
    steps.items.splice(clampedTo, 0, item);
  });
}

// ─── Workflow-level forms (WI-C.3) ────────────────────────────────────

function setPermissions(
  doc: Document,
  value:
    | "read-all"
    | "write-all"
    | "none"
    | Record<string, "read" | "write" | "none">
    | null,
): void {
  if (value === null) {
    doc.delete("permissions");
    return;
  }
  if (typeof value === "string") {
    doc.set("permissions", value);
    return;
  }
  // Per-scope mapping. The form passes IR-shape (camelCase) keys; we
  // convert to YAML-shape (kebab-case) before serializing so the file
  // matches GHA convention. Codex audit HIGH-2 fix.
  const map = new YAMLMap();
  for (const [k, v] of Object.entries(value)) {
    const kebab = irToYamlMap({ [k]: v });
    for (const [yamlKey, yamlVal] of Object.entries(kebab)) {
      map.set(yamlKey, yamlVal);
    }
  }
  doc.set("permissions", map);
}

function setConcurrency(
  doc: Document,
  value: string | { group: string; cancelInProgress: boolean } | null,
): void {
  if (value == null) {
    doc.delete("concurrency");
    return;
  }
  if (typeof value === "string") {
    doc.set("concurrency", value);
    return;
  }
  const map = new YAMLMap();
  map.set("group", value.group);
  map.set("cancel-in-progress", value.cancelInProgress);
  doc.set("concurrency", map);
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

/**
 * Convert array values into a YAMLSeq so they round-trip as
 * `[a, b, c]` / block-form sequences instead of being stringified into
 * a single scalar. Without this the runs-on multi-label form
 * (`["self-hosted", "linux", "x64"]`) was being collapsed into one
 * unmatched runner label string on save (cross-validator audit).
 */
function valueToYamlNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    const seq = new YAMLSeq();
    for (const v of value) seq.add(v);
    return seq;
  }
  return value;
}

function setByPath(doc: Document, path: string, value: unknown): void {
  const parts = path.split(".");
  const yamlValue = valueToYamlNode(value);
  if (parts.length === 1) {
    doc.set(parts[0], yamlValue);
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
  if (isMap(cur)) cur.set(parts[parts.length - 1], yamlValue);
}

function setMapByPath(map: YAMLMap, path: string, value: unknown): void {
  const parts = path.split(".");
  const yamlValue = valueToYamlNode(value);
  if (parts.length === 1) {
    map.set(parts[0], yamlValue);
    return;
  }
  let cur: unknown = map;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isMap(cur)) return;
    cur = cur.get(parts[i], true);
  }
  if (isMap(cur)) cur.set(parts[parts.length - 1], yamlValue);
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

// ─── Helpers — trigger filters ───────────────────────────────────────

/**
 * Set or clear a filter array on a trigger event. Only operates when
 * `on:` is a mapping AND `on.<event>` is a mapping — the only shape
 * where filters can attach. Other shapes (scalar, sequence, sequence
 * of strings) are out-of-scope for this mutator since reshaping them
 * would surprise users. Empty `value` removes the filter key.
 */
function setTriggerFilters(
  doc: Document,
  event: string,
  filter: TriggerFilter,
  value: string[],
): void {
  const onNode = doc.get("on", true);
  if (!isMap(onNode)) return;
  const eventNode = onNode.get(event, true);
  if (!isMap(eventNode)) return;
  if (value.length === 0) {
    eventNode.delete(filter);
    return;
  }
  const seq = new YAMLSeq();
  for (const v of value) seq.add(v);
  eventNode.set(filter, seq);
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
