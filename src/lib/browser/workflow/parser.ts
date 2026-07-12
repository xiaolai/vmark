/**
 * Purpose: Parse a web-workflow markdown file into the typed `WebWorkflow` IR,
 * with precise line-numbered diagnostics (ADR-W1, WI-4.1).
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md
 *
 * File shape:
 *   ---
 *   site: <id>            (required)
 *   inputs: [a, b]        (optional; defaults to [])
 *   trigger: <text>       (optional)
 *   ---
 *   1. goal: <text>       (leading `N.` / `-` list markers are optional sugar)
 *   extract: <text>
 *
 * Front-matter is a deliberately tiny hand-parsed subset (site + inputs + trigger) —
 * not full YAML — to keep this a dependency-free leaf. Malformed input yields errors
 * (ok:false); an unknown front-matter key or undeclared `{var}` yields a warning.
 * Diagnostics carry a stable `code` so a UI layer can localize them (the parser is
 * pure and must not import `t()`).
 */
import {
  STEP_KINDS,
  type Diagnostic,
  type DiagnosticCode,
  type ParseResult,
  type StepKind,
  type WorkflowStep,
} from "./types";

const KIND_SET = new Set<string>(STEP_KINDS);
const KNOWN_FM_KEYS = new Set(["site", "inputs", "trigger"]);
const STEP_RE = /^\s*(?:\d+\.|-)?\s*([a-z]+)\s*:\s*(.*\S)\s*$/;
const VAR_NAME_RE = /^[a-zA-Z_][\w-]*$/;
const VAR_REF_RE = /\{([a-zA-Z_][\w-]*)\}/g;

function diag(line: number, code: DiagnosticCode, message: string, severity: Diagnostic["severity"]): Diagnostic {
  return { line, code, message, severity };
}

/** Parse workflow source text. Never throws — all failure surfaces as diagnostics. */
export function parseWorkflow(source: string): ParseResult {
  const lines = source.split("\n");
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  const fm = extractFrontMatter(lines);
  if (!fm.ok) return { ok: false, errors: [fm.error] };
  errors.push(...fm.errors);
  warnings.push(...fm.warnings);

  const site = fm.fields.get("site");
  if (site === undefined || site === "") {
    errors.push(diag(fm.headerLine, "missing-site", "Front-matter is missing required `site`.", "error"));
  }

  const inputsResult = parseInputs(fm.fields.get("inputs"), fm.fieldLines.get("inputs") ?? fm.headerLine);
  errors.push(...inputsResult.errors);

  const trigger = fm.fields.get("trigger");

  const { steps, stepErrors } = parseSteps(lines, fm.bodyStart);
  errors.push(...stepErrors);
  if (steps.length === 0) {
    errors.push(diag(fm.bodyStart + 1, "no-steps", "Workflow has no steps.", "error"));
  }

  if (errors.length > 0) return { ok: false, errors };

  warnings.push(...collectVariableWarnings(steps, inputsResult.inputs));
  const workflow = { site: site!, inputs: inputsResult.inputs, steps, ...(trigger ? { trigger } : {}) };
  return { ok: true, workflow, warnings };
}

type FrontMatter =
  | {
      ok: true;
      fields: Map<string, string>;
      /** 1-based source line of each field, for precise diagnostics. */
      fieldLines: Map<string, number>;
      errors: Diagnostic[];
      warnings: Diagnostic[];
      headerLine: number;
      bodyStart: number;
    }
  | { ok: false; error: Diagnostic };

// Keys may contain letters, digits, `-` and `_` so hyphenated keys (`some-key`) are
// recognized and warned as unknown rather than silently skipped.
const FM_KEY_RE = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/;

