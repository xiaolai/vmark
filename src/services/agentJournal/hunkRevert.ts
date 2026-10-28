/**
 * Hunk revert — undo one reviewed hunk in a tab as a controlled mutation of
 * the agent edit journal, from the review panel: the journal plans the exact
 * patch, the tab applies it only if nothing changed while it was planned.
 *
 * Pipeline: capture the tab as a write target (`writeTarget.ts`) and its
 * provenance session's mark → the journaled-mutation coordinator
 * (`journaledMutation.ts`) with this file's adapters: a freeze that never
 * arms, the revert prepare naming the hunk and the reviewGen the panel
 * rendered, the synchronous re-verify, the patch, the postimage check, and
 * the panel's outcome (a recorded decision included).
 *
 * Key decisions:
 *   - A revert never arms an editing epoch: it freezes the tab's provenance
 *     only on an epoch already armed or arming (`freezeArmed`). Otherwise
 *     its baseline is a snapshot and the journal answers AMBIGUOUS_REVERT
 *     for a hunk it can no longer place.
 *   - The re-verify after the prepare ack is synchronous and the apply runs
 *     in the same task. It aborts when the tab closed or was reopened, or
 *     its session was replaced (a Save As moves the key: `closed`); when
 *     the write target moved (buffer, per-edit revision — so a net-zero
 *     edit counts — composition, selection: `reverifyWriteTarget`); when
 *     the session's mark moved since the capture, which an uncertified
 *     editor remount does with the text unchanged (`edited`); and when the
 *     reply is bound to another hunk or reviewGen (`applyRefused`).
 *   - The patch is the writer's, applied as sent (`from..to` replaced with
 *     `insert`), never recomputed. Its text is hashed after the apply, in
 *     the effects step before the commit: a mismatch is reported through
 *     the applied-with-error path, never as a refusal, since the text is
 *     already in the tab; the journal's own exact-postimage check decides
 *     the commit.
 *
 * @coordinates-with services/agentJournal/journaledMutation.ts — the coordinator
 * @coordinates-with services/agentJournal/revertClient.ts — the revert prepare
 * @coordinates-with services/mcpBridge/v2/writeTarget.ts — the capture and re-verify
 * @module services/agentJournal/hunkRevert
 */

import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { captureWriteTarget, recheckWriteTarget, reverifyWriteTarget } from "@/services/mcpBridge/v2/writeTarget";
import type { AbortReason } from "./journalClient";
import { sha256Hex } from "./journalIpc";
import type { JournalRefusal } from "./journalRefusal";
import { runJournaledMutation, type JournaledOutcome } from "./journaledMutation";
import { isJournalTabLive, journalTabLife } from "./documentIdentity";
import { provenanceSessionFor } from "./provenanceSessions";
import { revertPrepare, type PreparedRevertReply } from "./revertClient";
import type { RevertDecided } from "./revertReplies";

/** The hunk the panel showed: its id and the `reviewGen` it rendered. */
export interface RevertTarget {
  hunkId: string;
  reviewGen: string;
}

export type HunkRevertOutcome =
  | { status: "refused"; refusal: JournalRefusal }
  | { status: "aborted"; reason: AbortReason }
  | { status: "applied"; durable: boolean }
  /** The patch was applied and its text committed, but the apply threw or its text is not the planned postimage. */
  | { status: "appliedWithError"; error: unknown; durable: boolean }
  /** The apply threw and the tab could not be read back; the journal keeps the revert open. */
  | { status: "recoveryRequired"; error: unknown }
  /** The journal recorded a review decision instead; nothing was applied. */
  | { status: "decided"; decision: RevertDecided };

const contentOf = (tabId: string): string | undefined => useDocumentStore.getState().documents[tabId]?.content;

/** Revert `hunk` in the tab `tabId` through the journal. */
export async function revertHunk(tabId: string, hunk: RevertTarget): Promise<HunkRevertOutcome> {
  const doc = useDocumentStore.getState().documents[tabId];
  if (!doc) return { status: "aborted", reason: "closed" };
  const life = journalTabLife(tabId);
  const revision = useRevisionStore.getState().getRevision(tabId);
  const target = captureWriteTarget({ tabId, revision, filePath: doc.filePath }, false, doc.content);
  if ("refused" in target) return { status: "aborted", reason: target.refused };
  const session = provenanceSessionFor(tabId);
  const mark = session?.mark ?? null;
  const preimage = target.content;
  let postimageHash = "";
  return runJournaledMutation<null, PreparedRevertReply, HunkRevertOutcome, RevertDecided>({
    tabId,
    life,
    docKey: target.docKey,
    preimage,
    retryHint: "re-read the review and retry",
    freeze: (buffer) => session?.freezeArmed(buffer) ?? null,
    recheck: () => recheckWriteTarget(target),
    prepare: (baseline) => revertPrepare({ ...baseline, hunkId: hunk.hunkId, expectedReviewGen: hunk.reviewGen }),
    verify: (prepared) => {
      if (!isJournalTabLive(tabId, life) || provenanceSessionFor(tabId) !== session) return "closed";
      const changed = reverifyWriteTarget(target);
      if (changed) return changed;
      if ((session?.mark ?? null) !== mark) return "edited";
      return prepared.hunk === hunk.hunkId && prepared.reviewGen === hunk.reviewGen ? null : "applyRefused";
    },
    apply: ({ from, to, insert, postimageHash: planned }) => {
      if (to > preimage.length) return { refused: "applyRefused" };
      postimageHash = planned;
      const text = preimage.slice(0, from) + insert + preimage.slice(to);
      useDocumentStore.getState().setEditorContent(tabId, text);
      return { postimage: contentOf(tabId) ?? text, value: null };
    },
    recover: () => {
      const now = contentOf(tabId);
      if (now === undefined || !isJournalTabLive(tabId, life)) throw new Error("the tab closed during the revert");
      return now;
    },
    effects: async (_preimage, postimage) => {
      if (`sha256-${await sha256Hex(postimage)}` !== postimageHash) throw new Error("the applied text is not the revert's planned postimage");
      return {};
    },
    outcome: (outcome: JournaledOutcome<null>): HunkRevertOutcome => {
      switch (outcome.status) {
        case "applied":
          return { status: "applied", durable: outcome.durable };
        default:
          return outcome;
      }
    },
    decided: (decision) => ({ status: "decided", decision }),
  });
}
