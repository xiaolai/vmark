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
 *     inconclusive → stop and ask. A write that *reports* success while its
 *     postcondition says it did not land contradicts itself → stop and ask.
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

/** What the engine should do after a step result. Exhaustive — the engine switches
 *  on it with a `never` guard, so adding a member is a compile error there, not a
 *  silent fall-through into the retry path. */
export type NextAction = "done" | "retry" | "stop-and-ask";

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
  if (result.outcome === "success") {
    // A write that reports success while its postcondition says it did NOT land is
    // self-contradictory. Believing the report marks a never-applied publish complete;
    // believing the postcondition and retrying risks the double-post. Ask a human.
    if (write && result.postconditionMet === false) return "stop-and-ask";
    return "done";
  }

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

/**
 * Deterministic, order-independent encoding for idempotency keys.
 *
 * NOT `JSON.stringify`: it flattens distinct values onto the same text — `NaN`,
 * `Infinity` and `null` all become `"null"`, `[undefined]` becomes `[null]`, a key
 * whose value is `undefined` disappears entirely, and `Map`/`Set` collapse to `{}`.
 * A key collision between two *different* writes is precisely the double-post this
 * module exists to prevent, so anything that cannot be encoded unambiguously
 * (symbol, function, class instance, cycle) throws instead of guessing.
 */
function canonical(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "boolean":
      return value ? "true" : "false";
    case "number":
      // NaN / ±Infinity are not JSON — tag them so they cannot collide with `null`.
      return Number.isFinite(value) ? JSON.stringify(value) : `#${String(value)}`;
    case "bigint":
      return `${value}n`;
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`idempotencyKey: cannot encode a value of type "${typeof value}".`);
  }

  const obj = value as object;
  if (seen.has(obj)) throw new TypeError("idempotencyKey: cannot encode a cyclic value.");
  seen.add(obj);
  try {
    if (Array.isArray(obj)) return `[${obj.map((v) => canonical(v, seen)).join(",")}]`;
    if (obj instanceof Date) {
      const t = obj.getTime();
      return `Date(${Number.isNaN(t) ? "invalid" : obj.toISOString()})`;
    }
    const proto: unknown = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`idempotencyKey: cannot encode a "${obj.constructor?.name ?? "object"}" value.`);
    }
    const record = obj as Record<string, unknown>;
    const body = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k], seen)}`)
      .join(",");
    return `{${body}}`;
  } finally {
    // Only ancestors are "seen" — the same object twice in a tree is not a cycle.
    seen.delete(obj);
  }
}

/** A stable key for a write, so a repeated attempt with the same inputs is
 *  detectable and can be deduplicated rather than re-applied. Throws (rather than
 *  returning an ambiguous key) on values it cannot encode — see `canonical`. */
export function idempotencyKey(stepId: string, inputs: Record<string, unknown>): string {
  return `${stepId}:${canonical(inputs, new Set())}`;
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