/** Read the leading `---` … `---` block into a flat key→value map, diagnosing keys. */
function extractFrontMatter(lines: string[]): FrontMatter {
  if (lines[0]?.trim() !== "---") {
    return {
      ok: false,
      error: diag(1, "missing-front-matter", "Workflow must start with a `---` front-matter block.", "error"),
    };
  }
  const fields = new Map<string, string>();
  const fieldLines = new Map<string, number>();
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return { ok: true, fields, fieldLines, errors, warnings, headerLine: 1, bodyStart: i + 1 };
    }
    const m = FM_KEY_RE.exec(lines[i]);
    if (!m) continue; // blank/comment lines inside front-matter are tolerated
    const [, key, value] = m;
    const line = i + 1;
    if (fields.has(key)) {
      errors.push(diag(line, "duplicate-front-matter-key", `Duplicate front-matter key "${key}".`, "error"));
      continue;
    }
    if (!KNOWN_FM_KEYS.has(key)) {
      warnings.push(diag(line, "unknown-front-matter-key", `Unknown front-matter key "${key}".`, "warning"));
    }
    fields.set(key, value.trim());
    fieldLines.set(key, line);
  }
  return {
    ok: false,
    error: diag(1, "unterminated-front-matter", "Unterminated front-matter (missing closing `---`).", "error"),
  };
}

/**
 * Parse `inputs: [a, b]` into a validated name list. The bracket form must be
 * balanced (both or neither), names must match `VAR_NAME_RE`, and duplicates are
 * rejected. Absent/empty → `[]`.
 */
function parseInputs(raw: string | undefined, line: number): { inputs: string[]; errors: Diagnostic[] } {
  const errors: Diagnostic[] = [];
  if (raw === undefined || raw === "") return { inputs: [], errors };

  const open = raw.startsWith("[");
  const close = raw.endsWith("]");
  if (open !== close) {
    errors.push(diag(line, "malformed-inputs", `Malformed inputs list "${raw}" (unbalanced brackets).`, "error"));
    return { inputs: [], errors };
  }

  const body = open ? raw.slice(1, -1) : raw;
  const trimmedBody = body.trim();
  if (trimmedBody === "") return { inputs: [], errors }; // `[]` or empty → no inputs

  const entries = trimmedBody.split(",").map((s) => s.trim());
  const seen = new Set<string>();
  for (const name of entries) {
    if (name === "") {
      // An empty entry (`[a,,b]`, trailing comma) is malformed, not silently dropped.
      errors.push(diag(line, "malformed-inputs", `Malformed inputs list "${raw}" (empty entry).`, "error"));
    } else if (!VAR_NAME_RE.test(name)) {
      errors.push(diag(line, "invalid-input-name", `Invalid input variable name "${name}".`, "error"));
    } else if (seen.has(name)) {
      errors.push(diag(line, "duplicate-input-name", `Duplicate input variable "${name}".`, "error"));
    } else {
      seen.add(name);
    }
  }
  return { inputs: [...seen], errors };
}

function parseSteps(lines: string[], bodyStart: number): { steps: WorkflowStep[]; stepErrors: Diagnostic[] } {
  const steps: WorkflowStep[] = [];
  const stepErrors: Diagnostic[] = [];

  for (let i = bodyStart; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue; // blank / comment

    const line = i + 1;
    const m = STEP_RE.exec(raw);
    if (!m) {
      stepErrors.push(diag(line, "malformed-step", `Step must be "<kind>: <text>" (got: ${trimmed}).`, "error"));
      continue;
    }
    const [, kind, text] = m;
    if (!KIND_SET.has(kind)) {
      stepErrors.push(
        diag(line, "unknown-step-kind", `Unknown step kind "${kind}" (expected ${STEP_KINDS.join(", ")}).`, "error"),
      );
      continue;
    }
    steps.push({ index: steps.length + 1, kind: kind as StepKind, text, line });
  }

  return { steps, stepErrors };
}

/** Warn when a step references `{var}` not declared in `inputs`. */
function collectVariableWarnings(steps: readonly WorkflowStep[], inputs: readonly string[]): Diagnostic[] {
  const declared = new Set(inputs);
  const warnings: Diagnostic[] = [];
  for (const step of steps) {
    for (const match of step.text.matchAll(VAR_REF_RE)) {
      const name = match[1];
      if (!declared.has(name)) {
        warnings.push(diag(step.line, "undeclared-variable", `Step references undeclared variable "{${name}}".`, "warning"));
      }
    }
  }
  return warnings;
}
