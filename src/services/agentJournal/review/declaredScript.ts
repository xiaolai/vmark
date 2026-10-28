/**
 * Declared script — the certificate a whole-text agent write sends with its
 * prepare: the canonical diff of the preimage and the text the write will
 * produce, which is the operation by definition.
 *
 * Key decisions:
 *   - The script is the budgeted canonical diff (diff-match-patch with
 *     semantic cleanup in a worker, under the diff deadline, with the
 *     trimmed linear fallback). The journal derives one hunk per changed run
 *     and adds each run's rotation break itself; nothing here groups runs.
 *   - It is declared against the editor-domain text the write will leave
 *     (`transportText`): the store drops a leading BOM and turns CRLF into
 *     LF on ingest, so a transport-only difference declares no change and
 *     review shows no hunk for it (ADR-AL10).
 *   - It is built before the write applies. A live editor that
 *     re-serializes makes the applied text differ from the target; the
 *     journal's commit check then records the write as a counted barrier.
 *   - A script whose map does not fit the entry cap is not sent: the write
 *     is recorded as a barrier, and the reason is logged.
 *
 * @coordinates-with services/mcpBridge/v2/journaledEdit.ts — sends it with the prepare
 * @coordinates-with services/agentJournal/review/transportNormalization.ts — the text the script is declared against
 * @coordinates-with src-tauri/src/agent_journal/rotation.rs — the rotation breaks and their cap
 * @module services/agentJournal/review/declaredScript
 */

import { journalWarn } from "@/utils/debug";
import { Provenance, PROVENANCE_CAP } from "../provenance/accumulator";
import { certificateOf, type SelectionCertificate } from "../selectionCertificate";
import { BudgetedDiff } from "./budgetedDiff";
import { transportText } from "./transportNormalization";

export interface DeclaredScriptOptions {
  /** The diff to run; the shared budgeted diff by default. */
  readonly diff?: Pick<BudgetedDiff, "diff">;
  readonly cap?: number;
}

let shared: BudgetedDiff | null = null;

/** The certificate of `pre` → the editor-domain text of `written`, or null when its map exceeds the cap. Throws on malformed text. */
export async function declaredScriptCertificate(
  pre: string,
  written: string,
  { diff = (shared ??= new BudgetedDiff()), cap = PROVENANCE_CAP }: DeclaredScriptOptions = {},
): Promise<SelectionCertificate | null> {
  const post = transportText(written);
  const outcome = await diff.diff(pre, post);
  const provenance = new Provenance(pre.length, { cap }).compose(outcome.changes);
  if (provenance.whole) {
    journalWarn(`declared script: not sent (${provenance.whole.reason}); the write is recorded as a barrier`);
    return null;
  }
  return certificateOf(pre, post, provenance);
}
