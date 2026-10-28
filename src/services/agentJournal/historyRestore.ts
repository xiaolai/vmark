/**
 * History restore — put an earlier text back into a tab as a controlled
 * mutation of the agent edit journal, from the history panel: a journaled
 * revision, an uncommitted entry's preimage, or a pre-journal checkpoint.
 *
 * Pipeline: read the tab's buffer → the journaled-mutation coordinator
 * (`journaledMutation.ts`: provenance freeze, prepare, verify, apply,
 * commit, basis and provenance settlement) with this file's adapters: the
 * restore prepare (records the overwritten buffer first as the user's
 * baseline; replies with the text to put back), the whole-buffer re-verify,
 * the apply of that text, the store read-back, and the panel's outcome.
 *
 * Key decisions:
 *   - Re-verify is whole-buffer: a tab closed (`closed`) or edited
 *     (`edited`) while the prepare was in flight aborts, and nothing is
 *     applied. A tab that became another document meanwhile (a Save As
 *     moves its journal key) aborts as `closed`: the restore was prepared
 *     against the old document. So does a tab closed and reopened (same id,
 *     its lifecycle token changed), and a closed tab learns no basis.
 *     The apply runs right after the re-verify with no `await` between.
 *   - An equal text is still committed: the journal records the restore as
 *     a barrier either way, and the panel reports it unchanged.
 *   - Basis, provenance and read-back handling are the coordinator's: an
 *     apply that throws and changed the buffer is answered
 *     `appliedWithError`; a tab closed meanwhile cannot be read back
 *     (`recoveryRequired`); an unchanged buffer rethrows the error.
 *
 * @coordinates-with services/agentJournal/journaledMutation.ts — the coordinator
 * @coordinates-with services/agentJournal/historyClient.ts — the restore prepare
 * @module services/agentJournal/historyRestore
 */

import { useDocumentStore } from "@/stores/documentStore";
import { canonicalizeLineEndings } from "@/utils/editorText";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import type { AbortReason } from "./journalClient";
import { runJournaledMutation, type JournaledOutcome } from "./journaledMutation";
import { restorePrepare, type PreparedRestore, type RestoreSource } from "./historyClient";
import type { JournalRefusal } from "./journalRefusal";
import { docKeyFor, isJournalTabLive, journalTabLife } from "./documentIdentity";

export type HistoryRestoreOutcome =
  | { status: "refused"; refusal: JournalRefusal }
  | { status: "aborted"; reason: AbortReason }
  /** `changed`: the buffer's text changed; `resolves`: the uncommitted entry it ended. */
  | { status: "applied"; durable: boolean; changed: boolean; resolves: string | null }
  /** The apply threw after changing the buffer; the text it holds was committed. */
  | { status: "appliedWithError"; error: unknown; durable: boolean; changed: true; resolves: string | null }
  /** The apply threw and the tab could not be read back; the journal keeps the restore open. */
  | { status: "recoveryRequired"; error: unknown };

const contentOf = (tabId: string): string | undefined => useDocumentStore.getState().documents[tabId]?.content;

/** The tab's journal key now, or `undefined` once it is closed (or closed and reopened since `life`). */
function keyOf(tabId: string, life: number): string | undefined {
  const doc = useDocumentStore.getState().documents[tabId];
  if (!doc || !isJournalTabLive(tabId, life)) return undefined;
  return docKeyFor({ tabId, filePath: doc.filePath }, getCurrentWindowLabel());
}

/** Restore `source` into the tab `tabId` through the journal. */
export async function restoreFromHistory(tabId: string, source: RestoreSource): Promise<HistoryRestoreOutcome> {
  const doc = useDocumentStore.getState().documents[tabId];
  if (!doc) return { status: "aborted", reason: "closed" };
  const preimage = doc.content;
  const docKey = docKeyFor({ tabId, filePath: doc.filePath }, getCurrentWindowLabel());
  const life = journalTabLife(tabId);
  let resolves: string | null = null;
  return runJournaledMutation({
    tabId,
    life,
    docKey,
    preimage,
    retryHint: "retry",
    prepare: (baseline) =>
      restorePrepare({
        docKey: baseline.docKey,
        parent: baseline.parent,
        preimage: baseline.preimage,
        source,
        baselineProvenance: baseline.baselineProvenance,
        baselineTouched: baseline.baselineTouched,
        ...(baseline.observedParent && { observedParent: baseline.observedParent }),
        ...(baseline.capture && { capture: baseline.capture }),
      }),
    verify: () => {
      const now = contentOf(tabId);
      if (now === undefined || keyOf(tabId, life) !== docKey) return "closed";
      return now === preimage ? null : "edited";
    },
    apply: (prepared: PreparedRestore) => {
      resolves = prepared.resolves;
      const text = canonicalizeLineEndings(prepared.text);
      if (text !== preimage) useDocumentStore.getState().setEditorContent(tabId, text);
      const postimage = contentOf(tabId) ?? text;
      return { postimage, value: postimage !== preimage };
    },
    recover: () => {
      const now = contentOf(tabId);
      if (now === undefined || keyOf(tabId, life) !== docKey) throw new Error("the tab closed during the restore");
      return now;
    },
    outcome: (outcome: JournaledOutcome<boolean>): HistoryRestoreOutcome => {
      switch (outcome.status) {
        case "applied":
          return { status: "applied", durable: outcome.durable, changed: outcome.value, resolves };
        case "appliedWithError":
          return { status: "appliedWithError", error: outcome.error, durable: outcome.durable, changed: true, resolves };
        default:
          return outcome;
      }
    },
  });
}
