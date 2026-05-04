// WI-5.3 — frontend wrapper around the Rust gha_lint Tauri command.
//
// Calls the optional actionlint binary via Rust. Three outcomes are
// possible (mirroring the Rust LintResult enum):
//
//   - binary_missing → return empty diagnostics + binaryAvailable: false.
//     The frontend hides the actionlint diagnostics layer silently.
//   - ok            → forward diagnostics under GHA-ACTIONLINT-<kind>.
//   - failed        → return empty diagnostics + error message; UI may
//     show a one-time toast but other linters keep working.

import { invoke } from "@tauri-apps/api/core";
import type { Diagnostic, DiagnosticCode } from "../types";

interface RustActionlintDiagnostic {
  message: string;
  kind: string;
  line: number;
  column: number;
  end_line?: number;
  end_column?: number;
  snippet?: string;
}

type RustLintResult =
  | { kind: "ok"; diagnostics: RustActionlintDiagnostic[] }
  | { kind: "binary_missing" }
  | { kind: "failed"; message: string };

export interface ActionlintOutcome {
  /** Whether the actionlint binary was found on PATH. */
  binaryAvailable: boolean;
  /** Forwarded diagnostics, possibly empty. */
  diagnostics: Diagnostic[];
  /** Set when invocation failed — UI may surface as a one-time toast. */
  error?: string;
}

export async function lintWithActionlint(
  yaml: string,
  options: { extraPath?: string } = {},
): Promise<ActionlintOutcome> {
  let result: RustLintResult;
  try {
    result = await invoke<RustLintResult>("gha_lint", {
      yaml,
      extraPath: options.extraPath,
    });
  } catch (e) {
    return {
      binaryAvailable: false,
      diagnostics: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (result.kind === "binary_missing") {
    return { binaryAvailable: false, diagnostics: [] };
  }
  if (result.kind === "failed") {
    return {
      binaryAvailable: true,
      diagnostics: [],
      error: result.message,
    };
  }

  return {
    binaryAvailable: true,
    diagnostics: result.diagnostics.map(translate),
  };
}

function translate(d: RustActionlintDiagnostic): Diagnostic {
  return {
    severity: "warning",
    code: `GHA-ACTIONLINT-${d.kind}` as DiagnosticCode,
    message: d.message,
    position: {
      startLine: d.line,
      startCol: d.column,
      endLine: d.end_line ?? d.line,
      endCol: d.end_column ?? d.column,
    },
  };
}
