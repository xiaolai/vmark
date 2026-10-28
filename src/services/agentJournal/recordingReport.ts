/**
 * Recording report — turns a save's or an agent write's journal outcome
 * into the recording store's "history not recorded" entry for its document.
 *
 * Key decisions:
 *   - The submission number is taken when the save or write starts, so a
 *     slow outcome never overwrites a newer one (`journalRecordingStore.ts`).
 *   - A save the journal answered `pending` is recorded (an observation
 *     waiting for its revision); `no` with no code was queued for the
 *     drainer; `JOURNAL_TIMEOUT` is a deadline miss; any other code is a
 *     refusal. A cancelled save wrote nothing and reports nothing.
 *   - An agent write is reported only once applied: a `durable: false`
 *     commit is queued, a durable one clears the document. A refused or
 *     aborted write changed nothing, so it reports nothing.
 *   - Entries live as long as their document. A key is LIVE while a tab
 *     holds it (two tabs of one file share it) and OUTSTANDING while a save
 *     to it is submitted and not settled or cancelled (a Save As target is
 *     outstanding before its tab moves there). A key that is neither is
 *     retired: its entry and its incarnation go. That is checked whenever
 *     the set of open keys changes (`startRecordingLifetimes`: close, open,
 *     Save As, rename) and whenever a save releases its key.
 *   - Each submission holds its key's INCARNATION (the lifetime object) and
 *     reports only while that is still the key's: an outcome settling after
 *     the key was retired never recreates its entry, nor touches the
 *     document later reopened under the key. Saves own their incarnation
 *     until they settle, so only agent writes, which own nothing (their
 *     refusals and aborts report nothing and so could never release), can
 *     outlive one. An agent write to a key no tab holds reports nothing.
 *
 * @coordinates-with stores/journalRecordingStore.ts — where reports land
 * @coordinates-with services/agentJournal/saveJournal.ts — saves
 * @coordinates-with services/agentJournal/controlledMutation.ts — agent writes
 * @coordinates-with services/runtimeWiring.ts — starts the lifetime tracking
 * @module services/agentJournal/recordingReport
 */

import {
  beginRecordingSubmission,
  useJournalRecordingStore,
  type RecordingProblem,
} from "@/stores/journalRecordingStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { docKeyFor } from "./documentIdentity";
import type { Journaled } from "./journalClient";

/**
 * The parts of `saveJournal.ts`'s outcome and ticket this module reads,
 * written structurally so the two modules do not import each other.
 */
interface SaveOutcome {
  journaled: Journaled;
  reason: string | null;
}
interface SaveTicket<O extends SaveOutcome> {
  record(): Promise<O>;
  cancel(): void;
}

const QUEUED: RecordingProblem = { kind: "queued", code: null };

/** One incarnation of a document key; compared by identity. */
interface Lifetime {
  /** Saves to the key submitted and not yet settled or cancelled. */
  outstanding: number;
}

/** The current incarnation of every live or outstanding key. */
const lifetimes = new Map<string, Lifetime>();

/** The journal key of every document open in this window's tabs. */
function liveKeys(): Set<string> {
  const windowLabel = getCurrentWindowLabel();
  const docs = useDocumentStore.getState().documents;
  return new Set(Object.entries(docs).map(([tabId, doc]) => docKeyFor({ tabId, filePath: doc.filePath }, windowLabel)));
}

function lifetimeOf(docKey: string): Lifetime {
  const known = lifetimes.get(docKey);
  if (known) return known;
  const fresh: Lifetime = { outstanding: 0 };
  lifetimes.set(docKey, fresh);
  return fresh;
}

/** Retire every key that is neither open in a tab nor awaiting a save. */
function sweep(live: Set<string> = liveKeys()): void {
  const store = useJournalRecordingStore.getState();
  for (const docKey of new Set([...lifetimes.keys(), ...Object.keys(store.docs)])) {
    if (live.has(docKey) || (lifetimes.get(docKey)?.outstanding ?? 0) > 0) continue;
    lifetimes.delete(docKey);
    store.retire(docKey);
  }
}

/** Report `problem` for `docKey` only while `life` is still its incarnation. */
function reportFor(docKey: string, life: Lifetime, seq: number, problem: RecordingProblem | null): void {
  if (lifetimes.get(docKey) === life) useJournalRecordingStore.getState().report(docKey, seq, problem);
}

/** What a save's outcome says about the document's history; `null` is recorded. */
function saveProblem(out: SaveOutcome): RecordingProblem | null {
  if (out.journaled !== "no") return null;
  if (out.reason === null) return QUEUED;
  if (out.reason === "JOURNAL_TIMEOUT") return { kind: "timeout", code: out.reason };
  return { kind: "refused", code: out.reason };
}

/**
 * Wrap a save ticket so its recorded outcome is reported for `docKey`. The
 * save owns `docKey` from now until its outcome is reported, or until it is
 * cancelled before recording.
 */
export function reportingSaveTicket<O extends SaveOutcome>(docKey: string, seq: number, ticket: SaveTicket<O>): SaveTicket<O> {
  const life = lifetimeOf(docKey);
  life.outstanding += 1;
  let recording = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    life.outstanding -= 1;
    sweep();
  };
  return {
    record: () => {
      recording = true;
      return ticket
        .record()
        .then((out) => {
          reportFor(docKey, life, seq, saveProblem(out));
          return out;
        })
        .finally(release);
    },
    cancel: () => {
      ticket.cancel();
      if (!recording) release(); // a recording save releases when it settles
    },
  };
}

/** Number a submission now; report an applied agent write's durability later. */
export function beginWriteReport(docKey: string | undefined): (durable: boolean) => void {
  const seq = beginRecordingSubmission();
  const life = docKey !== undefined && liveKeys().has(docKey) ? lifetimeOf(docKey) : null;
  return (durable) => {
    if (docKey === undefined || life === null) return;
    reportFor(docKey, life, seq, durable ? null : QUEUED);
  };
}

/** Each tab's file, as the document store holds it. */
type OpenFiles = Readonly<Record<string, { readonly filePath: string | null }>>;

/**
 * Same tabs holding the same files: an edit, not an open, close or move, so
 * no key changed. O(tabs), without building, sorting or serialising keys.
 */
export function sameOpenFiles(previous: OpenFiles | null, next: OpenFiles): boolean {
  if (previous === next) return true;
  if (previous === null) return false;
  let tabs = 0;
  for (const tabId in next) {
    tabs++;
    if (!Object.hasOwn(previous, tabId) || previous[tabId].filePath !== next[tabId].filePath) return false;
  }
  // Every tab of `next` is in `previous`, so equal counts mean the same tabs.
  return Object.keys(previous).length === tabs;
}

/**
 * Retire keys as the window's open documents change, and once now. Returns
 * the disposer. Started with the window (`runtimeWiring.ts`). Content edits
 * are skipped by tab and file identity before any key is rebuilt.
 */
export function startRecordingLifetimes(): () => void {
  let previous: OpenFiles | null = null;
  const onChange = () => {
    const docs = useDocumentStore.getState().documents;
    if (sameOpenFiles(previous, docs)) return;
    previous = docs;
    sweep(liveKeys());
  };
  onChange();
  return useDocumentStore.subscribe(onChange);
}

/** Keys with a live incarnation; a test seam for the bound. */
export function trackedRecordingKeys(): number {
  return lifetimes.size;
}

/** Forget every incarnation; a test seam, paired with the store's `reset`. */
export function resetRecordingLifetimes(): void {
  lifetimes.clear();
}

