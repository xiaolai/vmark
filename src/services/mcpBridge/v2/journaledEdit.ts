/**
 * Journaled edit — run one MCP edit of a tab's buffer through the agent
 * edit journal's controlled-mutation protocol: the shared core of
 * `document.write`, `document.transform`, `selection.set` and
 * `workflow.apply_patch`.
 *
 * Pipeline: capture the write target → the journaled-mutation coordinator
 * (`journaledMutation.ts`: evicted-basis refusal, provenance freeze, prepare,
 * verify, apply, commit, basis and provenance settlement) with this file's
 * adapters: the controlled prepare under the request's MCP actor, the
 * write-target re-verify (`writeTarget.ts`), the caller's apply, a store
 * read-back after the caller's `recover`, and the MCP answer.
 *
 * Key decisions:
 *   - A commit is a whole-document barrier unless the edit certifies it:
 *     with its exact change (`change`, a Source `selection.set`, known before
 *     it applies), sent with the prepare; with its declared script (`target`,
 *     the whole text `document.write`, `document.transform` or
 *     `workflow.apply_patch` will produce), also sent with the prepare; or
 *     after the apply (`certify`, a WYSIWYG `selection.set`, from what the
 *     editor's collector saw), sent with the commit through the
 *     coordinator's effects hook. The journal binds each to the parent it
 *     mints, checks it against the applied text, and falls back to the
 *     barrier when it does not hold: a live editor that re-serializes the
 *     target is such a fallback.
 *   - A certificate that cannot be built is logged and not sent: the write
 *     goes ahead as a barrier, never refused or degraded for it (the effects
 *     hook never throws).
 *   - Refusals and aborts are answered here, so a caller only sees the
 *     applied outcome; `null` means the request has been answered. An apply
 *     that threw and changed the buffer is answered INTERNAL with
 *     `applied: true` and `durable`; an unreadable one INTERNAL without
 *     `applied`; an unchanged one rethrows the apply's error.
 *   - The tab's journal lifecycle token is taken before the first await;
 *     a tab closed (and perhaps reopened under the same id) by the time the
 *     journal answers gets no basis remembered or forgotten for it.
 *   - The journal key is the one the request's guards saw: the capture
 *     aborts (`closed`) if a Save As or rename moved it before the edit
 *     starts, and the re-verify if one moved it during the prepare, so the
 *     edit is never prepared or committed under a key the guards did not see
 *     or the tab no longer holds.
 *   - The request's admitted reads (`admittedReads.ts`) are marked consumed
 *     once the edit applied — or may have (`appliedWithError`,
 *     `recoveryRequired`) — so they are given back only by an edit that
 *     changed nothing.
 *   - Read-only is checked again where the edit starts and where it applies:
 *     the request's entry gate (`handleRequest.ts`) ran before the guards and
 *     the prepare awaited, and the user may lock the document meanwhile. A
 *     lock before the capture is refused READ_ONLY with nothing prepared; one
 *     during the prepare aborts it (`applyRefused`, the journal's closed set
 *     has no read-only reason) and is answered READ_ONLY.
 *   - The awaited provenance payload is followed by the same identity and
 *     content check (`recheck`), so the prepare never carries a preimage or
 *     key that changed while it was computed.
 *
 * @coordinates-with services/agentJournal/journaledMutation.ts — the coordinator
 * @coordinates-with services/agentJournal/journalRequest.ts — sends the controlled prepare
 * @coordinates-with services/agentJournal/selectionCertificate.ts — the certificate of `change`
 * @coordinates-with services/agentJournal/review/declaredScript.ts — the certificate of `target` (loaded on first use)
 * @coordinates-with writeTarget.ts — the re-verify
 * @coordinates-with journalV2Error.ts — refusal and abort answers
 * @coordinates-with admittedReads.ts — the reads the edit consumes
 * @module services/mcpBridge/v2/journaledEdit
 */

import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { controlledPrepare, type AbortReason, type CommitExtras } from "@/services/agentJournal/journalClient";
import { runJournaledMutation, type JournaledOutcome } from "@/services/agentJournal/journaledMutation";
import { journalActorFor } from "@/services/agentJournal/journalActor";
import { journalTabLife } from "@/services/agentJournal/documentIdentity";
import { selectionCertificate, type ExactChange, type SelectionCertificate } from "@/services/agentJournal/selectionCertificate";
import { journalWarn } from "@/utils/debug";
import { structuredError } from "./tabGuard";
import { captureWriteTarget, recheckWriteTarget, reverifyWriteTarget } from "./writeTarget";
import type { AdmittedReads } from "./admittedReads";
import { abortedError, appliedWithErrorError, journalRefusalError, recoveryRequiredError } from "./journalV2Error";
import type { V2Error } from "./types";

const READ_ONLY: V2Error = { error: "READ_ONLY", message: "Document is read-only" };
const isReadOnly = (tabId: string) => useDocumentStore.getState().isReadOnly(tabId);

