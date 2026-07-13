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
 * not full YAML — to keep this a dependency-free leaf. Inside the block only blank
 * lines and `#` comments are tolerated; every other non-`key: value` line is an error,
 * because silently skipping a typo (`inputs [title]`) would change what the workflow
 * executes with no diagnostic at all. A leading UTF-8 BOM is accepted.
 *
 * Malformed input yields errors (ok:false); an unknown front-matter key or undeclared
 * `{var}` yields a warning. Warnings are reported on BOTH outcomes, so one pass shows
 * every diagnostic. Diagnostics carry a stable `code` so a UI layer can localize them
 * (the parser is pure and must not import `t()`).
 */
import {
  STEP_KINDS,
  type DiagnosticCode,
  type ErrorDiagnostic,
  type ParseResult,
  type StepKind,
  type WarningDiagnostic,
  type WorkflowStep,
} from "./types";

const KIND_SET = new Set<string>(STEP_KINDS);
const KNOWN_FM_KEYS = new Set(["site", "inputs", "trigger"]);
const STEP_RE = /^\s*(?:\d+\.|-)?\s*([a-z]+)\s*:\s*(.*\S)\s*$/;
const VAR_NAME_RE = /^[a-zA-Z_][\w-]*$/;
const VAR_REF_RE = /\{([a-zA-Z_][\w-]*)\}/g;
/** UTF-8 BOM — a valid file may start with one (Windows editors add it). */
const BOM = "﻿";

function err(line: number, code: DiagnosticCode, message: string): ErrorDiagnostic {
  return { line, code, message, severity: "error" };
}

function warn(line: number, code: DiagnosticCode, message: string): WarningDiagnostic {
  return { line, code, message, severity: "warning" };
}

/** Parse workflow source text. Never throws — all failure surfaces as diagnostics. */
export function parseWorkflow(source: string): ParseResult {
  const lines = (source.startsWith(BOM) ? source.slice(BOM.length) : source).split("\n");
  const errors: ErrorDiagnostic[] = [];
  const warnings: WarningDiagnostic[] = [];

  const fm = extractFrontMatter(lines);
  warnings.push(...fm.warnings);
  if (!fm.ok) return { ok: false, errors: [fm.error], warnings };
  errors.push(...fm.errors);

  const site = fm.fields.get("site");
  if (site === undefined || site === "") {
    errors.push(err(fm.headerLine, "missing-site", "Front-matter is missing required `site`."));
  }

  const inputsResult = parseInputs(fm.fields.get("inputs"), fm.fieldLines.get("inputs") ?? fm.headerLine);
  errors.push(...inputsResult.errors);

  const trigger = fm.fields.get("trigger");

  const { steps, stepErrors } = parseSteps(lines, fm.bodyStart);
  errors.push(...stepErrors);
  if (steps.length === 0) {
    errors.push(err(fm.bodyStart + 1, "no-steps", "Workflow has no steps."));
  }

  warnings.push(...collectVariableWarnings(steps, inputsResult.inputs));
  if (errors.length > 0) return { ok: false, errors, warnings };

  const workflow = { site: site!, inputs: inputsResult.inputs, steps, ...(trigger ? { trigger } : {}) };
  return { ok: true, workflow, warnings };
}

/** Is `name` a variable name the parser accepts (front-matter `inputs`, `{var}` refs)? */
export function isValidInputName(name: string): boolean {
  return VAR_NAME_RE.test(name);
}

type FrontMatter =
  | {
      ok: true;
      fields: Map<string, string>;
      /** 1-based source line of each field, for precise diagnostics. */
      fieldLines: Map<string, number>;
      errors: ErrorDiagnostic[];
      warnings: WarningDiagnostic[];
      headerLine: number;
      bodyStart: number;
    }
  | { ok: false; error: ErrorDiagnostic; warnings: WarningDiagnostic[] };

// Keys may contain letters, digits, `-` and `_` so hyphenated keys (`some-key`) are
// recognized and warned as unknown rather than silently skipped.
const FM_KEY_RE = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/;

