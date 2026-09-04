/**
 * Workflow identity (audit 2026-09-03 W-07, r3 #135) — what the completed-write
 * ledger is keyed on.
 *
 * The ledger used to be keyed on the raw source bytes and ignored inputs, which
 * failed in both directions: re-running the same source with NEW inputs skipped
 * the `type`/`click` steps as "already done", while a whitespace edit reset the
 * ledger and re-executed writes that had already landed. A first fix hashed a
 * NORMALISED source text — a private re-implementation of what the parser
 * ignores, and an incomplete one: step indentation, interior blank lines, list
 * numbering and an unknown front-matter key all still changed the key (and could
 * re-enable a completed write) while the parser saw the same workflow. The key
 * is now:
 *
 *   `sourceHash`  — a hash of the canonical serialisation of the PARSED IR: the
 *                   site, the declared input names as a sorted set, the trigger,
 *                   and each step's kind + text in order. Source positions (`line`,
 *                   the positional `index`) are excluded. Two sources that parse to
 *                   the same steps share an identity by construction — there is no
 *                   second definition of "what the parser ignores" left to drift.
 *   `inputsHash`  — a hash of the DECLARED inputs' values, encoded with
 *                   `idempotencyKey` (order-independent, collision-averse) so the
 *                   same source run with different values is a different ledger.
 *
 * An UNPARSEABLE source is REFUSED (TypeError), never hashed: the validator parses
 * before it asks for an identity, so this is an invariant rather than a user path;
 * a text-hash fallback would give one workflow two possible ledgers depending on
 * which path ran; and a workflow with no IR has no steps to ledger.
 *
 * Leaf-pure: string in, strings out.
 *
 * @coordinates-with lib/browser/workflow/parser.ts — `parseWorkflow` produces the IR hashed here
 * @coordinates-with lib/browser/workflow/canonicalEncode.ts — serialises the IR without delimiter collisions
 * @coordinates-with lib/browser/workflow/safety.ts — `idempotencyKey` encodes the inputs
 * @coordinates-with services/workflow/runRegistry.ts — the ledger this keys
 * @coordinates-with services/workflow/workflowRunValidate.ts — the caller; parses first, then asks for the identity
 * @module lib/browser/workflow/identity
 */
import { encodeCanonical } from "./canonicalEncode";
import { parseWorkflow } from "./parser";
import { idempotencyKey } from "./safety";
import type { WebWorkflow } from "./types";

/** FNV-1a (32-bit) over UTF-16 code units, one seed. */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A cheap, stable content hash: two independently seeded FNV-1a mixes joined, so a
 * collision needs both 32-bit values to agree. Not cryptographic — the ledger is a
 * session-local double-post guard, not a security boundary — but a single 32-bit
 * hash colliding across two different workflows would silently skip a write.
 */
export function hashText(text: string): string {
  return `${fnv1a(text, 2166136261).toString(36)}:${fnv1a(text, 0x9e3779b9).toString(36)}`;
}

/** The IR's semantic fields in a fixed shape: what the workflow DOES, with nothing
 *  about where in the file it said so. Input names are sorted because `{var}`
 *  references resolve by name — declaration order is not part of the workflow. */
function canonicalWorkflow(workflow: WebWorkflow): Record<string, unknown> {
  return {
    site: workflow.site,
    inputs: [...workflow.inputs].sort(),
    trigger: workflow.trigger,
    steps: workflow.steps.map((step) => ({ kind: step.kind, text: step.text })),
  };
}

/** The `sourceHash` half of the identity: a hash of the parsed workflow's canonical
 *  serialisation. Encoded with `encodeCanonical`, so a step text that contains the
 *  serialisation's own syntax cannot forge a second step. */
export function canonicalWorkflowHash(workflow: WebWorkflow): string {
  return hashText(encodeCanonical(canonicalWorkflow(workflow)));
}

export interface WorkflowIdentity {
  /** Hash of the parsed workflow IR (see `canonicalWorkflowHash`). */
  sourceHash: string;
  /** Hash of the declared inputs' values (own properties only, order-independent). */
  inputsHash: string;
  /** The ledger key: `${sourceHash}+${inputsHash}`. */
  ledgerId: string;
}

/**
 * Compute a workflow's identity for the ledger. Only the DECLARED inputs feed the
 * hash — an undeclared extra is refused upstream, and reading through inherited
 * properties (`constructor`) would let a value that was never supplied count.
 * Throws a TypeError when `source` does not parse (see the header for why).
 */
export function workflowIdentity(
  source: string,
  inputs: Record<string, string>,
  declaredInputs: readonly string[],
): WorkflowIdentity {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) {
    const codes = parsed.errors.map((e) => e.code).join(", ");
    throw new TypeError(`workflowIdentity: source does not parse (${codes}) — an unparseable workflow has no identity.`);
  }
  const picked: Record<string, string> = {};
  for (const name of declaredInputs) {
    if (Object.hasOwn(inputs, name)) picked[name] = inputs[name];
  }
  const sourceHash = canonicalWorkflowHash(parsed.workflow);
  const inputsHash = hashText(idempotencyKey("inputs", picked));
  return { sourceHash, inputsHash, ledgerId: `${sourceHash}+${inputsHash}` };
}
