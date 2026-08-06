// WI-1.2 — parser orchestrator.
//
// Wraps @actions/workflow-parser, dispatches to per-IR-slice subparsers,
// and translates parser context errors + subparser diagnostics into our
// stable Diagnostic[] taxonomy (plan §4.4).

import { parseWorkflow } from "@actions/workflow-parser";
import type { Diagnostic, TopLevelPositions, WorkflowIR } from "../types";
import { deriveEdges } from "./edges";
import { parseJobs } from "./jobs";
import { parsePermissions } from "./permissions";
import { parseTriggers } from "./triggers";
import {
  asMapping,
  getBooleanOrExpression,
  getMapping,
  getRecord,
  getString,
  rangeOf,
} from "./tokens";
import { errorMessage } from "@/utils/errorMessage";

/** `TopLevelPositions` field → the YAML key it records, in document order. */
const TOP_LEVEL_POSITION_KEYS = [
  ["name", "name"],
  ["runName", "run-name"],
  ["on", "on"],
  ["permissions", "permissions"],
  ["env", "env"],
  ["defaults", "defaults"],
  ["concurrency", "concurrency"],
  ["jobs", "jobs"],
] as const satisfies ReadonlyArray<readonly [keyof TopLevelPositions, string]>;

/**
 * Parse a GitHub Actions workflow YAML string into a typed
 * WorkflowIR. Always returns an IR — even malformed input produces a
 * best-effort IR with diagnostics. The IR's `diagnostics` field
 * collects both parser-level errors and our own validation findings.
 */
