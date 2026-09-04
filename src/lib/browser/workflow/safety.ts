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
 *   - (The tier-escalation ladder and the genie-loop bounds that used to live
 *     here were removed in the 2026-09-03 audit-fix round: neither had a
 *     production consumer.)
 *   - **Writes never auto-escalate** to a higher (more autonomous) tier — an
 *     escalation is a new, human-approved operation, not an automatic fallback.
 *   - Idempotency keys make a repeated write detectable. The collision-averse
 *     encoding behind them lives in `canonicalEncode.ts` (split out in audit r3
 *     #140): a key collision between two different writes IS the double-post.
 *
 * @coordinates-with services/browser/lease.ts — a lost lease also pauses a workflow
 * @coordinates-with lib/browser/workflow/parser.ts — steps come from the parsed IR
 * @coordinates-with lib/browser/workflow/canonicalEncode.ts — the encoding under `idempotencyKey`
 * @coordinates-with lib/browser/workflow/identity.ts — `idempotencyKey` encodes the declared inputs into the ledger identity
 * @module lib/browser/workflow/safety
 */
import { encodeCanonical } from "./canonicalEncode";

/** A step's observed outcome — deliberately three-valued (R8a). */
type Outcome = "success" | "failed" | "unknown";

/** What the engine should do after a step result. Exhaustive — the engine switches
 *  on it with a `never` guard, so adding a member is a compile error there, not a
 *  silent fall-through into the retry path. */
export type NextAction = "done" | "retry" | "stop-and-ask";

/** The result of running a step. */
export interface StepOutcome {
  outcome: Outcome;
  /** For a write: whether a postcondition check confirmed the write landed.
   *  `undefined` = not checked / inconclusive — the safe-but-blocking case. */
  postconditionMet?: boolean;
  /** Why a step failed (`obscured`, `not-found`, a driver token…). Informational:
   *  the decision core reads `outcome` + `postconditionMet` only. */
  reason?: string;
  /** Step output for the model (an `extract:` step's reader summary, a heal note).
   *  Informational — never consulted by the decision core. */
  data?: Record<string, unknown>;
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

/** A stable key for a write, so a repeated attempt with the same inputs is
 *  detectable and can be deduplicated rather than re-applied. Throws (rather than
 *  returning an ambiguous key) on values it cannot encode — see `encodeCanonical`. */
export function idempotencyKey(stepId: string, inputs: Record<string, unknown>): string {
  return `${stepId}:${encodeCanonical(inputs)}`;
}
