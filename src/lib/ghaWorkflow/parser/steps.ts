// WI-1.3 — step parsing extracted from jobs.ts to keep both ≤300 LOC.

import type { TemplateToken } from "@actions/workflow-parser/templates/tokens/template-token";
import type { Diagnostic, StepIR } from "../types";
import {
  asMapping,
  asSequence,
  getBoolean,
  getNumber,
  getRecord,
  getString,
  rangeOrZero,
} from "./tokens";

export interface ParseStepsResult {
  steps: StepIR[];
  diagnostics: Diagnostic[];
}

/**
 * Parse a `steps:` sequence into StepIR[].
 *
 * Diagnostics:
 *   - GHA-STEP-001 (warning) — step has neither uses nor run
 *   - GHA-STEP-002 (error) — step has both uses and run
 *   - GHA-STEP-003 (warning) — step id was synthesized; consider adding
 *     an explicit `id:` for clarity
 */
export function parseSteps(stepsToken: TemplateToken | undefined): ParseStepsResult {
  const out: StepIR[] = [];
  const diagnostics: Diagnostic[] = [];

  const seq = asSequence(stepsToken);
  if (!seq) return { steps: out, diagnostics };

  for (let i = 0; i < seq.count; i++) {
    const stepTok = seq.get(i);
    const stepMap = asMapping(stepTok);
    if (!stepMap) continue;

    const explicitId = getString(stepMap, "id");
    const id = explicitId ?? `step-${i}`;
    const idSynthesized = !explicitId;

    const uses = getString(stepMap, "uses");
    const run = getString(stepMap, "run");
    const name = getString(stepMap, "name");
    const ifExpr = getString(stepMap, "if");
    const workingDirectory = getString(stepMap, "working-directory");
    const shell = getString(stepMap, "shell");
    const continueOnError = getBoolean(stepMap, "continue-on-error");
    const timeoutMinutes = getNumber(stepMap, "timeout-minutes");
    const withRecord = getRecord(stepMap, "with");
    const envRecord = getRecord(stepMap, "env");

    const step: StepIR = {
      id,
      idSynthesized,
      position: rangeOrZero(stepTok),
    };
    if (name !== undefined) step.name = name;
    if (uses !== undefined) step.uses = uses;
    if (run !== undefined) step.run = run;
    if (withRecord) step.with = withRecord;
    if (envRecord) step.env = envRecord;
    if (ifExpr !== undefined) step.if = ifExpr;
    if (workingDirectory !== undefined) step.workingDirectory = workingDirectory;
    if (shell !== undefined) step.shell = shell;
    if (continueOnError !== undefined) step.continueOnError = continueOnError;
    if (timeoutMinutes !== undefined) step.timeoutMinutes = timeoutMinutes;

    if (uses && run) {
      diagnostics.push({
        severity: "error",
        code: "GHA-STEP-002",
        message: "Step has both uses: and run: (mutually exclusive).",
        position: rangeOrZero(stepTok),
        context: { stepIndex: i },
      });
    } else if (!uses && !run) {
      diagnostics.push({
        severity: "warning",
        code: "GHA-STEP-001",
        message: "Step has neither uses: nor run:.",
        position: rangeOrZero(stepTok),
        context: { stepIndex: i },
      });
    }

    if (idSynthesized) {
      diagnostics.push({
        severity: "warning",
        code: "GHA-STEP-003",
        message: `Step ${i} has no explicit id; synthesized "${id}". Add an id: for clarity.`,
        position: rangeOrZero(stepTok),
        context: { synthesizedId: id },
      });
    }

    out.push(step);
  }

  return { steps: out, diagnostics };
}