export function parse(yaml: string, fileName = "workflow.yml"): WorkflowIR {
  const diagnostics: Diagnostic[] = [];

  // Catch any internal parser exception — workflow-parser is
  // generally robust but malformed YAML can throw on rare inputs.
  let result: ReturnType<typeof parseWorkflow>;
  try {
    result = parseWorkflow(
      { name: fileName, content: yaml },
      {
        error: (m: string) => {
          diagnostics.push(translateParserError(m));
        },
        info: () => {},
        verbose: () => {},
      },
    );
  } catch (e) {
    diagnostics.push({
      severity: "error",
      code: "GHA-PARSE-001",
      message: `Parser threw: ${errorMessage(e)}`,
    });
    return emptyIR(diagnostics);
  }

  // Forward parser context errors that didn't go through our trace shim.
  const ctxErrors = result.context?.errors?.getErrors?.() ?? [];
  for (const err of ctxErrors) {
    diagnostics.push(translateContextError(err));
  }

  const root = asMapping(result.value);
  if (!root) {
    diagnostics.push({
      severity: "error",
      code: "GHA-PARSE-001",
      message: "YAML parsed but produced no usable document.",
    });
    return emptyIR(diagnostics);
  }

  // Top-level pieces.
  const name = getString(root, "name");
  const runName = getString(root, "run-name");
  const env = getRecord(root, "env") ?? {};
  const triggersResult = parseTriggers(root.find("on"));
  const jobsResult = parseJobs(root.find("jobs"));
  diagnostics.push(...triggersResult.diagnostics, ...jobsResult.diagnostics);

  // Required-key validation (plan §4.4 GHA-PARSE-002 / 003).
  if (!root.find("jobs")) {
    diagnostics.push({
      severity: "error",
      code: "GHA-PARSE-002",
      message: "Top-level `jobs:` is missing.",
    });
  }
  if (!root.find("on")) {
    diagnostics.push({
      severity: "error",
      code: "GHA-PARSE-003",
      message: "Top-level `on:` is missing.",
    });
  }

  // Permissions and concurrency (workflow-level).
  const permissionsResult = parseWorkflowLevelPermissions(root);
  const concurrency = parseWorkflowLevelConcurrency(root);
  const defaults = parseWorkflowLevelDefaults(root);

  // Edges from job needs[].
  const edgesResult = deriveEdges(jobsResult.jobs);
  diagnostics.push(...edgesResult.diagnostics);

  // Top-level positions for click-to-jump. A key the workflow does not declare
  // gets no entry at all — `positions.env` being ABSENT is what "this file has
  // no top-level env:" means, and an empty `{}` is already a valid map. Writing
  // all eight keys unconditionally made `Object.keys(positions)` claim every
  // section existed.
  const positions: TopLevelPositions = {};
  for (const [field, yamlKey] of TOP_LEVEL_POSITION_KEYS) {
    const range = rangeOf(root.find(yamlKey));
    if (range) positions[field] = range;
  }

  return {
    ...(name !== undefined ? { name } : {}),
    ...(runName !== undefined ? { runName } : {}),
    triggers: triggersResult.triggers,
    permissions: permissionsResult,
    env,
    ...(defaults ? { defaults } : {}),
    ...(concurrency ? { concurrency } : {}),
    jobs: jobsResult.jobs,
    positions,
    diagnostics,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function emptyIR(diagnostics: Diagnostic[]): WorkflowIR {
  return {
    triggers: [],
    permissions: {},
    env: {},
    jobs: [],
    positions: {},
    diagnostics,
  };
}

/**
 * Translate a workflow-parser context-error message into our
 * diagnostic taxonomy. The parser's messages typically look like
 * `path/file.yml (Line: N, Col: M): <text>`.
 */
function translateParserError(message: string): Diagnostic {
  return {
    severity: "error",
    code: "GHA-PARSE-001",
    message,
  };
}

/**
 * A structural read-only view of the upstream parser's error objects. Every
 * field is explicitly `| undefined` because the library declares them that
 * way — this type describes what we may RECEIVE, not what we construct, so it
 * has to accept a key that is present and holding undefined.
 */
interface ParserContextError {
  message?: string | undefined;
  code?: string | undefined;
  range?:
    | { start: { line: number; column: number }; end: { line: number; column: number } }
    | undefined;
}

function translateContextError(err: ParserContextError): Diagnostic {
  const message = err.message ?? "Parser error";
  const isSchemaError = /unexpected value|unknown property|invalid/i.test(
    message,
  );
  const code = isSchemaError ? "GHA-SCHEMA-001" : "GHA-PARSE-001";
  return {
    severity: "error",
    code: code as Diagnostic["code"],
    message,
    ...(err.range
      ? {
          position: {
            startLine: err.range.start.line,
            startCol: err.range.start.column,
            endLine: err.range.end.line,
            endCol: err.range.end.column,
          },
        }
      : {}),
  };
}

function parseWorkflowLevelPermissions(
  root: ReturnType<typeof asMapping>,
): WorkflowIR["permissions"] {
  if (!root) return {};
  const tok = root.find("permissions");
  if (!tok) return {};
  const literal = (tok as { value?: unknown }).value;
  if (literal === "read-all" || literal === "write-all" || literal === "none") {
    return literal;
  }
  const inner = asMapping(tok);
  if (!inner) return {};
  const raw: Record<string, unknown> = {};
  for (let i = 0; i < inner.count; i++) {
    const pair = inner.get(i);
    const k = (pair.key as { value?: unknown }).value;
    const v = (pair.value as { value?: unknown }).value;
    if (typeof k === "string") raw[k] = v;
  }
  return parsePermissions(raw).value;
}

function parseWorkflowLevelConcurrency(
  root: NonNullable<ReturnType<typeof asMapping>>,
): WorkflowIR["concurrency"] | undefined {
  const tok = root.find("concurrency");
  if (!tok) return undefined;
  const literal = (tok as { value?: unknown }).value;
  if (typeof literal === "string") return { group: literal };
  const inner = asMapping(tok);
  if (!inner) return undefined;
  const group = getString(inner, "group");
  if (!group) return undefined;
  // ConcurrencyIR.cancelInProgress is `boolean | string` so workflows
  // can express the expression form (`${{ github.event_name == 'pr' }}`)
  // that GitHub Actions accepts. Reading via the Boolean-only helper
  // silently dropped that case (auditor finding).
  const cancelInProgress = getBooleanOrExpression(inner, "cancel-in-progress");
  return cancelInProgress !== undefined
    ? { group, cancelInProgress }
    : { group };
}

function parseWorkflowLevelDefaults(
  root: NonNullable<ReturnType<typeof asMapping>>,
): WorkflowIR["defaults"] | undefined {
  const defaults = getMapping(root, "defaults");
  if (!defaults) return undefined;
  const run = getMapping(defaults, "run");
  if (!run) return {};
  const out: WorkflowIR["defaults"] = { run: {} };
  const shell = getString(run, "shell");
  if (shell) out.run!.shell = shell;
  const wd = getString(run, "working-directory");
  if (wd) out.run!.workingDirectory = wd;
  return out;
}
