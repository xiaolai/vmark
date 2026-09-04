/**
 * runExecutorHeal — the self-heal half of the executor (round 3, #106): resolve
 * a role-less locator's role from a fresh snapshot (W10), and retry a not-found
 * act against a near-identical same-role locator (WI-NB6.4 / P-3), each through the
 * shared `ExecutorEnv`.
 *
 * @coordinates-with services/workflow/runExecutorEnv.ts — the env these run through
 * @coordinates-with lib/browser/workflow/selfHeal.ts — the heal proposal
 * @coordinates-with lib/browser/workflow/roleResolution.ts — role for a role-less locator
 * @module services/workflow/runExecutorHeal
 */
import { proposeLocatorFix } from "@/lib/browser/workflow/selfHeal";
import { resolveRoleByName, type SnapshotRead } from "@/lib/browser/workflow/roleResolution";
import type { StepOutcome } from "@/lib/browser/workflow/safety";
import type { ActOp, ExecutorEnv } from "./runExecutorEnv";

/** WI-NB6.4 — one heal attempt: read a fresh snapshot, propose a same-role
   *  locator whose name is close to the failed one, and retry the act against
   *  it. The healed act re-enters `authorize` (P-3) with `requireFreshApproval`: a
   *  one-shot bound to the old descriptor cannot match the new name, and a standing
   *  grant does not cover a locator the author never wrote — a fresh prompt names
   *  the healed target (round 3, #162). */
export async function healAndRetry(env: ExecutorEnv, op: ActOp, role: string, name: string, text: string | undefined, url: string, generation: number): Promise<StepOutcome | null> {
  let snapshot: SnapshotRead;
  try {
    snapshot = await env.readSnapshot(generation);
  } catch {
    return null;
  }
  // Every healed act here is a write (click/type): hold it to the strict floor.
  const fix = proposeLocatorFix({ role, name }, snapshot.nodes, { write: true });
  if (fix === null || fix.name === name) return null;
  const { raw: _raw, ...healed } = await env.actOnce(op, fix.role, fix.name, text, url, true);
  return { ...healed, data: { healedFrom: name, healedTo: fix.name } };
}

/** W10 — a role-less locator: resolve the role from a fresh snapshot, or explain. */
export async function resolveRole(env: ExecutorEnv, name: string, generation: number): Promise<string | StepOutcome> {
  const resolution = resolveRoleByName(await env.readSnapshot(generation), name);
  switch (resolution.kind) {
    case "resolved":
      return resolution.role;
    case "none":
      return { outcome: "failed", postconditionMet: false, reason: "not-found" };
    case "ambiguous":
      return { outcome: "failed", reason: `ambiguous: "${name}" is a ${resolution.roles.join(", ")}` };
    default:
      return { outcome: "failed", reason: resolution.reason };
  }
}
