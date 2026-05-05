/**
 * Purpose: WI-C0 — apply structural patches (job.create/delete,
 *   step.insert/delete/move) to a parsed IR to produce a "preview"
 *   IR that the form layer renders, so freshly-added jobs/steps are
 *   visible before the user clicks Save.
 *
 *   Non-structural patches (job.set, with.set, trigger.setFilters,
 *   workflow.permissions.set, workflow.concurrency.set) are skipped:
 *   the corresponding form components track these via local React
 *   state, so the IR doesn't need to lag-update.
 *
 *   Returns the same IR reference when no structural patches apply,
 *   keeping React's referential-equality short-circuits intact.
 *
 * @coordinates-with src/lib/ghaWorkflow/save/mutators.ts — patch types
 * @coordinates-with src/components/Editor/WorkflowEditor/WorkflowEditorPanel.tsx — consumer
 * @module lib/ghaWorkflow/save/previewIR
 */

import type { WorkflowIR, JobIR, StepIR } from "@/lib/ghaWorkflow/types";
import type { IRPatch } from "./mutators";

const ZERO_RANGE = {
  startLine: 0,
  startCol: 0,
  endLine: 0,
  endCol: 0,
} as const;

/**
 * Patches that change the SET of jobs/steps. These mutate the IR's
 * `jobs[]` length or step ordering, so the form layer needs to see
 * them in the preview.
 */
function isStructural(patch: IRPatch): boolean {
  return (
    patch.kind === "job.create" ||
    patch.kind === "job.delete" ||
    patch.kind === "step.insert" ||
    patch.kind === "step.delete" ||
    patch.kind === "step.move"
  );
}

/**
 * Patches that change a step's CONTENT (name, run, with, etc.).
 * Codex audit HIGH-3: edits to freshly-created jobs/steps were lost
 * on form remount because the form's local React state didn't survive
 * the unmount and the IR didn't carry the value yet. Applying these
 * to the preview IR fixes the persistence.
 */
function isContent(patch: IRPatch): boolean {
  return (
    patch.kind === "job.set" ||
    patch.kind === "step.set" ||
    patch.kind === "with.set" ||
    patch.kind === "with.remove"
  );
}

function cloneJob(job: JobIR): JobIR {
  return { ...job, steps: [...job.steps], needs: [...job.needs] };
}

