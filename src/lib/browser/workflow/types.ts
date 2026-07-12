/**
 * Purpose: Types for the web-workflow IR (ADR-W1/W2).
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-4.1
 *
 * A workflow is authored as a markdown file (front-matter + typed steps) and parsed
 * into this IR. The step KIND selects the execution tier (R8); `api`/`action` are
 * deterministic tiers that self-heal by escalating to `goal` (reads only — never
 * writes, R8a). This module is pure data — no execution, no driver.
 */

/** Execution tiers, chosen per step by the engine (R8). */
export type StepKind = "api" | "action" | "goal" | "confirm" | "extract";

export const STEP_KINDS: readonly StepKind[] = ["api", "action", "goal", "confirm", "extract"];

export interface WorkflowStep {
  /** 1-based position among steps (not source line). */
  index: number;
  kind: StepKind;
  /** The instruction / goal / selector text, verbatim (CJK preserved). */
  text: string;
  /** 1-based source line, for diagnostics. */
  line: number;
}

export interface WebWorkflow {
  /** Site id the workflow targets (front-matter `site:`). */
  site: string;
  /** Declared input variable names (front-matter `inputs:`). */
  inputs: string[];
  /** Optional trigger descriptor (front-matter `trigger:`), e.g. "manual". */
  trigger?: string;
  steps: WorkflowStep[];
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

export interface Diagnostic {
  /** 1-based source line. */
  line: number;
  /** Stable code for localization/testing. */
  code: DiagnosticCode;
  /** Developer-facing English message (not for direct UI display — localize by `code`). */
  message: string;
  severity: DiagnosticSeverity;
}

export type ParseResult =
  | { ok: true; workflow: WebWorkflow; warnings: Diagnostic[] }
  | { ok: false; errors: Diagnostic[] };
