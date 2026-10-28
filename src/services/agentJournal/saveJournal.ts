/**
 * Save journal — record a finished disk save in the agent edit journal as
 * an observation, and report how far it got (`journaled`).
 *
 * Pipeline: `beginJournalSave` at submission freezes the observed base (the
 * tab's basis revision, its own save still pending, or the base an earlier
 * outstanding save leaves) → the disk write → `record()` sends
 * `agent_journal_capture` → keep the base the journal now holds for the
 * tab's next write and save. A save that wrote nothing is `cancel()`led.
 *
 * Key decisions:
 *   - The base is frozen at submission, not read after the disk write: an
 *     agent commit that lands while the file is being written is not in the
 *     saved text, so naming it as the parent would record the save as
 *     reverting that commit. A save submitted behind an outstanding one
 *     chains onto the base that one leaves (submission order is the order
 *     the texts were built in). If an agent commit lands between the two
 *     submissions, the later save still names the earlier save's base and
 *     the writer records it as concurrent: an overstatement of concurrency,
 *     never a false claim of having seen a revision.
 *   - `author` is who wrote the text, `initiator` who asked for the save.
 *     The author is the human, except for `document.write`'s own save,
 *     whose text the agent wrote. A `workspace.save` by an agent may
 *     persist human edits, so its author stays the human.
 *   - Only `document.write` claims a revision (`claimsRevision`): its
 *     buffer is exactly the text it just committed. The writer elides the
 *     save only when that revision is still the settled head holding the
 *     same text; equal text alone never elides, so a person saving text
 *     equal to the head is still recorded as their save.
 *   - Never throws and never fails the save: the file is already on disk.
 *     A refused or unavailable journal answers `journaled: "no"` with the
 *     refusal code; a failed append is `"no"` too, queued for the drainer.
 *   - The saved editor text is captured, not the file's bytes: the journal
 *     holds editor-domain text (LF, BOM-free) for every revision.
 *   - The tab's provenance window is frozen at submission with the saved
 *     buffer; the save carries its certified map for the observed parent
 *     (`provenance`), and the window learns the save's id when it is
 *     recorded. Refused, queued, cancelled or timed-out saves invalidate
 *     it, so the next window is never certified against an unknown record.
 *     No source, or no map: a `snapshotOnly` barrier. A map the journal
 *     refuses (`field: provenance`) is resent once without it.
 *   - Every save is bounded by `JOURNAL_DEADLINE_MS`, started before any of
 *     the client's own work (the hashing of the map included): past it the
 *     save reports `JOURNAL_TIMEOUT` loudly. The chain behind it is
 *     released only when the work really ends, so order is kept; a save
 *     whose deadline passed before it was sent is never sent, and one
 *     answered after it commits nothing (`saveCapture.ts`).
 *   - At most `MAX_OUTSTANDING_SAVES` per tab and file, and none for a new
 *     entry once saves hold the whole identity budget (`documentIdentity`):
 *     past it a save is reported not recorded (`JOURNAL_DEGRADED`) without
 *     freezing, so its edits stay in the window the next save certifies.
 *   - Each tab and file saves under its own window name
 *     (`documentIdentity.windowNameFor`), released when the tab closes.
 *   - Save As keeps the tab's journal document (ADR-AL7, `saveMove.ts`):
 *     the base is frozen from the key the journal holds the tab's document
 *     under, and the recorded save binds it to the destination before its
 *     capture is sent, then moves the tab's basis there. A cancelled Save
 *     As binds nothing. A failed bind fails the save's record closed
 *     (`journaled: "no"` with the refusal, no capture, window invalidated);
 *     the file is on disk, and the next save retries the bind from the
 *     original source.
 *   - A save commits its result to the tab's basis only if no controlled
 *     edit changed the basis meanwhile; the save behind it in the chain
 *     is handed that result directly (`saveCapture.ts`).
 *
 * @coordinates-with src-tauri/src/agent_journal/capture.rs — the writer side
 * @coordinates-with services/persistence/saveToPath.ts — the caller
 * @coordinates-with services/agentJournal/saveCapture.ts — the capture stage
 * @coordinates-with services/agentJournal/saveMove.ts — the Save As move
 * @coordinates-with services/agentJournal/saveChain.ts — the chain link and the ticket
 * @module services/agentJournal/saveJournal
 */

import type { SaveOrigin } from "@/services/persistence/saveOutcome";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { journalWarn } from "@/utils/debug";
import type { CaptureInput, JournalObservedRef, JournalSaveInitiator } from "./journalClient";
import { journalActorFor } from "./journalActor";
import type { JournalCode } from "./journalRefusal";
import { capture, expired, type CaptureResult, type SaveClaim, type SaveJournalOutcome } from "./saveCapture";
import { ChainedSaveTicket, linkChain, type JournalSaveTicket } from "./saveChain";
import { movedFrom, moveForSave } from "./saveMove";
import {
  admitOutstandingSave,
  basisStamp,
  docKeyFor,
  finishOutstandingSave,
  journalObservedBase,
  journalTabLife,
  windowNameFor,
} from "./documentIdentity";
import type { ProvenanceFreeze } from "./provenance/session";
import { freezeUnsavedProvenance } from "./unsavedProvenance";
import { reportingSaveTicket } from "./recordingReport";
import { beginRecordingSubmission } from "@/stores/journalRecordingStore";

