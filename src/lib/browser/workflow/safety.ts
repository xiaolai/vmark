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
  // Zero-trust on runtime data: the outcome may arrive from a native/deserialized
  // executor, so an out-of-contract value must fail closed. Without this guard a
  // garbage outcome with `postconditionMet: false` would fall through to the failed
  // path and be auto-retried — exactly the double-post this module prevents.
  if (result.outcome !== "success" && result.outcome !== "failed" && result.outcome !== "unknown") {
    return "stop-and-ask";
  }

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
 * (symbol, function, class instance, accessor, cycle) throws instead of guessing;
 * `-0`, sparse-array holes, and non-enumerable properties are encoded distinctly so
 * they cannot silently share a key either.
 */

/** Guard against an adversarially deep input blowing the stack while we build the
 *  raw key. Workflow inputs are flat records, so this ceiling is far above any real one. */
const MAX_ENCODE_DEPTH = 100;

function canonical(value: unknown, seen: Set<object>, depth: number): string {
  if (depth > MAX_ENCODE_DEPTH) {
    throw new TypeError("idempotencyKey: input nested deeper than the encoder allows.");
  }
  if (value === null) return "null";
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "boolean":
      return value ? "true" : "false";
    case "number":
      // NaN / ±Infinity are not JSON — tag them so they cannot collide with `null`.
      if (!Number.isFinite(value)) return `#${String(value)}`;
      // `-0` and `0` are distinct write inputs; JSON.stringify flattens both to "0".
      return Object.is(value, -0) ? "-0" : JSON.stringify(value);
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
    if (Array.isArray(obj)) return encodeArray(obj, seen, depth);
    if (obj instanceof Date) return encodeDate(obj);
    const proto: unknown = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`idempotencyKey: cannot encode a "${obj.constructor?.name ?? "object"}" value.`);
    }
    return encodePlainObject(obj as Record<string, unknown>, seen, depth);
  } finally {
    // Only ancestors are "seen" — the same object twice in a tree is not a cycle.
    seen.delete(obj);
  }
}

/** Encode by index over the FULL length so a hole is distinct from `undefined` and
 *  `Array(1)` cannot collide with `[]` (the default `.map` skips holes). */
function encodeArray(arr: unknown[], seen: Set<object>, depth: number): string {
  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    parts.push(i in arr ? canonical(arr[i], seen, depth + 1) : "#hole");
  }
  return `[${parts.join(",")}]`;
}

/** A Date SUBCLASS, or a plain Date carrying own properties, is a class instance in
 *  disguise — reject it rather than silently ignoring the extras and colliding. */
function encodeDate(date: Date): string {
  if (Object.getPrototypeOf(date) !== Date.prototype || Reflect.ownKeys(date).length > 0) {
    throw new TypeError("idempotencyKey: cannot encode a Date subclass or a Date with own properties.");
  }
  const t = date.getTime();
  return `Date(${Number.isNaN(t) ? "invalid" : date.toISOString()})`;
}

/** `Reflect.ownKeys` (not `Object.keys`) so a symbol key or a non-enumerable property
 *  cannot silently vanish and collide with `{}`. Symbol keys and accessors are
 *  rejected — an accessor is stateful/side-effecting, which a deterministic key must
 *  not be. Non-enumerable own data properties ARE encoded, so they stay distinct. */
function encodePlainObject(record: Record<string, unknown>, seen: Set<object>, depth: number): string {
  const stringKeys: string[] = [];
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key === "symbol") {
      throw new TypeError("idempotencyKey: cannot encode an object with symbol keys.");
    }
    const desc = Object.getOwnPropertyDescriptor(record, key);
    if (desc && (desc.get || desc.set)) {
      throw new TypeError("idempotencyKey: cannot encode an object with accessor properties.");
    }
    stringKeys.push(key);
  }
  const body = stringKeys
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(record[k], seen, depth + 1)}`)
    .join(",");
  return `{${body}}`;
}

/** A stable key for a write, so a repeated attempt with the same inputs is
 *  detectable and can be deduplicated rather than re-applied. Throws (rather than
 *  returning an ambiguous key) on values it cannot encode — see `canonical`. */
export function idempotencyKey(stepId: string, inputs: Record<string, unknown>): string {
  return `${stepId}:${canonical(inputs, new Set(), 0)}`;
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
  // Fail closed: a NaN or negative bound/counter silently defeats every `>=` guard
  // (NaN comparisons are always false), which would let the loop run unbounded. Treat
  // it as "stop now". `>= 0` rejects NaN and negatives while still allowing Infinity as
  // an explicit "no limit" — the other bound then governs.
  if (!(state.iterations >= 0) || !(bounds.maxIterations >= 0)) return "max-iterations";
  if (state.iterations >= bounds.maxIterations) return "max-iterations";
  if (!(state.elapsedMs >= 0) || !(bounds.timeoutMs >= 0)) return "timeout";
  if (state.elapsedMs >= bounds.timeoutMs) return "timeout";
  return null;
}
