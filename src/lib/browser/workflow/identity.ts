/**
 * Workflow identity (audit 2026-09-03 W-07) — what the completed-write ledger is
 * keyed on.
 *
 * The ledger used to be keyed on the raw source bytes and ignored inputs, which
 * failed in both directions: re-running the same source with NEW inputs skipped
 * the `type`/`click` steps as "already done", while a whitespace edit reset the
 * ledger and re-executed writes that had already landed. The key is now:
 *
 *   `sourceHash`  — a hash of the NORMALISED source: BOM stripped, CRLF/CR → LF,
 *                   trailing whitespace trimmed per line, comment lines removed,
 *                   trailing blank lines dropped. Nothing the parser reads changes
 *                   under that normalisation, so an edit that cannot change
 *                   execution cannot change the key either.
 *   `inputsHash`  — a hash of the DECLARED inputs' values, encoded with
 *                   `idempotencyKey` (order-independent, collision-averse) so the
 *                   same source run with different values is a different ledger.
 *
 * Leaf-pure: string in, strings out.
 *
 * @coordinates-with lib/browser/workflow/safety.ts — `idempotencyKey` encodes the inputs
 * @coordinates-with services/workflow/runRegistry.ts — the ledger this keys
 * @module lib/browser/workflow/identity
 */
import { idempotencyKey } from "./safety";

const BOM = "\uFEFF";

/** The parser's own notion of a comment line: leading whitespace then `#`. */
function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith("#");
}

/** Normalise source text so that edits invisible to the parser do not change the
 *  identity: BOM, line endings, trailing whitespace, comment lines. */
export function normalizeWorkflowSource(source: string): string {
  const body = source.startsWith(BOM) ? source.slice(BOM.length) : source;
  const lines = body
    .split(/\r\n|\r|\n/)
    .filter((line) => !isCommentLine(line))
    .map((line) => line.replace(/\s+$/u, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

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

export interface WorkflowIdentity {
  /** Hash of the normalised source. */
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
 */
export function workflowIdentity(
  source: string,
  inputs: Record<string, string>,
  declaredInputs: readonly string[],
): WorkflowIdentity {
  const picked: Record<string, string> = {};
  for (const name of declaredInputs) {
    if (Object.hasOwn(inputs, name)) picked[name] = inputs[name];
  }
  const sourceHash = hashText(normalizeWorkflowSource(source));
  const inputsHash = hashText(idempotencyKey("inputs", picked));
  return { sourceHash, inputsHash, ledgerId: `${sourceHash}+${inputsHash}` };
}