export type { JournalSaveTicket } from "./saveChain";

/** Most saves of one tab and file in flight at once. */
export const MAX_OUTSTANDING_SAVES = 8;

/** Who asked for a save, as the journal records it. */
export function saveInitiatorFor(origin: SaveOrigin): JournalSaveInitiator {
  switch (origin.saveType) {
    case "manual":
      return { type: "human" };
    case "auto":
      return { type: "system", reason: "autosave" };
    case "mcp":
      return journalActorFor(origin.actor);
  }
}

/** The text's author and claimed revision; see the header. */
function authorship(origin: SaveOrigin, base: JournalObservedRef | null): Pick<CaptureInput, "author" | "claimsRevision"> {
  if (origin.saveType !== "mcp" || origin.toolName !== "document.write") {
    return { author: null, claimsRevision: null };
  }
  return {
    author: journalActorFor(origin.actor),
    claimsRevision: base?.ref === "revision" ? base.revision : null,
  };
}

function freezeFor(tabId: string, content: string): ProvenanceFreeze | null {
  try {
    return freezeUnsavedProvenance(tabId, content);
  } catch (error) {
    journalWarn("provenance source failed; the save is recorded snapshot-only:", error);
    return null;
  }
}

const refusedTicket = (reason: JournalCode): JournalSaveTicket => {
  const outcome = Promise.resolve<SaveJournalOutcome>({ journaled: "no", revision: null, reason });
  return { record: () => outcome, cancel: () => {} };
};

/**
 * Submit tab `tabId`'s save of `content` (editor text) to `path`; freezes its
 * base and window now. Its outcome is reported to the recording store.
 */
export function beginJournalSave(
  tabId: string,
  path: string,
  content: string,
  origin: SaveOrigin,
): JournalSaveTicket {
  const windowLabel = getCurrentWindowLabel();
  const docKey = docKeyFor({ tabId, filePath: path }, windowLabel);
  const seq = beginRecordingSubmission();
  return reportingSaveTicket(docKey, seq, submitSave(tabId, docKey, windowLabel, content, origin));
}

/** What one admitted save writes, fixed at submission. */
interface SavePlan {
  tabId: string;
  docKey: string;
  /** The key the tab held, when this save moves it (Save As). */
  from: string | null;
  window: string;
  content: string;
  origin: SaveOrigin;
  freeze: ProvenanceFreeze | null;
  /** The tab's basis stamp and lifecycle at submission: the save commits its result only while both stand. */
  claim: SaveClaim;
}

/** Runs a save on its observed base: the Save As move, then the capture, committing only while `live()`. */
async function executeSave(plan: SavePlan, parent: JournalObservedRef | null, live: () => boolean, windowLabel: string): Promise<CaptureResult> {
  const { tabId, docKey, window, content, origin, freeze } = plan;
  const moved = await moveForSave({ tabId, docKey, from: plan.from, life: plan.claim.life }, windowLabel);
  if (!moved.ok) {
    // Fail closed: a capture here would start a second history. The window
    // is invalidated, so the save that recovers is an uncertified barrier.
    freeze?.invalidate();
    journalWarn("save not recorded: the document's journal identity could not be moved here:", moved.refusal.journalCode);
    return { outcome: { journaled: "no", revision: null, reason: moved.refusal.journalCode }, next: parent };
  }
  if (!live()) return { outcome: expired(freeze), next: undefined };
  const input = { docKey, window, observedParent: parent, postimage: content, initiator: saveInitiatorFor(origin), ...authorship(origin, parent) };
  return capture(tabId, docKey, input, freeze, live, plan.claim);
}

function submitSave(
  tabId: string,
  docKey: string,
  windowLabel: string,
  content: string,
  origin: SaveOrigin,
): JournalSaveTicket {
  if (!admitOutstandingSave(tabId, docKey, MAX_OUTSTANDING_SAVES)) {
    journalWarn(`too many saves in flight (at most ${MAX_OUTSTANDING_SAVES} per file, within the identity budget); this save is not recorded in the agent edit journal`);
    return refusedTicket("JOURNAL_DEGRADED");
  }
  const from = movedFrom(tabId, docKey, windowLabel);
  const window = windowNameFor(tabId, docKey, windowLabel);
  if (window === null) {
    finishOutstandingSave(tabId, docKey);
    journalWarn("no journal window name could be minted (no random source); this save is not recorded in the agent edit journal");
    return refusedTicket("JOURNAL_UNAVAILABLE");
  }
  const claim: SaveClaim = { stamp: basisStamp(tabId, from ?? docKey), life: journalTabLife(tabId) };
  const link = linkChain(tabId, docKey, from ?? docKey);
  // Frozen last: from here every exit settles the freeze (`record`'s
  // `finally`, or `cancel`), or it would hold its session's send turn.
  const plan: SavePlan = { tabId, docKey, from, window, content, origin, freeze: freezeFor(tabId, content), claim };
  return new ChainedSaveTicket(
    link,
    plan.freeze,
    (parent, live) => executeSave(plan, parent, live, windowLabel),
    () => journalObservedBase(tabId, docKey),
  );
}
