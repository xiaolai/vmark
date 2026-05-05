/**
 * Purpose: Pure-logic core of GHA expression-context autocomplete. Given
 *   a workflow IR, a source string, and a cursor offset, returns the
 *   list of candidate identifiers to surface inside `${{ }}`. The
 *   CodeMirror integration in `src/plugins/codemirror/sourceWorkflowCompletion.ts`
 *   wraps this with view-state plumbing.
 *
 *   Why a hand-rolled completer instead of `@actions/languageservice`'s
 *   provider stack: the provider stack requires a ContextProviderConfig
 *   + ValueProviderConfig setup that the lint pipeline already documents
 *   as deferred (WI-5.2 in the prior plan). For names-only completion
 *   we have everything we need from the IR. Type-aware completion
 *   (e.g., outputs of a specific action) is the part that needs the
 *   provider — explicitly out-of-scope per the plan's risk section.
 *
 * @module lib/ghaWorkflow/completion/expressionCompletion
 */

import type { WorkflowIR, JobIR } from "@/lib/ghaWorkflow/types";

export interface ExpressionContext {
  jobIds: string[];
  /** Step ids of the active job (empty when no job context). */
  stepIds: string[];
  /** Env keys, scoped to workflow + active job + active job's first step. */
  envKeys: string[];
  /** workflow_call inputs (only present when `on: workflow_call`). */
  inputs: string[];
  /** Matrix dimensions of the active job's strategy. */
  matrixDimensions: string[];
  /** workflow_call secrets. */
  secrets: string[];
}

export interface CompletionItem {
  label: string;
  /** Human-readable description shown alongside the label. */
  detail?: string;
  /** Optional category tag — used by callers for grouping/sorting. */
  category?: "context" | "identifier" | "github";
}

export interface CompletionResult {
  /** Source position where replacement begins (typically cursor minus prefix length). */
  from: number;
  /** Source position where replacement ends (typically cursor). */
  to: number;
  options: CompletionItem[];
}

/**
 * Top-level GitHub-context property names that GHA exposes inside
 * `${{ github.* }}`. Drawn from the GitHub Actions reference docs:
 * https://docs.github.com/en/actions/learn-github-actions/contexts#github-context
 *
 * Kept as a literal list — it's small, stable, and the alternative
 * (parsing JSONSchema from `@actions/languageservice`) would pull in
 * the deferred provider stack.
 */
export const GITHUB_PROPERTIES: readonly string[] = [
  "action",
  "action_path",
  "action_ref",
  "action_repository",
  "action_status",
  "actor",
  "actor_id",
  "api_url",
  "base_ref",
  "env",
  "event",
  "event_name",
  "event_path",
  "graphql_url",
  "head_ref",
  "job",
  "ref",
  "ref_name",
  "ref_protected",
  "ref_type",
  "repository",
  "repository_id",
  "repository_owner",
  "repository_owner_id",
  "repositoryUrl",
  "retention_days",
  "run_attempt",
  "run_id",
  "run_number",
  "secret_source",
  "server_url",
  "sha",
  "token",
  "triggering_actor",
  "workflow",
  "workflow_ref",
  "workflow_sha",
  "workspace",
] as const;

const ROOT_CONTEXTS: readonly { label: string; detail: string }[] = [
  { label: "github", detail: "GitHub event context" },
  { label: "env", detail: "Environment variables" },
  { label: "vars", detail: "Configuration variables" },
  { label: "job", detail: "Job context" },
  { label: "steps", detail: "Step outputs from prior steps" },
  { label: "needs", detail: "Outputs from jobs in needs[]" },
  { label: "inputs", detail: "Inputs of this workflow_call" },
  { label: "secrets", detail: "Workflow secrets" },
  { label: "matrix", detail: "Matrix strategy values" },
  { label: "strategy", detail: "Strategy context" },
  { label: "runner", detail: "Runner context" },
];

/**
 * Collect identifiers available in expression scope from the IR.
 *
 * Codex audit MED-3 fix: previously offered ALL job ids under
 * `needs.*` and ALL steps in the active job. GHA only exposes:
 *   - `needs.<id>`: jobs in this job's needs[] array (direct deps only)
 *   - `steps.<id>`: prior-or-current step (already-run steps)
 * Restrictions only apply when activeJobId is set; workflow-level
 * scope (no active job) keeps the broader view since semantics there
 * are unconstrained.
 *
 * `cursorStepIndex` (optional) refines `steps.*` further to steps
 * before-or-equal-to the cursor position. Default behavior (undefined)
 * surfaces all steps in the active job for backward compatibility.
 */
