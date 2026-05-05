// WI-1.1 — GitHub Actions Workflow IR types.
//
// Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §4
// Tested via: WI-1.2 / WI-1.3 (parser tests exercise every type).
//
// The IR is the canonical pivot between the YAML source and every renderer
// (interactive xyflow canvas, Mermaid export, SVG/PNG export, lint
// diagnostics, future structured editor). It is a typed, position-aware
// description of a GitHub Actions workflow, derived from the official
// `@actions/workflow-parser` AST plus our own normalization.

/**
 * Source position into the YAML string. Both line and column are 1-based,
 * matching `@actions/workflow-parser`'s convention. The range covers the
 * entire token (key + value for mapping pairs, the full sequence for arrays).
 */
export interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Result of parsing one workflow file or one code-fence block.
 * Errors do not prevent IR construction — the parser produces a
 * best-effort IR + a diagnostic list, so the renderer can still draw
 * something useful for partially-broken input.
 */
export interface WorkflowIR {
  name?: string;
  runName?: string;
  triggers: TriggerIR[];
  permissions: PermissionsValue;
  env: Record<string, string>;
  defaults?: WorkflowDefaults;
  concurrency?: ConcurrencyIR;
  jobs: JobIR[];
  /** Diagnostic-friendly: text positions for every top-level key. */
  positions: TopLevelPositions;
  /** Errors and warnings — see §4.4 of the plan for the code taxonomy. */
  diagnostics: Diagnostic[];
}

export type PermissionsValue =
  | "read-all"
  | "write-all"
  | "none"
  | PermissionsIR;

export interface TopLevelPositions {
  name?: SourceRange;
  runName?: SourceRange;
  on?: SourceRange;
  permissions?: SourceRange;
  env?: SourceRange;
  defaults?: SourceRange;
  concurrency?: SourceRange;
  jobs?: SourceRange;
}

export interface WorkflowDefaults {
  run?: {
    shell?: string;
    workingDirectory?: string;
  };
}

// ─── Triggers ─────────────────────────────────────────────────────────

/**
 * Canonical event names recognized by the parser. Free-form strings are
 * also allowed (custom `repository_dispatch` event types, future GitHub
 * additions) — see TriggerIR.event.
 */
export type TriggerEvent =
  | "push"
  | "pull_request"
  | "pull_request_target"
  | "workflow_dispatch"
  | "workflow_call"
  | "workflow_run"
  | "schedule"
  | "repository_dispatch"
  | "issues"
  | "issue_comment"
  | "release"
  | "discussion"
  | "fork"
  | "watch"
  | "create"
  | "delete"
  | "deployment"
  | "deployment_status"
  | "check_run"
  | "check_suite"
  | "label"
  | "milestone"
  | "page_build"
  | "gollum"
  | "member"
  | "public"
  | "merge_group"
  | "registry_package"
  | "status";

export interface TriggerIR {
  event: TriggerEvent | string;
  /** push / pull_request etc. branch filter. */
  branches?: string[];
  branchesIgnore?: string[];
  tags?: string[];
  tagsIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
  /** Activity types (issues.types: [opened, edited], etc.). */
  types?: string[];
  /** Cron schedules — one trigger per cron line. */
  cron?: string;
  /** workflow_dispatch / workflow_call inputs. */
  inputs?: Record<string, WorkflowInputIR>;
  /** workflow_call secrets. */
  secrets?: Record<string, WorkflowCallSecretIR>;
  /** workflow_call outputs. */
  outputs?: Record<string, WorkflowCallOutputIR>;
  /** workflow_run filters. */
  workflows?: string[];
  position: SourceRange;
}

export type WorkflowInputType =
  | "string"
  | "number"
  | "boolean"
  | "choice"
  | "environment";

export interface WorkflowInputIR {
  type?: WorkflowInputType;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
}

export interface WorkflowCallSecretIR {
  required?: boolean;
  description?: string;
}

export interface WorkflowCallOutputIR {
  value: string;
  description?: string;
}

// ─── Jobs ─────────────────────────────────────────────────────────────

export interface JobIR {
  /** Job key as written in YAML. */
  id: string;
  name?: string;
  /** "runs-on" normalized to string[] (single string becomes [s]). */
  runsOn?: string[];
  /** "uses" — this job is a reusable workflow call. Mutually exclusive with steps. */
  uses?: string;
  /** Inputs to a reusable-workflow call. */
  with?: Record<string, unknown>;
  /** Secrets passed to a reusable-workflow call. */
  secrets?: Record<string, string> | "inherit";
  needs: string[];
  if?: string;
  permissions?: PermissionsValue;
  environment?: JobEnvironmentIR;
  concurrency?: ConcurrencyIR;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  defaults?: WorkflowDefaults;
  steps: StepIR[];
  timeoutMinutes?: number;
  strategy?: StrategyIR;
  continueOnError?: boolean | string;
  container?: ContainerIR;
  services?: Record<string, ContainerIR>;
  position: SourceRange;
}

export interface JobEnvironmentIR {
  name: string;
  url?: string;
}

export interface StepIR {
  /** Synthesized id if the user didn't provide one (e.g., `step-3`). */
  id: string;
  /** True if id was synthesized by the parser, not present in YAML. */
  idSynthesized: boolean;
  name?: string;
  /** "uses" step kind. Mutually exclusive with run. */
  uses?: string;
  /** "run" step kind — shell command(s). */
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  workingDirectory?: string;
  shell?: string;
  continueOnError?: boolean | string;
  timeoutMinutes?: number;
  position: SourceRange;
}

