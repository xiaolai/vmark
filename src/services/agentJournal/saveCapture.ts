/**
 * Save capture — the capture stage of a journaled save: send the saved text
 * with the window's certified map, then commit the result to the provenance
 * window and the tab's journal basis.
 *
 * Key decisions:
 *   - A map the journal refuses (`field: provenance`) is resent once
 *     without it, so the save is still recorded, snapshot-only.
 *   - A save names its freeze's capture id and is sent in that freeze's turn
 *     (`provenance/captureId.ts`): frozen at submission but sent after the
 *     disk write, it still reaches the journal's seq check in seq order.
 *   - Nothing is sent once the save is past its deadline, including after
 *     the map's hashing, the wait for its turn, or before a snapshot-only resend.
 *   - The basis is committed only if no other write (a controlled edit
 *     during the disk write) changed it since submission; the next save in
 *     the chain is handed this one's result directly, not that newer basis.
 *   - The result is committed only while the save is `live()`. Past its
 *     deadline the caller has already reported `JOURNAL_TIMEOUT` and
 *     invalidated the window, so a late answer or a late refusal commits
 *     nothing: it must not overwrite a basis a newer write has set since.
 *     The save behind it still chains on what the late answer recorded
 *     (or on nothing, after a refusal); only a save never sent leaves its
 *     successor the local basis.
 *   - Nothing is committed once the tab has closed (its lifecycle token
 *     ended), so a late answer cannot repopulate a closed or reopened tab.
 *
 * @coordinates-with services/agentJournal/documentBinding.ts — learns the document id each reply names
 * @coordinates-with services/agentJournal/saveJournal.ts — the caller
 * @module services/agentJournal/saveCapture
 */

import { journalWarn } from "@/utils/debug";
import {
  captureSaveToJournal,
  type CaptureInput,
  type CapturedSave,
  type Journaled,
  type JournalObservedRef,
} from "./journalClient";
import { toJournalRefusal, type JournalCode, type JournalRefusal } from "./journalRefusal";
import { noteJournalDocument } from "./documentBinding";
import { commitSaveBasis, isJournalTabLive } from "./documentIdentity";
import type { ProvenanceFreeze } from "./provenance/session";

/** A capture's outcome, and the observed base it leaves the save queued behind it. */
export interface CaptureResult {
  outcome: SaveJournalOutcome;
  /** `undefined` when nothing was sent (past the deadline first): the successor keeps the local basis. */
  next: JournalObservedRef | null | undefined;
}

/** What a save may commit back: the basis stamp and the tab's lifecycle token, both taken at submission. */
export interface SaveClaim {
  stamp: number;
  life: number;
}

/** How far one save got in the journal. */
export interface SaveJournalOutcome {
  journaled: Journaled;
  /** The revision holding the saved text; set exactly when `yes`. */
  revision: string | null;
  /** Why the journal refused the capture, when it did. */
  reason: JournalCode | null;
}

const refName = (base: JournalObservedRef | null) =>
  base === null ? null : base.ref === "revision" ? base.revision : base.observation;

/**
 * Send the capture, bound to its freeze's capture id and in that freeze's
 * turn, with the window's map; a refused map is resent once without it (the
 * refusal recorded no seq). `null`: the deadline passed before a send, so
 * nothing was sent.
 */
async function send(input: Omit<CaptureInput, "provenance">, freeze: ProvenanceFreeze | null, live: () => boolean): Promise<CapturedSave | null> {
  const named = freeze ? await freeze.payload(refName(input.observedParent)) : null;
  const observedParent: JournalObservedRef | null =
    input.observedParent ?? (named && named.basis !== "genesis" ? { ref: "revision", revision: named.basis } : null);
  const bound = { ...input, observedParent, ...(freeze && { capture: freeze.capture }) };
  const sendBoth = async (): Promise<CapturedSave | null> => {
    if (!live()) return null; // hashing the map, or waiting for the turn, can outlast the deadline
    try {
      return await captureSaveToJournal({ ...bound, provenance: named?.payload ?? null });
    } catch (error) {
      const refusal = toJournalRefusal(error);
      if (refusal.field !== "provenance" || named === null) throw refusal;
      journalWarn("save provenance refused; recording the save snapshot-only:", refusal.message);
      if (!live()) return null;
      return captureSaveToJournal({ ...bound, provenance: null });
    }
  };
  return freeze ? freeze.inTurn(sendBoth) : sendBoth();
}

