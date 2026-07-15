/**
 * Purpose: Types for the web-workflow IR (ADR-W1/W2).
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-4.1
 *
 * A workflow is authored as a markdown file (front-matter + typed steps) and parsed
 * into this IR. The step KIND selects the execution tier (R8); `api`/`action` are
 * deterministic tiers that self-heal by escalating to `goal` (reads only — never
 * writes, R8a). This module is pure data — no execution, no driver.
 */

/**
 * What a step *is*. `api` / `action` / `goal` select an execution tier (R8, least
 * to most autonomous); `confirm` (human gate) and `extract` (reader) are control /
 * data steps, not tiers — the engine's `vision` tier has no authorable kind.
 * The single source of truth: `StepKind` is derived from this tuple, so the
 * parser's runtime validation and the compile-time type can never drift.
 */
export const STEP_KINDS = ["api", "action", "goal", "confirm", "extract"] as const;

export type StepKind = (typeof STEP_KINDS)[number];

/** A parsed step. Immutable: the runner derives its write-safety classification from
 *  these fields, so a later mutation could invalidate a safety decision already made. */
export interface WorkflowStep {
  /** 1-based position among steps (not source line). */
  readonly index: number;
  readonly kind: StepKind;
  /** The instruction / goal / selector text: the author's words, CJK and casing
   *  preserved. Surrounding whitespace around `kind:` is not part of the text. */
  readonly text: string;
  /** 1-based source line, for diagnostics. */
  readonly line: number;
}

export interface WebWorkflow {
  /** Site id the workflow targets (front-matter `site:`). */
  readonly site: string;
  /** Declared input variable names (front-matter `inputs:`). */
  readonly inputs: readonly string[];
  /** Optional trigger descriptor (front-matter `trigger:`), e.g. "manual". */
  readonly trigger?: string;
  readonly steps: readonly WorkflowStep[];
}

export type DiagnosticSeverity = "error" | "warning";

/**
 * Stable, language-independent diagnostic codes. Messages here are developer-facing
 * English for logs/tests; a UI layer localizes by `code` (i18n rule — the parser is
 * pure and does not import `t()`).
 */
export type DiagnosticCode =
  | "missing-front-matter"
  | "unterminated-front-matter"
  | "malformed-front-matter"
  | "missing-site"
  | "duplicate-front-matter-key"
  | "unknown-front-matter-key"
  | "malformed-inputs"
  | "invalid-input-name"
  | "duplicate-input-name"
  | "malformed-step"
  | "unknown-step-kind"
  | "no-steps"
  | "undeclared-variable";

/** Severity is a type parameter so a warning list cannot hold an error (and vice
 *  versa) — the `ParseResult` union stays honest by construction. */
export interface Diagnostic<S extends DiagnosticSeverity = DiagnosticSeverity> {
  /** 1-based source line. */
  readonly line: number;
  /** Stable code for localization/testing. */
  readonly code: DiagnosticCode;
  /** Developer-facing English message (not for direct UI display — localize by `code`). */
  readonly message: string;
  readonly severity: S;
}

export type ErrorDiagnostic = Diagnostic<"error">;
export type WarningDiagnostic = Diagnostic<"warning">;

/** A failed parse still reports its warnings: one pass must show every diagnostic. */
export type ParseResult =
  | { ok: true; workflow: WebWorkflow; warnings: WarningDiagnostic[] }
  | { ok: false; errors: ErrorDiagnostic[]; warnings: WarningDiagnostic[] };