export interface StrategyIR {
  matrix?: MatrixIR;
  failFast?: boolean;
  maxParallel?: number;
}

/**
 * Normalized matrix declaration. `dimensions` holds Cartesian-product axes;
 * `include` and `exclude` are the GitHub Actions extension/removal lists.
 */
export interface MatrixIR {
  dimensions: Record<string, MatrixValue[]>;
  include?: Record<string, MatrixValue>[];
  exclude?: Record<string, MatrixValue>[];
  /**
   * If the matrix value (or a dimension) is an expression like
   * `${{ fromJSON(...) }}`, mark it as dynamic — we cannot statically
   * expand it, so the renderer shows "dynamic" instead of "×N".
   */
  dynamic?: boolean;
}

/**
 * Matrix dimension values can be primitives or objects (combinations).
 * GitHub Actions syntax: `matrix.os: [ubuntu-latest, macos-latest]`,
 * `matrix.config: [{ name: foo, opt: 1 }]`.
 */
export type MatrixValue =
  | string
  | number
  | boolean
  | null
  | MatrixObject
  | MatrixValue[];

export interface MatrixObject {
  [key: string]: MatrixValue;
}

export interface ContainerIR {
  image: string;
  credentials?: ContainerCredentialsIR;
  env?: Record<string, string>;
  ports?: (string | number)[];
  volumes?: string[];
  options?: string;
}

export interface ContainerCredentialsIR {
  username?: string;
  password?: string;
}

// ─── Permissions ──────────────────────────────────────────────────────

export type PermLevel = "read" | "write" | "none";

/**
 * GITHUB_TOKEN scopes per the plan §6 / ADR-6 docs. The full set of scopes
 * tracked by GitHub Actions, normalized to camelCase to match TS conventions.
 * Source YAML uses kebab-case (`pull-requests`, `id-token`, etc.) which
 * the parser normalizes here.
 */
export interface PermissionsIR {
  actions?: PermLevel;
  attestations?: PermLevel;
  checks?: PermLevel;
  contents?: PermLevel;
  deployments?: PermLevel;
  discussions?: PermLevel;
  /** id-token in YAML → idToken here. write-only per GitHub. */
  idToken?: PermLevel;
  issues?: PermLevel;
  /** GitHub Models API gating; read-only per GitHub. */
  models?: PermLevel;
  packages?: PermLevel;
  pages?: PermLevel;
  /** pull-requests in YAML → pullRequests here. */
  pullRequests?: PermLevel;
  /** security-events in YAML → securityEvents here. */
  securityEvents?: PermLevel;
  statuses?: PermLevel;
}

// ─── Concurrency ──────────────────────────────────────────────────────

export interface ConcurrencyIR {
  group: string;
  /**
   * Either a literal boolean or an expression string (e.g., `${{ github.event_name == 'pull_request' }}`).
   */
  cancelInProgress?: boolean | string;
}

// ─── Diagnostics ──────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";

/**
 * Stable diagnostic codes per plan §4.4. Codes are append-only — never
 * reuse a retired code; assign a new number instead. UI strings are looked
 * up via i18n keys `workflowEditor.diagnostics.<code>`.
 */
export type DiagnosticCode =
  | "GHA-PARSE-001"
  | "GHA-PARSE-002"
  | "GHA-PARSE-003"
  | "GHA-PARSE-004"
  | "GHA-JOB-001"
  | "GHA-JOB-002"
  | "GHA-NEEDS-001"
  | "GHA-NEEDS-002"
  | "GHA-STEP-001"
  | "GHA-STEP-002"
  | "GHA-STEP-003"
  | "GHA-EXPR-001"
  | "GHA-EXPR-002"
  | "GHA-MATRIX-001"
  | "GHA-MATRIX-002"
  | "GHA-SEC-001"
  | "GHA-SEC-002"
  | "GHA-SCHEMA-001"
  /** Forwarded from external actionlint binary; the suffix is the actionlint rule. */
  | `GHA-ACTIONLINT-${string}`;

export interface Diagnostic {
  severity: Severity;
  /** Stable code — see DiagnosticCode. */
  code: DiagnosticCode;
  /** Plain-English message (English source; locales translate via the code key). */
  message: string;
  /** Source position; absent if the diagnostic is workflow-global. */
  position?: SourceRange;
  /**
   * Optional context for richer UI presentation. Examples: the offending
   * job id, the step that failed validation, the unknown context name.
   */
  context?: Record<string, string | number | boolean>;
}

// ─── Type guards ──────────────────────────────────────────────────────

export function isPermissionsObject(
  v: PermissionsValue,
): v is PermissionsIR {
  return typeof v === "object" && v !== null;
}

export function isPermissionsAlias(
  v: PermissionsValue,
): v is "read-all" | "write-all" | "none" {
  return v === "read-all" || v === "write-all" || v === "none";
}

/** A job is a reusable-workflow call (has `uses:`) rather than a step list. */
export function isReusableJob(
  job: JobIR,
): job is JobIR & { uses: string; steps: [] } {
  return typeof job.uses === "string" && job.steps.length === 0;
}

/** A step is a `uses:` step (action invocation). */
export function isUsesStep(
  step: StepIR,
): step is StepIR & { uses: string } {
  return typeof step.uses === "string";
}

/** A step is a `run:` step (shell command). */
export function isRunStep(step: StepIR): step is StepIR & { run: string } {
  return typeof step.run === "string";
}
