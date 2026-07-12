/**
 * Workflow write-safety decision core (WI-4.2 / R8/R8a).
 *
 * Purpose: the pure decision rules that keep an automated workflow from doing
 * something irreversible-and-wrong — above all, double-posting a write that may
 * have partially succeeded. Codex flagged this as the plan's highest-risk area
 * (self-healing re-running a write). These functions have no I/O; the execution
 * engine feeds them a step classification + observed outcome and acts on the
 * verdict.
 *
 * The load-bearing rules:
 *   - A three-valued outcome {success, failed, unknown}. An **unknown** outcome
 *     NEVER auto-retries — the engine stops and asks a human, because a retry
 *     could apply the write twice.
 *   - A failed **write** consults a postcondition before any retry: confirmed
 *     not-applied → retry; confirmed applied → treat as an idempotent success;
 *     inconclusive → stop and ask.
 *   - **Writes never auto-escalate** to a higher (more autonomous) tier — an
 *     escalation is a new, human-approved operation, not an automatic fallback.
 *   - Idempotency keys make a repeated write detectable.
 *   - The genie/agent loop is bounded by max-iterations, a timeout, and cancel.
 *
 * @coordinates-with services/browser/lease.ts — a lost lease also pauses a workflow
 * @coordinates-with lib/browser/workflow/parser.ts — steps come from the parsed IR
 * @module lib/browser/workflow/safety
 */

/** A step's observed outcome — deliberately three-valued (R8a). */
export type Outcome = "success" | "failed" | "unknown";

/** What the engine should do after a step result. */
export type NextAction = "done" | "retry" | "stop-and-ask" | "abort";

/** Execution tiers, from least to most autonomous. */
export const TIER_ORDER = ["api", "action", "goal", "vision"] as const;
export type Tier = (typeof TIER_ORDER)[number];

/** The result of running a step. */
export interface StepOutcome {
  outcome: Outcome;
  /** For a write: whether a postcondition check confirmed the write landed.
   *  `undefined` = not checked / inconclusive — the safe-but-blocking case. */
  postconditionMet?: boolean;
}

/**
 * Decide the next action after a step result (R8a). `write` marks a mutating
 * step (publish, submit, delete); reads are idempotent and may retry freely.
 */
export function decideAfterResult(write: boolean, result: StepOutcome): NextAction {
  if (result.outcome === "success") return "done";

  // R8a core: an unknown outcome must never auto-retry — a retry could
  // double-apply a write that may have partially succeeded.
  if (result.outcome === "unknown") return "stop-and-ask";

  // outcome === "failed"
  if (!write) return "retry"; // reads are idempotent

  // A failed write: consult the postcondition before any retry.
  if (result.postconditionMet === true) return "done"; // it actually landed
  if (result.postconditionMet === false) return "retry"; // confirmed not applied
  return "stop-and-ask"; // inconclusive — never risk a double write
}

/**
 * The next tier to try, or null when escalation is not allowed. Writes never
 * auto-escalate (R8a): a more-autonomous retry of a write is a new operation
 * that must be re-approved, not an automatic fallback.
 */
export function nextTier(current: Tier, write: boolean): Tier | null {
  if (write) return null;
  const i = TIER_ORDER.indexOf(current);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

/** Deterministic, order-independent JSON stringify for idempotency keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

/** A stable key for a write, so a repeated attempt with the same inputs is
 *  detectable and can be deduplicated rather than re-applied. */
export function idempotencyKey(stepId: string, inputs: Record<string, unknown>): string {
  return `${stepId}:${stableStringify(inputs)}`;
}

/** Live loop counters. */
export interface LoopState {
  iterations: number;
  elapsedMs: number;
  cancelled: boolean;
}

/** Configured loop bounds. */
export interface LoopBounds {
  maxIterations: number;
  timeoutMs: number;
}

/** Why the genie/agent loop should stop, or null to continue. Cancellation
 *  takes precedence, then the iteration cap, then the timeout. */
export function loopStopReason(
  state: LoopState,
  bounds: LoopBounds,
): "cancelled" | "max-iterations" | "timeout" | null {
  if (state.cancelled) return "cancelled";
  if (state.iterations >= bounds.maxIterations) return "max-iterations";
  if (state.elapsedMs >= bounds.timeoutMs) return "timeout";
  return null;
}
