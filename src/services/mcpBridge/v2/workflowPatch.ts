/**
 * Workflow patch — the pure half of `vmark.workflow.apply_patch`: check a
 * batch's shape, and compile it against a workflow's text into the text it
 * yields, with no tab, store or journal involved.
 *
 * Key decisions:
 *   - `IRPatch` is a public contract once exposed via MCP; the shape check
 *     duck-types the discriminator, since runtime clients cannot import the
 *     TypeScript type.
 *   - Patches apply through the CST so YAML comments, anchors and key order
 *     survive. Text that does not parse cannot be stringified, so a batch
 *     over it is INVALID_PATCH, not a throw.
 *   - The well-formed-text check is a backstop: the YAML stringifier escapes
 *     a lone surrogate, so no patch is known to reach it.
 *
 * @coordinates-with workflow.ts — the handler that sequences admission, this compilation and the journaled write
 * @coordinates-with lib/ghaWorkflow/save/cstParser.ts — parseAsCst / stringifyCst
 * @coordinates-with lib/ghaWorkflow/save/mutators.ts — applyPatch + IRPatch types
 * @module services/mcpBridge/v2/workflowPatch
 */

import { parseAsCst, stringifyCst } from "@/lib/ghaWorkflow/save/cstParser";
import { applyPatch, type IRPatch } from "@/lib/ghaWorkflow/save/mutators";
import { isWellFormedText } from "@/services/agentJournal/wellFormedText";
import { errorMessage } from "@/utils/errorMessage";
import { invalidTextError } from "./journalV2Error";
import type { V2Error } from "./types";

const VALID_PATCH_KINDS: ReadonlySet<string> = new Set([
  "workflow.set",
  "job.set",
  "step.set",
  "with.set",
  "with.remove",
  "needs.add",
  "needs.remove",
  "trigger.setFilters",
]);

/** `value` as an `IRPatch[]` we can dispatch, or the INVALID_PATCH naming its first bad entry. */
export function validatePatches(value: unknown): IRPatch[] | V2Error {
  if (!Array.isArray(value)) {
    return { error: "INVALID_PATCH", message: "patches must be an array" };
  }
  for (const [i, p] of value.entries()) {
    if (!p || typeof p !== "object") {
      return { error: "INVALID_PATCH", message: `patches[${i}] must be an object` };
    }
    const kind = (p as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !VALID_PATCH_KINDS.has(kind)) {
      return { error: "INVALID_PATCH", message: `patches[${i}].kind is missing or invalid: ${String(kind)}` };
    }
  }
  return value as IRPatch[];
}

/** What a batch does to a workflow's text. */
export type CompiledPatch =
  | { status: "changed"; text: string }
  | { status: "unchanged" }
  | { status: "refused"; error: V2Error };

/** Apply `patches` to `content` in order and say what text results. Never throws. */
export function compileWorkflowPatch(content: string, patches: readonly IRPatch[]): CompiledPatch {
  let text: string;
  try {
    const cst = parseAsCst(content);
    for (const patch of patches) applyPatch(cst, patch);
    text = stringifyCst(cst);
  } catch (e) {
    return { status: "refused", error: { error: "INVALID_PATCH", message: `Patch application failed: ${errorMessage(e)}` } };
  }
  if (text === content) return { status: "unchanged" };
  if (!isWellFormedText(text)) return { status: "refused", error: invalidTextError() };
  return { status: "changed", text };
}