export interface JournaledEdit<T> {
  /** The tab as the request's guards resolved it (`GuardedTab`). */
  tab: { tabId: string; revision: string; filePath: string | null };
  /** The buffer as the store holds it now (flushed): the prepare's preimage. */
  preimage: string;
  /**
   * The edit must still be on the focused tab when the prepare answers (a
   * request that named no tab, or a selection edit): a focus switch aborts it.
   */
  requireFocus: boolean;
  /** The tool name recorded on the revision (`document.transform`, …). */
  tool: string;
  /**
   * The exact change `apply` will dispatch, in `preimage` offsets: sent as a
   * certificate. Omitted when the edit cannot name one (a barrier).
   */
  change?: ExactChange;
  /**
   * The whole text `apply` will produce from `preimage`: its declared script
   * is sent as a certificate. Omitted when the edit is not a whole-text write.
   */
  target?: string;
  /**
   * After a successful apply: the certificate of what it applied, `preimage`
   * → `postimage`, sent with the commit. Omitted, or answering `null`, the
   * commit is a barrier.
   */
  certify?: (preimage: string, postimage: string) => Promise<SelectionCertificate | null>;
  context: McpWriteContext;
  /** The reads the request was admitted with: marked consumed once the edit applied. */
  reads: AdmittedReads;
  /**
   * Apply now, synchronously. `postimage` is the text the store holds
   * afterwards, read back before any await.
   */
  apply: () => { postimage: string; value: T } | { refused: AbortReason };
  /**
   * After an apply that threw: bring the store into agreement with the
   * editor, synchronously. Omitted when the store is the document's truth.
   */
  recover?: () => void;
  /** The comments the write says it addresses (`writeAddresses.ts`); omitted when none. */
  addresses?: readonly string[];
}

/** The buffer the store holds for `tabId`; throws once the tab is gone. */
function storeText(tabId: string): string {
  const text = useDocumentStore.getState().documents[tabId]?.content;
  if (text === undefined) throw new Error(`tab ${tabId} has no document`);
  return text;
}

/** The certificate of `edit.change` or `edit.target` against the prepare's `preimage`; `null` without one. */
async function certificateFor(edit: JournaledEdit<unknown>, preimage: string): Promise<SelectionCertificate | null> {
  if (preimage !== edit.preimage) return null;
  try {
    if (edit.change) return await selectionCertificate(preimage, edit.change);
    if (edit.target !== undefined) {
      // Loaded on first use: the diff engine (diff-match-patch) is the bulk of
      // the module, and only a whole-text write needs it — not app launch.
      const { declaredScriptCertificate } = await import("@/services/agentJournal/review/declaredScript");
      return await declaredScriptCertificate(preimage, edit.target);
    }
    return null;
  } catch (error) {
    journalWarn(`${edit.tool}: no certificate for its change; recording a barrier:`, error);
    return null;
  }
}

/** The commit's extras: `edit.certify`'s certificate, or none when it has none or fails (logged, never thrown). */
async function commitCertificate(edit: JournaledEdit<unknown>, preimage: string, postimage: string): Promise<CommitExtras> {
  try {
    const certificate = await edit.certify?.(preimage, postimage);
    return certificate ? { certificate } : {};
  } catch (error) {
    journalWarn(`${edit.tool}: no certificate for its applied edit; recording a barrier:`, error);
    return {};
  }
}

/**
 * The applied edit, with the tab's lifecycle token taken when it started
 * (`life`: a caller that awaits again checks it before acting on the tab), or
 * `null` when the request was refused or aborted (already answered).
 */
export async function runJournaledEdit<T>(
  id: string,
  edit: JournaledEdit<T>,
): Promise<{ value: T; durable: boolean; life: number } | null> {
  const { tab } = edit;
  // Taken before the first await: a tab closed and reopened under the same id
  // while the journal answers is another tab, whose basis this edit must not
  // remember or forget into.
  const life = journalTabLife(tab.tabId);
  if (isReadOnly(tab.tabId)) {
    await structuredError(id, READ_ONLY);
    return null;
  }
  const target = captureWriteTarget(tab, edit.requireFocus, edit.preimage);
  if ("refused" in target) {
    await structuredError(id, abortedError(target.refused));
    return null;
  }
  let lockedDuringPrepare = false;
  return runJournaledMutation({
    tabId: tab.tabId,
    life,
    // The key the guards saw, still held by the tab (the capture refused a Save As in between).
    docKey: target.docKey,
    preimage: edit.preimage,
    retryHint: "re-read and retry",
    recheck: () => recheckWriteTarget(target),
    prepare: async (baseline) => {
      const certificate = await certificateFor(edit, baseline.preimage);
      return controlledPrepare({
        docKey: baseline.docKey,
        parent: baseline.parent,
        preimage: baseline.preimage,
        actor: journalActorFor(edit.context.attribution),
        tool: edit.tool,
        baselineProvenance: baseline.baselineProvenance,
        baselineTouched: baseline.baselineTouched,
        ...(baseline.observedParent && { observedParent: baseline.observedParent }),
        ...(certificate ? { certificate } : {}),
        ...(baseline.capture && { capture: baseline.capture }),
        ...(edit.addresses && { addresses: edit.addresses }),
      });
    },
    verify: () => reverifyWriteTarget(target),
    apply: () => {
      if (!isReadOnly(tab.tabId)) return edit.apply();
      lockedDuringPrepare = true;
      return { refused: "applyRefused" };
    },
    ...(edit.certify ? { effects: (preimage: string, postimage: string) => commitCertificate(edit, preimage, postimage) } : {}),
    recover: () => {
      edit.recover?.();
      return storeText(tab.tabId);
    },
    outcome: async (outcome: JournaledOutcome<T>) => {
      if (outcome.status !== "refused" && outcome.status !== "aborted") edit.reads.consumed = true;
      switch (outcome.status) {
        case "applied":
          return { value: outcome.value, durable: outcome.durable, life };
        case "refused":
          await structuredError(id, journalRefusalError(outcome.refusal));
          return null;
        case "aborted":
          await structuredError(id, lockedDuringPrepare ? READ_ONLY : abortedError(outcome.reason));
          return null;
        case "recoveryRequired":
          await structuredError(id, recoveryRequiredError(outcome.error));
          return null;
        case "appliedWithError": {
          const current = useRevisionStore.getState().getRevision(tab.tabId);
          await structuredError(id, appliedWithErrorError(outcome.error, outcome.durable, current));
          return null;
        }
      }
    },
  });
}
