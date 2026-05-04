// WI-5.1 — workflow lint via @actions/languageservice.
//
// Wraps validate() and translates the LSP Diagnostic[] into our
// internal Diagnostic[] per plan §4.4 codes.
//
// Reality vs plan: the plan assumed validate() would catch unknown
// top-level keys, typo'd expression contexts, and unknown job fields
// out of the box. Verified empirically that it does NOT — those require
// a configured ContextProviderConfig + ValueProviderConfig +
// ActionsMetadataProvider. Without provider config, validate() forwards
// the workflow-parser's own context errors only (e.g., "Unexpected
// value 'run'" when a step has both uses + run).
//
// This wrapper is therefore a thin shim over the parser's lint,
// reusing the LSP diagnostic shape so future provider-config work
// drops in without changing the wrapper. Richer expression/schema
// linting is a Phase 9 polish item; actionlint (WI-5.4) covers the
// gap when available.
//
// Plan ADR-7. Async because the underlying API is async.

import { validate } from "@actions/languageservice";
import {
  type Diagnostic as LspDiagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver-types";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic, DiagnosticCode, Severity } from "../types";

/**
 * Lint a workflow YAML string. Returns our normalized Diagnostic[].
 * Side-effect free; safe to call from a debounced effect on every
 * keystroke. Rejects malformed input gracefully — never throws.
 */
export async function lintWorkflow(yaml: string): Promise<Diagnostic[]> {
  const doc = TextDocument.create("file:///workflow.yml", "yaml", 1, yaml);
  let lspDiags: LspDiagnostic[];
  try {
    lspDiags = await validate(doc);
  } catch (e) {
    // Defensive: if languageservice itself blows up on truly malformed
    // input, surface a single GHA-PARSE-001 rather than crash.
    return [
      {
        severity: "error",
        code: "GHA-PARSE-001",
        message: `Lint failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    ];
  }
  return lspDiags.map(translate);
}

// ─── Translation ────────────────────────────────────────────────────
// Exported for unit testing of the heuristic mapping.

export function translate(d: LspDiagnostic): Diagnostic {
  return {
    severity: lspSeverityToOurs(d.severity),
    code: classifyCode(d),
    message: d.message,
    position: {
      startLine: d.range.start.line + 1, // LSP is 0-based; we use 1-based
      startCol: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endCol: d.range.end.character + 1,
    },
  };
}

function lspSeverityToOurs(s: number | undefined): Severity {
  switch (s) {
    case DiagnosticSeverity.Error:
      return "error";
    case DiagnosticSeverity.Warning:
      return "warning";
    case DiagnosticSeverity.Information:
    case DiagnosticSeverity.Hint:
    default:
      return "info";
  }
}

/**
 * Heuristic mapping from LSP message to our stable code taxonomy.
 *
 * Order matters — more specific patterns first.
 *
 * Rationale: languageservice doesn't expose a stable error-code field
 * (it relies on free-form messages). We match on substrings to keep
 * the translation predictable. Update this when languageservice ships
 * structured codes.
 */
function classifyCode(d: LspDiagnostic): DiagnosticCode {
  const m = (d.message ?? "").toLowerCase();
  // Expression-context errors.
  if (/(unknown|invalid)\s+(context|object property)/.test(m)) {
    return "GHA-EXPR-001";
  }
  if (/context.*not (?:available|in scope)/.test(m)) {
    return "GHA-EXPR-002";
  }
  // Schema-shape errors.
  if (
    /unexpected\s+(value|key|property)/.test(m) ||
    /unknown\s+(key|property|workflow trigger|trigger)/.test(m) ||
    /required\s+property/.test(m) ||
    /invalid type/.test(m) ||
    /must be/.test(m)
  ) {
    return "GHA-SCHEMA-001";
  }
  // Default: parse error.
  return "GHA-PARSE-001";
}
