/**
 * Save chain — one admitted save's place in its tab and file's chain of
 * saves, and the ticket that records or cancels it exactly once.
 *
 * Key decisions:
 *   - A save chains on the base the save ahead of it leaves (see
 *     `saveJournal.ts`); its own link is released ONCE, handing the save
 *     behind it the base this one left, and that release also frees its
 *     outstanding-save slot. Every exit releases: the expired check, the
 *     `finally` around the run, and `cancel`.
 *   - The ticket's state — its memoized outcome, the deadline it started at
 *     `record`, and whether the deadline abandoned it — lives on one object,
 *     so `record` and `cancel` see the same settlement: the first one wins
 *     and the other is a no-op.
 *   - The freeze is settled by the run, or invalidated by the `finally` of
 *     `record` or by `cancel`; invalidating a recorded freeze is a no-op.
 *
 * @coordinates-with services/agentJournal/saveJournal.ts — admission and the save's run
 * @coordinates-with services/agentJournal/documentIdentity.ts — the outstanding-save table
 * @module services/agentJournal/saveChain
 */

import { journalWarn } from "@/utils/debug";
import type { JournalObservedRef } from "./journalClient";
import { JOURNAL_DEADLINE_MS, withJournalDeadline } from "./journalDeadline";
import { toJournalRefusal } from "./journalRefusal";
import { expired, type CaptureResult, type SaveJournalOutcome } from "./saveCapture";
import {
  clearOutstandingSaveBase,
  finishOutstandingSave,
  journalObservedBase,
  outstandingSaveBase,
  setOutstandingSaveBase,
} from "./documentIdentity";
import type { ProvenanceFreeze } from "./provenance/session";

/** One submitted save's place in the journal. */
export interface JournalSaveTicket {
  /** Capture the written save. Once: a repeat answers the same. Never throws. */
  record(): Promise<SaveJournalOutcome>;
  /** The save wrote nothing: pass its base on. Idempotent; no-op once recorded. */
  cancel(): void;
}

const NOT_RECORDED: SaveJournalOutcome = { journaled: "no", revision: null, reason: null };

/** This save's link in its tab and file's chain: the base it observed, and the release of the next save. */
export interface ChainLink {
  base: Promise<JournalObservedRef | null>;
  /** Hand `next` to the save behind this one. Once: later calls do nothing. */
  release(next: JournalObservedRef | null): void;
}

export function linkChain(tabId: string, docKey: string, baseKey: string): ChainLink {
  // @edge-case A save moving the tab (or recovering a failed move) chains on
  // the newest save already submitted to its destination first: each save
  // links there, while the base stays on the source until a bind lands.
  const base =
    outstandingSaveBase(tabId, docKey) ?? outstandingSaveBase(tabId, baseKey) ?? Promise.resolve(journalObservedBase(tabId, baseKey));
  let settle: (next: JournalObservedRef | null) => void = () => {};
  const settled = new Promise<JournalObservedRef | null>((resolve) => (settle = resolve));
  setOutstandingSaveBase(tabId, docKey, settled);
  let released = false;
  return {
    base,
    release(next) {
      if (released) return;
      released = true;
      finishOutstandingSave(tabId, docKey);
      clearOutstandingSaveBase(tabId, docKey, settled);
      settle(next);
    },
  };
}

/** Runs the save on its observed base, committing only while `live()`. */
export type SaveRun = (parent: JournalObservedRef | null, live: () => boolean) => Promise<CaptureResult>;

/** The ticket of an admitted save: one link, one freeze, one settlement. */
export class ChainedSaveTicket implements JournalSaveTicket {
  private outcome: Promise<SaveJournalOutcome> | null = null;
  private abandoned = false;
  private deadlineAt = Infinity;

  /** `fallbackNext`: the base to hand on when the run left none (`next: undefined`). */
  constructor(
    private readonly link: ChainLink,
    private readonly freeze: ProvenanceFreeze | null,
    private readonly run: SaveRun,
    private readonly fallbackNext: () => JournalObservedRef | null,
  ) {}

  /** Live until the deadline passes, by the wall clock or the timer, whichever is first. */
  private readonly live = (): boolean => !this.abandoned && performance.now() <= this.deadlineAt;

  private async work(): Promise<SaveJournalOutcome> {
    const parent = await this.link.base;
    if (!this.live()) {
      this.link.release(parent);
      return expired(this.freeze);
    }
    let next: JournalObservedRef | null | undefined;
    try {
      const result = await this.run(parent, this.live);
      next = result.next;
      return result.outcome;
    } finally {
      this.link.release(next === undefined ? this.fallbackNext() : next);
    }
  }

  record = (): Promise<SaveJournalOutcome> => {
    if (this.outcome) return this.outcome;
    this.deadlineAt = performance.now() + JOURNAL_DEADLINE_MS;
    this.outcome = withJournalDeadline("a save capture", () => this.work())
      .catch((error: unknown) => {
        this.abandoned = true;
        const refusal = toJournalRefusal(error);
        journalWarn("save not recorded in the agent edit journal:", refusal.journalCode, refusal.message);
        return { ...expired(this.freeze), reason: refusal.journalCode };
      })
      .finally(() => this.freeze?.invalidate()); // a no-op once recorded: the first settle wins
    return this.outcome;
  };

  cancel = (): void => {
    if (this.outcome) return;
    this.outcome = Promise.resolve(NOT_RECORDED);
    this.freeze?.invalidate();
    void this.link.base.then(this.link.release);
  };
}