export function buildExpressionContext(
  ir: WorkflowIR,
  activeJobId: string | null,
  cursorStepIndex?: number,
): ExpressionContext {
  const activeJob: JobIR | undefined = activeJobId
    ? ir.jobs.find((j) => j.id === activeJobId)
    : undefined;

  // jobIds: when scoped to an active job, narrow to direct deps only.
  // Workflow-level (no activeJob) keeps all jobs visible.
  const jobIds = activeJob
    ? activeJob.needs ?? []
    : ir.jobs.map((j) => j.id);

  // stepIds: limit to prior-or-current step when cursorStepIndex is
  // provided. Without it, expose all steps in the active job (legacy).
  let stepIds: string[] = [];
  if (activeJob) {
    if (typeof cursorStepIndex === "number" && cursorStepIndex >= 0) {
      stepIds = activeJob.steps
        .slice(0, cursorStepIndex + 1)
        .map((s) => s.id);
    } else {
      stepIds = activeJob.steps.map((s) => s.id);
    }
  }

  const envKeys = new Set<string>();
  for (const k of Object.keys(ir.env ?? {})) envKeys.add(k);
  if (activeJob) {
    for (const k of Object.keys(activeJob.env ?? {})) envKeys.add(k);
    for (const step of activeJob.steps) {
      for (const k of Object.keys(step.env ?? {})) envKeys.add(k);
    }
  }

  const inputs: string[] = [];
  const secrets: string[] = [];
  for (const trigger of ir.triggers) {
    if (trigger.event === "workflow_call" || trigger.event === "workflow_dispatch") {
      if (trigger.inputs) {
        for (const k of Object.keys(trigger.inputs)) {
          if (!inputs.includes(k)) inputs.push(k);
        }
      }
    }
    if (trigger.event === "workflow_call" && trigger.secrets) {
      for (const k of Object.keys(trigger.secrets)) {
        if (!secrets.includes(k)) secrets.push(k);
      }
    }
  }

  const matrixDimensions: string[] = [];
  if (activeJob?.strategy?.matrix?.dimensions) {
    for (const k of Object.keys(activeJob.strategy.matrix.dimensions)) {
      matrixDimensions.push(k);
    }
  }

  return {
    jobIds,
    stepIds,
    envKeys: [...envKeys],
    inputs,
    matrixDimensions,
    secrets,
  };
}

/**
 * Find the bounds of the `${{ }}` expression that contains a cursor
 * offset, if any. Returns null when the cursor is outside any
 * expression. Handles unclosed expressions (returns the open
 * position with `to` set to text length).
 */
function findEnclosingExpression(
  text: string,
  cursor: number,
): { from: number; to: number; inner: string } | null {
  if (cursor < 0 || cursor > text.length) return null;
  // Walk backward from cursor looking for an unclosed `${{`.
  let openIdx = -1;
  for (let i = cursor - 1; i >= 1; i--) {
    if (text[i] === "{" && text[i - 1] === "{") {
      // Look one char back for $ — `${{`
      if (i >= 2 && text[i - 2] === "$") {
        openIdx = i + 1; // first content char position
        break;
      }
    }
    // If we hit a `}}` walking backward, we're past a previous close.
    if (text[i] === "}" && text[i - 1] === "}") {
      return null;
    }
  }
  if (openIdx === -1) return null;

  // Walk forward from cursor looking for `}}` closer.
  let closeIdx = text.length;
  for (let i = cursor; i < text.length - 1; i++) {
    if (text[i] === "}" && text[i + 1] === "}") {
      closeIdx = i;
      break;
    }
    // Bail if we hit another `${{` before closing — malformed.
    if (
      i >= 2 &&
      text[i] === "{" &&
      text[i + 1] === "{" &&
      i >= 1 &&
      text[i - 1] === "$"
    ) {
      return null;
    }
  }

  return { from: openIdx, to: closeIdx, inner: text.slice(openIdx, closeIdx) };
}

/**
 * Return the dotted-path identifier preceding the cursor. GHA expression
 * identifiers permit `-` (e.g., `inputs.node-version`,
 * `needs.build.outputs.artifact-id`), so the token regex includes it.
 */
function pathBeforeCursor(
  text: string,
  cursor: number,
  exprFrom: number,
): { path: string[]; prefixStart: number; prefix: string } {
  let i = cursor;
  while (i > exprFrom && /[A-Za-z0-9_.-]/.test(text[i - 1])) {
    i--;
  }
  const segment = text.slice(i, cursor);
  const parts = segment.split(".");
  const prefix = parts[parts.length - 1] ?? "";
  return {
    path: parts.slice(0, -1),
    prefixStart: cursor - prefix.length,
    prefix,
  };
}

