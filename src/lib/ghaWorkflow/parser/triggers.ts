// WI-1.3 — trigger normalization.
//
// Accepts the three GitHub Actions trigger shapes:
//   on: push                          (single string)
//   on: [push, pull_request]          (array of strings)
//   on: { push: { ... }, ... }        (mapping of event → filters)
//
// Each event becomes one TriggerIR; `schedule` is special-cased to one
// TriggerIR per cron entry per plan §4.

import type { TemplateToken } from "@actions/workflow-parser/templates/tokens/template-token";
import type {
  Diagnostic,
  TriggerIR,
  WorkflowInputIR,
  WorkflowInputType,
} from "../types";
import {
  asMapping,
  asSequence,
  getBoolean,
  getMapping,
  getString,
  getStringArray,
  getStringOrExpression,
  mappingEntries,
  rangeOf,
  rangeOrZero,
} from "./tokens";

export interface ParseTriggersResult {
  triggers: TriggerIR[];
  diagnostics: Diagnostic[];
}

const VALID_INPUT_TYPES: ReadonlySet<WorkflowInputType> = new Set([
  "string",
  "number",
  "boolean",
  "choice",
  "environment",
]);

export function parseTriggers(
  onToken: TemplateToken | undefined,
): ParseTriggersResult {
  const out: TriggerIR[] = [];
  const diagnostics: Diagnostic[] = [];

  if (!onToken) return { triggers: out, diagnostics };

  // Form 1: single string.
  const single = readScalarString(onToken);
  if (single !== undefined) {
    out.push({
      event: single,
      position: rangeOrZero(onToken),
    });
    advisory(out[out.length - 1], diagnostics, onToken);
    return { triggers: out, diagnostics };
  }

  // Form 2: sequence of strings.
  const seq = asSequence(onToken);
  if (seq) {
    for (let i = 0; i < seq.count; i++) {
      const item = seq.get(i);
      const name = readScalarString(item);
      if (name) {
        const trig: TriggerIR = {
          event: name,
          position: rangeOrZero(item),
        };
        out.push(trig);
        advisory(trig, diagnostics, item);
      }
    }
    return { triggers: out, diagnostics };
  }

  // Form 3: mapping.
  const map = asMapping(onToken);
  if (!map) return { triggers: out, diagnostics };

  for (const [event, body] of mappingEntries(map)) {
    if (event === "schedule") {
      const items = asSequence(body);
      if (!items) continue;
      for (let i = 0; i < items.count; i++) {
        const cronMap = asMapping(items.get(i));
        const cron = cronMap ? getString(cronMap, "cron") : undefined;
        if (cron) {
          out.push({
            event: "schedule",
            cron,
            position: rangeOrZero(items.get(i)),
          });
        }
      }
      continue;
    }

    const trig: TriggerIR = {
      event,
      position: rangeOrZero(body),
    };

    const filterMap = asMapping(body);
    if (filterMap) {
      const branches = getStringArray(filterMap, "branches");
      const branchesIgnore = getStringArray(filterMap, "branches-ignore");
      const tags = getStringArray(filterMap, "tags");
      const tagsIgnore = getStringArray(filterMap, "tags-ignore");
      const paths = getStringArray(filterMap, "paths");
      const pathsIgnore = getStringArray(filterMap, "paths-ignore");
      const types = getStringArray(filterMap, "types");
      const workflows = getStringArray(filterMap, "workflows");

      if (branches) trig.branches = branches;
      if (branchesIgnore) trig.branchesIgnore = branchesIgnore;
      if (tags) trig.tags = tags;
      if (tagsIgnore) trig.tagsIgnore = tagsIgnore;
      if (paths) trig.paths = paths;
      if (pathsIgnore) trig.pathsIgnore = pathsIgnore;
      if (types) trig.types = types;
      if (workflows) trig.workflows = workflows;

      const inputs = parseInputs(filterMap);
      if (inputs) trig.inputs = inputs;

      const secrets = parseCallSecrets(filterMap);
      if (secrets) trig.secrets = secrets;

      const outputs = parseCallOutputs(filterMap);
      if (outputs) trig.outputs = outputs;
    }

    out.push(trig);
    advisory(trig, diagnostics, body);
  }

  return { triggers: out, diagnostics };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function readScalarString(t: TemplateToken | undefined): string | undefined {
  if (!t) return undefined;
  const s = t as TemplateToken & { value?: unknown };
  return typeof s.value === "string" ? s.value : undefined;
}

function advisory(
  trig: TriggerIR,
  diagnostics: Diagnostic[],
  source: TemplateToken,
): void {
  if (trig.event === "pull_request_target") {
    diagnostics.push({
      severity: "warning",
      code: "GHA-SEC-001",
      message:
        "pull_request_target runs in the base repo's context with secrets — never check out PR head code without persist-credentials: false.",
      position: rangeOf(source),
    });
  }
}

function parseInputs(
  map: import("@actions/workflow-parser/templates/tokens/mapping-token").MappingToken,
): Record<string, WorkflowInputIR> | undefined {
  const inputs = getMapping(map, "inputs");
  if (!inputs) return undefined;

  const out: Record<string, WorkflowInputIR> = {};
  for (const [name, body] of mappingEntries(inputs)) {
    const inner = asMapping(body);
    if (!inner) continue;

    const ir: WorkflowInputIR = {};
    const t = getString(inner, "type");
    if (t && VALID_INPUT_TYPES.has(t as WorkflowInputType)) {
      ir.type = t as WorkflowInputType;
    }
    const desc = getString(inner, "description");
    if (desc) ir.description = desc;
    const req = getBoolean(inner, "required");
    if (req !== undefined) ir.required = req;

    const def = inner.find("default") as TemplateToken | undefined;
    const defVal = readScalarString(def);
    if (defVal !== undefined) ir.default = defVal;
    else {
      const defNum = (def as TemplateToken & { value?: unknown })?.value;
      if (typeof defNum === "number" || typeof defNum === "boolean") {
        ir.default = defNum;
      }
    }

    const opts = getStringArray(inner, "options");
    if (opts) ir.options = opts;

    out[name] = ir;
  }
  return out;
}

function parseCallSecrets(
  map: import("@actions/workflow-parser/templates/tokens/mapping-token").MappingToken,
): TriggerIR["secrets"] | undefined {
  const secrets = getMapping(map, "secrets");
  if (!secrets) return undefined;
  const out: NonNullable<TriggerIR["secrets"]> = {};
  for (const [name, body] of mappingEntries(secrets)) {
    const inner = asMapping(body);
    if (!inner) continue;
    const required = getBoolean(inner, "required");
    const description = getString(inner, "description");
    out[name] = {
      ...(required !== undefined ? { required } : {}),
      ...(description ? { description } : {}),
    };
  }
  return out;
}

function parseCallOutputs(
  map: import("@actions/workflow-parser/templates/tokens/mapping-token").MappingToken,
): TriggerIR["outputs"] | undefined {
  const outputs = getMapping(map, "outputs");
  if (!outputs) return undefined;
  const out: NonNullable<TriggerIR["outputs"]> = {};
  for (const [name, body] of mappingEntries(outputs)) {
    const inner = asMapping(body);
    if (!inner) continue;
    // outputs.<name>.value is typically an expression like
    // ${{ jobs.X.outputs.Y }}; accept both literal strings and expressions.
    const value = getStringOrExpression(inner, "value");
    if (typeof value !== "string") continue;
    const description = getString(inner, "description");
    out[name] = description ? { value, description } : { value };
  }
  return out;
}
