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
//
// Audit fix (cross-validator): the `extraPath` option defaults to the
// login-shell PATH from `get_login_shell_path` when callers omit it.
// macOS GUI apps inherit a minimal PATH (`/usr/bin:/bin`) that misses
// /opt/homebrew/bin, which is where Homebrew's actionlint lives.
// Without this default, actionlint silently reported "binary missing"
// for any user who installed it via Homebrew.

import { invoke } from "@tauri-apps/api/core";
import type { Diagnostic, DiagnosticCode } from "../types";

let cachedShellPath: string | null = null;

async function resolveExtraPath(): Promise<string | undefined> {
  if (cachedShellPath !== null) return cachedShellPath || undefined;
  try {
    const path = await invoke<string>("get_login_shell_path");
    cachedShellPath = path ?? "";
    return cachedShellPath || undefined;
  } catch {
    cachedShellPath = "";
    return undefined;
  }
}

/** Test-only: reset the in-process login-shell PATH cache. */
export function __resetActionlintPathCacheForTests(): void {
  cachedShellPath = null;
}

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
  // Default to the login-shell PATH so Homebrew installs (e.g.,
  // /opt/homebrew/bin/actionlint) are reachable from the Rust process,
  // which inherits the GUI app's minimal PATH on macOS.
  const extraPath =
    options.extraPath !== undefined
      ? options.extraPath
      : await resolveExtraPath();

  let result: RustLintResult;
  try {
    result = await invoke<RustLintResult>("gha_lint", {
      yaml,
      extraPath,
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