function filterByPrefix<T extends CompletionItem>(items: T[], prefix: string): T[] {
  if (!prefix) return items;
  const lower = prefix.toLowerCase();
  return items.filter((i) => i.label.toLowerCase().startsWith(lower));
}

/**
 * Compute completions at a cursor offset. Returns null when:
 *   - cursor is outside any `${{ }}` expression
 *   - cursor is past the source's last index
 */
export function completeAtPosition(
  source: string,
  cursor: number,
  ir: WorkflowIR,
  activeJobId: string | null = null,
  cursorStepIndex?: number,
): CompletionResult | null {
  if (cursor > source.length) return null;
  const enclosing = findEnclosingExpression(source, cursor);
  if (!enclosing) return null;

  const { path, prefixStart, prefix } = pathBeforeCursor(
    source,
    cursor,
    enclosing.from,
  );
  const ctx = buildExpressionContext(ir, activeJobId, cursorStepIndex);

  let options: CompletionItem[] = [];

  if (path.length === 0) {
    options = ROOT_CONTEXTS.map((c) => ({
      ...c,
      category: "context" as const,
    }));
  } else if (path.length === 1) {
    const root = path[0];
    // The `job` context is a singleton (no <id> level) — offer its
    // top-level fields directly.
    if (root === "job") {
      options = [
        { label: "container", category: "identifier" },
        { label: "services", category: "identifier" },
        { label: "status", category: "identifier" },
      ];
    } else {
      options = expandRoot(root, ctx);
    }
  } else if (path.length === 2 && path[0] === "steps") {
    // steps.<id>.<TAB> — typically `outputs`, `outcome`, `conclusion`
    options = [
      { label: "outputs", detail: "Step outputs", category: "identifier" },
      { label: "outcome", detail: "Step outcome", category: "identifier" },
      {
        label: "conclusion",
        detail: "Step conclusion",
        category: "identifier",
      },
    ];
  } else if (path.length === 2 && path[0] === "needs") {
    options = [
      {
        label: "outputs",
        detail: "Needed job outputs",
        category: "identifier",
      },
      { label: "result", detail: "Needed job result", category: "identifier" },
    ];
  } else if (path.length === 3 && path[0] === "steps" && path[2] === "outputs") {
    // steps.<id>.outputs.<TAB> — outputs aren't inferable from the IR
    // alone (they live in action.yml or are written by a prior step).
    // Empty list per WI-A.1 risk note; handled by ContextProvider in
    // a future plan.
    options = [];
  } else if (
    path.length === 3 &&
    path[0] === "needs" &&
    path[2] === "outputs"
  ) {
    // needs.<jobId>.outputs.<TAB> — similar gap, but if the active
    // workflow declares the job's outputs we can surface those.
    const jobId = path[1];
    const targetJob = ir.jobs.find((j) => j.id === jobId);
    if (targetJob?.outputs) {
      options = Object.keys(targetJob.outputs).map((k) => ({
        label: k,
        detail: `Output of job '${jobId}'`,
        category: "identifier" as const,
      }));
    }
  }

  return {
    from: prefixStart,
    to: cursor,
    options: filterByPrefix(options, prefix),
  };
}

function expandRoot(root: string, ctx: ExpressionContext): CompletionItem[] {
  switch (root) {
    case "github":
      return GITHUB_PROPERTIES.map((p) => ({
        label: p,
        detail: "github context",
        category: "github" as const,
      }));
    case "env":
      return ctx.envKeys.map((k) => ({
        label: k,
        detail: "env variable",
        category: "identifier" as const,
      }));
    case "steps":
      return ctx.stepIds.map((s) => ({
        label: s,
        detail: "step id",
        category: "identifier" as const,
      }));
    case "needs":
      return ctx.jobIds.map((j) => ({
        label: j,
        detail: "needed job",
        category: "identifier" as const,
      }));
    case "inputs":
      return ctx.inputs.map((k) => ({
        label: k,
        detail: "workflow_call input",
        category: "identifier" as const,
      }));
    case "secrets":
      return ctx.secrets.map((k) => ({
        label: k,
        detail: "workflow_call secret",
        category: "identifier" as const,
      }));
    case "matrix":
      return ctx.matrixDimensions.map((d) => ({
        label: d,
        detail: "matrix dimension",
        category: "identifier" as const,
      }));
    default:
      return [];
  }
}