function applyOne(ir: WorkflowIR, patch: IRPatch): WorkflowIR {
  if (!isStructural(patch) && !isContent(patch)) return ir;

  const jobs = ir.jobs.map(cloneJob);

  // Content patches: apply scalar/value changes to the matching job/step.
  if (patch.kind === "job.set") {
    const job = jobs.find((j) => j.id === patch.jobId);
    if (!job) return ir;
    if (patch.value === null || typeof patch.value === "number" || typeof patch.value === "boolean") {
      return ir;
    }
    applyJobScalar(job, patch.path, patch.value);
    return { ...ir, jobs };
  }
  if (patch.kind === "step.set") {
    const job = jobs.find((j) => j.id === patch.jobId);
    if (!job) return ir;
    if (patch.stepIndex < 0 || patch.stepIndex >= job.steps.length) return ir;
    if (typeof patch.value !== "string") return ir;
    job.steps[patch.stepIndex] = applyStepScalar(
      job.steps[patch.stepIndex],
      patch.path,
      patch.value,
    );
    return { ...ir, jobs };
  }
  if (patch.kind === "with.set") {
    const job = jobs.find((j) => j.id === patch.jobId);
    if (!job) return ir;
    if (patch.stepIndex < 0 || patch.stepIndex >= job.steps.length) return ir;
    const step = job.steps[patch.stepIndex];
    job.steps[patch.stepIndex] = {
      ...step,
      with: { ...(step.with ?? {}), [patch.key]: patch.value },
    };
    return { ...ir, jobs };
  }
  if (patch.kind === "with.remove") {
    const job = jobs.find((j) => j.id === patch.jobId);
    if (!job) return ir;
    if (patch.stepIndex < 0 || patch.stepIndex >= job.steps.length) return ir;
    const step = job.steps[patch.stepIndex];
    if (!step.with) return ir;
    const next = { ...step.with };
    delete next[patch.key];
    job.steps[patch.stepIndex] = { ...step, with: next };
    return { ...ir, jobs };
  }

  if (patch.kind === "job.create") {
    if (jobs.find((j) => j.id === patch.jobId)) return ir;
    const newJob: JobIR = {
      id: patch.jobId,
      name: undefined,
      runsOn: [patch.runsOn ?? "ubuntu-latest"],
      needs: [],
      steps: [],
      position: { ...ZERO_RANGE },
    };
    jobs.push(newJob);
    return { ...ir, jobs };
  }

  if (patch.kind === "job.delete") {
    return { ...ir, jobs: jobs.filter((j) => j.id !== patch.jobId) };
  }

  // Remaining patches: step.insert | step.delete | step.move.
  // The discriminated union has narrowed at this point, but TS needs
  // an explicit guard before reading patch.jobId.
  if (
    patch.kind !== "step.insert" &&
    patch.kind !== "step.delete" &&
    patch.kind !== "step.move"
  ) {
    return ir;
  }
  const job = jobs.find((j) => j.id === patch.jobId);
  if (!job) return ir;

  if (patch.kind === "step.insert") {
    const synthId =
      patch.step.uses ?? patch.step.name ?? `step-${job.steps.length + 1}`;
    const newStep: StepIR = {
      id: synthId,
      idSynthesized: true,
      name: patch.step.name,
      uses: patch.step.uses,
      run: patch.step.run,
      position: { ...ZERO_RANGE },
    } as StepIR;
    const clamped = Math.max(0, Math.min(patch.index, job.steps.length));
    job.steps.splice(clamped, 0, newStep);
    return { ...ir, jobs };
  }

  if (patch.kind === "step.delete") {
    if (patch.stepIndex < 0 || patch.stepIndex >= job.steps.length) return ir;
    job.steps.splice(patch.stepIndex, 1);
    return { ...ir, jobs };
  }

  if (patch.kind === "step.move") {
    const len = job.steps.length;
    if (patch.fromIndex < 0 || patch.fromIndex >= len) return ir;
    const clampedTo = Math.max(0, Math.min(patch.toIndex, len - 1));
    if (clampedTo === patch.fromIndex) return ir;
    const [item] = job.steps.splice(patch.fromIndex, 1);
    job.steps.splice(clampedTo, 0, item);
    return { ...ir, jobs };
  }

  return ir;
}

function applyJobScalar(
  job: JobIR,
  path: string,
  value: string | string[],
): void {
  // Map IR-level path strings to JobIR fields. Same shape the
  // CST mutator uses; kept narrow so unsupported paths fall through
  // safely (the save-side mutator handles the full surface).
  if (path === "name") job.name = String(value);
  else if (path === "runs-on") {
    if (typeof value === "string") job.runsOn = [value];
    else job.runsOn = value;
  } else if (path === "if") {
    job.if = String(value);
  }
}

function applyStepScalar(
  step: StepIR,
  path: string,
  value: string,
): StepIR {
  if (path === "name") return { ...step, name: value };
  if (path === "run") return { ...step, run: value };
  if (path === "if") return { ...step, if: value };
  if (path === "working-directory")
    return { ...step, workingDirectory: value };
  return step;
}

/**
 * Apply structural + content patches in queue order. Returns the
 * original IR reference when no patch applies (preserves React equality).
 */
export function applyPreviewPatches(
  ir: WorkflowIR,
  patches: readonly IRPatch[],
): WorkflowIR {
  if (patches.length === 0) return ir;
  if (!patches.some((p) => isStructural(p) || isContent(p))) return ir;
  return patches.reduce((acc, p) => applyOne(acc, p), ir);
}