/**
 * What a capture's answer means for the save, decided before anything is
 * settled: nothing sent; answered, but past the deadline; answered in time;
 * refused in time. `next` is the base the save behind this one chains on.
 */
export type CaptureTransition =
  | { kind: "unsent" }
  | { kind: "late"; next: JournalObservedRef | null }
  | { kind: "answered"; out: CapturedSave; next: JournalObservedRef | null }
  | { kind: "refused"; refusal: JournalRefusal };

/** The base a journal answer leaves: its revision, else its pending observation, else none. */
function answeredBase(out: CapturedSave): JournalObservedRef | null {
  if (out.revision !== null) return { ref: "revision", revision: out.revision };
  if (out.observation !== null) return { ref: "pending", observation: out.observation };
  return null;
}

/** Classify a send's answer (`null`: nothing was sent); `live` is read as it arrived. */
export function replyTransition(out: CapturedSave | null, live: boolean): CaptureTransition {
  if (out === null) return { kind: "unsent" };
  // @edge-case A late answer is reported timed out and commits nothing, but
  // the save behind it chains on what it recorded, not on the local basis.
  if (!live) return { kind: "late", next: answeredBase(out) };
  return { kind: "answered", out, next: answeredBase(out) };
}

/** Classify a send that threw; `live` is read as it failed. A late refusal leaves no base. */
export function failureTransition(error: unknown, live: boolean): CaptureTransition {
  if (!live) return { kind: "late", next: null };
  return { kind: "refused", refusal: toJournalRefusal(error) };
}

/** Settle the window and the tab's basis as `t` says; `commit` records the basis (see `capture`). */
function settleCapture(t: CaptureTransition, freeze: ProvenanceFreeze | null, commit: (next: JournalObservedRef | null) => void): CaptureResult {
  switch (t.kind) {
    case "unsent":
      return { outcome: expired(freeze), next: undefined };
    case "late":
      return { outcome: expired(freeze), next: t.next };
    case "answered": {
      const id = t.out.revision ?? t.out.observation;
      if (t.out.journaled !== "no" && id !== null) freeze?.recorded(id);
      else freeze?.invalidate();
      commit(t.next);
      return { outcome: { journaled: t.out.journaled, revision: t.out.revision, reason: null }, next: t.next };
    }
    case "refused":
      freeze?.invalidate();
      commit(null);
      journalWarn("save not recorded in the agent edit journal:", t.refusal.journalCode, t.refusal.message);
      return { outcome: { journaled: "no", revision: null, reason: t.refusal.journalCode }, next: null };
  }
}

/**
 * Capture, then commit the result to the window and the tab's basis only
 * while the save is `live()`: once its deadline has passed the caller has
 * reported it timed out and invalidated the window, so a late answer, or a
 * late refusal, must not overwrite state a newer write has set since. The
 * basis is committed only if no other write changed it since the claim's
 * stamp and the tab has not closed since; the save queued behind this one
 * chains on this one's result either way, late or not.
 */
export async function capture(
  tabId: string,
  docKey: string,
  input: Omit<CaptureInput, "provenance">,
  freeze: ProvenanceFreeze | null,
  live: () => boolean,
  claim: SaveClaim,
): Promise<CaptureResult> {
  const commit = (next: JournalObservedRef | null) => {
    if (isJournalTabLive(tabId, claim.life)) commitSaveBasis(tabId, docKey, claim.stamp, next);
  };
  try {
    const out = await send(input, freeze, live);
    if (out !== null) noteJournalDocument(docKey, out.doc);
    // Settled inside the `try`: a throw while settling an answer is settled as a refusal.
    return settleCapture(replyTransition(out, live()), freeze, commit);
  } catch (error) {
    return settleCapture(failureTransition(error, live()), freeze, commit);
  }
}

/** A save past its deadline commits nothing; its window is left uncertifiable. */
export function expired(freeze: ProvenanceFreeze | null): SaveJournalOutcome {
  freeze?.invalidate();
  return { journaled: "no", revision: null, reason: "JOURNAL_TIMEOUT" };
}
