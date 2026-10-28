/**
 * Journal recording store — which documents have edits the agent edit
 * journal did not record ("history not recorded"): a save or agent write it
 * refused, one that timed out, or one it applied but only queued.
 *
 * Key decisions:
 *   - Keyed by journal document key (`documentIdentity.ts`), so a Save As
 *     (a new key) starts clean and two tabs of one file agree.
 *   - Ordered by submission (`beginRecordingSubmission`, taken when the
 *     save or write starts): the newest submission's outcome describes the
 *     document, and an older one settling late never clears or overwrites
 *     it. A success after a failure clears it, because the journal then
 *     holds the document's text again.
 *   - Every reported document keeps its newest submission number (one
 *     small entry per document), so an older failure settling after a newer
 *     success is recognised as older — for as long as the document lives.
 *     `retire` removes a key no tab holds and no save awaits; which keys
 *     those are, and keeping a retired incarnation's late outcome out, is
 *     `recordingReport.ts`'s job, so the store stays bounded by what is open.
 *   - `unbound` is separate: keys a Save As or rename moved a tab to whose
 *     journal identity could not be carried there (`documentBinding.ts`).
 *     Recording there is suspended until a bind lands, so neither a save's
 *     outcome nor retirement clears it; only `documentBinding.ts` does,
 *     which also bounds it.
 *
 * @coordinates-with services/agentJournal/recordingReport.ts — reports and retires entries
 * @coordinates-with services/agentJournal/saveJournal.ts — reports saves
 * @coordinates-with services/agentJournal/controlledMutation.ts — reports agent writes
 * @coordinates-with services/agentJournal/documentBinding.ts — marks and clears unbound keys
 * @coordinates-with components/McpHistory/JournalStatusNotice.tsx — shows it
 * @module stores/journalRecordingStore
 */

import { create } from "zustand";

type RecordingProblemKind = "refused" | "timeout" | "queued";

export interface RecordingProblem {
  kind: RecordingProblemKind;
  /** The journal code, when the journal gave one. */
  code: string | null;
}

interface DocRecording {
  seq: number;
  problem: RecordingProblem | null;
}

interface JournalRecordingState {
  docs: Record<string, DocRecording>;
  /** Keys whose journal identity could not be updated: recording there is suspended. */
  unbound: Record<string, true>;
  /** Record submission `seq`'s outcome for `docKey`; `null` is recorded. */
  report: (docKey: string, seq: number, problem: RecordingProblem | null) => void;
  /** Forget `docKey`'s entry: its document is closed and nothing awaits it. */
  retire: (docKey: string) => void;
  /** Mark or clear `docKey` as unbound. */
  setUnbound: (docKey: string, unbound: boolean) => void;
  reset: () => void;
}

let submissions = 0;

/** Number a save or write as it is submitted. */
export function beginRecordingSubmission(): number {
  submissions += 1;
  return submissions;
}

export const useJournalRecordingStore = create<JournalRecordingState>((set) => ({
  docs: {},
  unbound: {},
  report: (docKey, seq, problem) =>
    set((s) => {
      const known = s.docs[docKey];
      if (known && known.seq > seq) return s;
      return { docs: { ...s.docs, [docKey]: { seq, problem } } };
    }),
  retire: (docKey) =>
    set((s) => {
      if (!(docKey in s.docs)) return s;
      const { [docKey]: _retired, ...docs } = s.docs;
      return { docs };
    }),
  setUnbound: (docKey, unbound) =>
    set((s) => {
      if ((s.unbound[docKey] === true) === unbound) return s;
      if (unbound) return { unbound: { ...s.unbound, [docKey]: true } };
      const { [docKey]: _bound, ...rest } = s.unbound;
      return { unbound: rest };
    }),
  reset: () => set({ docs: {}, unbound: {} }),
}));