/** Read the leading `---` … `---` block into a flat key→value map, diagnosing keys. */
function extractFrontMatter(lines: string[]): FrontMatter {
  if (lines[0]?.trim() !== "---") {
    return {
      ok: false,
      error: err(1, "missing-front-matter", "Workflow must start with a `---` front-matter block."),
      warnings: [],
    };
  }
  const fields = new Map<string, string>();
  const fieldLines = new Map<string, number>();
  const errors: ErrorDiagnostic[] = [];
  const warnings: WarningDiagnostic[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "---") {
      return { ok: true, fields, fieldLines, errors, warnings, headerLine: 1, bodyStart: i + 1 };
    }
    const line = i + 1;
    if (trimmed === "" || trimmed.startsWith("#")) continue; // blank / comment — the ONLY tolerated non-field lines

    const m = FM_KEY_RE.exec(raw);
    if (!m) {
      // Anything else is a typo, not a field. Skipping it silently (the old behavior)
      // turned `inputs [title]` into a workflow with NO inputs — same file, different
      // execution, no diagnostic. Fail loud instead.
      errors.push(err(line, "malformed-front-matter", `Front-matter line must be "key: value" (got: ${trimmed}).`));
      continue;
    }
    const [, key, value] = m;
    if (fields.has(key)) {
      errors.push(err(line, "duplicate-front-matter-key", `Duplicate front-matter key "${key}".`));
      continue;
    }
    if (!KNOWN_FM_KEYS.has(key)) {
      warnings.push(warn(line, "unknown-front-matter-key", `Unknown front-matter key "${key}".`));
    }
    fields.set(key, value.trim());
    fieldLines.set(key, line);
  }
  return {
    ok: false,
    error: err(1, "unterminated-front-matter", "Unterminated front-matter (missing closing `---`)."),
    warnings,
  };
}

/**
 * Parse `inputs: [a, b]` into a validated name list. The bracket form must be
 * balanced (both or neither), names must match `VAR_NAME_RE`, and duplicates are
 * rejected. Absent/empty → `[]`.
 */
function parseInputs(raw: string | undefined, line: number): { inputs: string[]; errors: ErrorDiagnostic[] } {
  const errors: ErrorDiagnostic[] = [];
  if (raw === undefined || raw === "") return { inputs: [], errors };

  const open = raw.startsWith("[");
  const close = raw.endsWith("]");
  if (open !== close) {
    errors.push(err(line, "malformed-inputs", `Malformed inputs list "${raw}" (unbalanced brackets).`));
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
      errors.push(err(line, "malformed-inputs", `Malformed inputs list "${raw}" (empty entry).`));
    } else if (!isValidInputName(name)) {
      errors.push(err(line, "invalid-input-name", `Invalid input variable name "${name}".`));
    } else if (seen.has(name)) {
      errors.push(err(line, "duplicate-input-name", `Duplicate input variable "${name}".`));
    } else {
      seen.add(name);
    }
  }
  return { inputs: [...seen], errors };
}

function parseSteps(lines: string[], bodyStart: number): { steps: WorkflowStep[]; stepErrors: ErrorDiagnostic[] } {
  const steps: WorkflowStep[] = [];
  const stepErrors: ErrorDiagnostic[] = [];

  for (let i = bodyStart; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue; // blank / comment

    const line = i + 1;
    const m = STEP_RE.exec(raw);
    if (!m) {
      stepErrors.push(err(line, "malformed-step", `Step must be "<kind>: <text>" (got: ${trimmed}).`));
      continue;
    }
    const [, kind, text] = m;
    if (!KIND_SET.has(kind)) {
      stepErrors.push(
        err(line, "unknown-step-kind", `Unknown step kind "${kind}" (expected ${STEP_KINDS.join(", ")}).`),
      );
      continue;
    }
    steps.push({ index: steps.length + 1, kind: kind as StepKind, text, line });
  }

  return { steps, stepErrors };
}

/** Warn when a step references `{var}` not declared in `inputs`. */
function collectVariableWarnings(steps: readonly WorkflowStep[], inputs: readonly string[]): WarningDiagnostic[] {
  const declared = new Set(inputs);
  const warnings: WarningDiagnostic[] = [];
  for (const step of steps) {
    for (const match of step.text.matchAll(VAR_REF_RE)) {
      const name = match[1];
      if (!declared.has(name)) {
        warnings.push(warn(step.line, "undeclared-variable", `Step references undeclared variable "{${name}}".`));
      }
    }
  }
  return warnings;
}
