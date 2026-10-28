/**
 * Test helper — an in-memory stand-in for the agent edit journal's IPC
 * client with the writer's semantics: one reservation per document key
 * (JOURNAL_BUSY), the strict parent CAS (STALE_PARENT; `null` is genesis), a degraded queue that
 * refuses controlled writes (JOURNAL_DEGRADED) until drained, lone
 * surrogates refused (INVALID_TEXT), injectable failures for the commit
 * and abort appends, and a refused commit that ends its transaction
 * `uncommitted` (reservation released, head unchanged), and injectable
 * prepare refusals that record nothing. A prepare can be held open so a
 * test can race the editor against it. A save capture is elided only when
 * it claims the settled head and matches its text; otherwise it is linearized at
 * once, `pending` while the document is reserved (landing when the commit
 * or abort releases it), and `no` when its append fails or the queue is
 * not empty (landing when drained). A request carrying a provenance map can
 * be refused `field: "provenance"` (the window then resends without it), and
 * an equal-text prepare records a baseline when it is marked touched.
 *
 * The journal's wire is answered over it by `agentJournalWireFake.ts`, which
 * the global setup installs; drive `agentJournalFake` from the test.
 *
 * @module test/agentJournalFake
 */

import { vi } from "vitest";
import type {
  JournalAbortReason,
  CaptureInput,
  CapturedSave,
  CommitExtras,
  CommittedTxn,
  PrepareInput,
  PreparedTxn,
} from "@/services/agentJournal/journalClient";
import { JournalRefusal, type JournalCode } from "@/services/agentJournal/journalRefusal";
import { isWellFormedText } from "@/services/agentJournal/wellFormedText";

interface DocState {
  head: string | null;
  text: string;
  reservedBy: string | null;
  /** Terminal records waiting to land; non-empty = degraded. */
  queue: Array<() => void>;
  /** Durable saves waiting for the reservation or the queue. */
  pending: Array<{ observation: string; text: string }>;
}

interface TxnState {
  docKey: string;
  revision: string;
  input: PrepareInput;
}

let counter = 0;
const id = (prefix: string) => `${prefix}-${++counter}`;

function createFake() {
  const docs = new Map<string, DocState>();
  const txns = new Map<string, TxnState>();
  const log: Array<{ op: "prepare" | "commit" | "abort" | "capture"; txn: string; detail?: string }> = [];
  /** Observation id → the revision it linearized as. */
  const linearized = new Map<string, string>();
  let captureFailures = 0;
  let captureRefusals: JournalCode[] = [];
  let commitFailures = 0;
  let commitRefusals = 0;
  let abortFailures = 0;
  let prepareRefusals: JournalCode[] = [];
  let provenanceRefusals = 0;
  let unavailable = false;
  let held: Array<() => void> = [];
  let holdNext = 0;

  const doc = (key: string): DocState => {
    let d = docs.get(key);
    if (!d) {
      d = { head: null, text: "", reservedBy: null, queue: [], pending: [] };
      docs.set(key, d);
    }
    return d;
  };

  /** Linearize every pending save of `d` unless something holds it. */
  const linearize = (d: DocState) => {
    if (d.reservedBy || d.queue.length > 0) return;
    for (const p of d.pending.splice(0)) {
      const revision = id("rev-save");
      d.head = revision;
      d.text = p.text;
      linearized.set(p.observation, revision);
    }
  };

  /** Refuse a request whose map is injected as not certifying, recording nothing. */
  const checkProvenance = (map: unknown) => {
    if (map === null || map === undefined || provenanceRefusals === 0) return;
    provenanceRefusals -= 1;
    throw new JournalRefusal("INVALID_REQUEST", "injected provenance refusal", null, "provenance");
  };

  const prepare = async (input: PrepareInput): Promise<PreparedTxn> => {
    if (unavailable) throw new JournalRefusal("JOURNAL_UNAVAILABLE", "journal not running");
    const refused = prepareRefusals.shift();
    if (refused) throw new JournalRefusal(refused, "injected prepare refusal");
    checkProvenance(input.baselineProvenance);
    if (!isWellFormedText(input.preimage)) throw new JournalRefusal("INVALID_TEXT", "lone surrogate");
    const d = doc(input.docKey);
    if (d.queue.length > 0) throw new JournalRefusal("JOURNAL_DEGRADED", "degraded");
    if (d.reservedBy) throw new JournalRefusal("JOURNAL_BUSY", "busy");
    if (input.parent !== d.head) {
      throw new JournalRefusal("STALE_PARENT", "stale parent", d.head);
    }
    let baseline: string | null = null;
    if (input.preimage !== d.text || input.baselineTouched) {
      baseline = id("rev-baseline");
      d.head = baseline;
      d.text = input.preimage;
    }
    const txn = id("txn");
    const revision = id("rev");
    d.reservedBy = txn;
    txns.set(txn, { docKey: input.docKey, revision, input });
    log.push({ op: "prepare", txn });
    if (holdNext > 0) {
      holdNext -= 1;
      await new Promise<void>((resolve) => held.push(resolve));
    }
    return { doc: input.docKey, txn, revision, generation: String(counter), baseline };
  };

  // `_extras`: recorded by the mock for assertions; the fake's writer ignores them.
  const commit = async (txn: string, postimage: string, _extras?: CommitExtras): Promise<CommittedTxn> => {
    const t = txns.get(txn);
    if (!t) throw new JournalRefusal("INVALID_REQUEST", "unknown txn");
    const d = doc(t.docKey);
    const land = () => {
      d.head = t.revision;
      d.text = postimage;
      d.reservedBy = null;
      linearize(d);
    };
    log.push({ op: "commit", txn, detail: postimage });
    if (commitRefusals > 0) {
      commitRefusals -= 1;
      d.reservedBy = null;
      linearize(d);
      throw new JournalRefusal("INVALID_REQUEST", "commit refused; recorded uncommitted");
    }
    if (commitFailures > 0) {
      commitFailures -= 1;
      d.queue.push(land);
      return { doc: t.docKey, revision: t.revision, applied: true, durable: false };
    }
    land();
    return { doc: t.docKey, revision: t.revision, applied: true, durable: true };
  };

  const abort = async (txn: string, reason: JournalAbortReason): Promise<{ durable: boolean }> => {
    const t = txns.get(txn);
    if (!t) throw new JournalRefusal("INVALID_REQUEST", "unknown txn");
    const d = doc(t.docKey);
    log.push({ op: "abort", txn, detail: reason });
    const release = () => {
      d.reservedBy = null;
      linearize(d);
    };
    if (abortFailures > 0) {
      abortFailures -= 1;
      d.queue.push(release);
      return { durable: false };
    }
    release();
    return { durable: true };
  };

  const capture = async (input: CaptureInput): Promise<CapturedSave> => {
    log.push({ op: "capture", txn: "", detail: input.postimage });
    if (unavailable) throw new JournalRefusal("JOURNAL_UNAVAILABLE", "journal not running");
    const refused = captureRefusals.shift();
    if (refused) throw new JournalRefusal(refused, "injected capture refusal");
    checkProvenance(input.provenance);
    if (!isWellFormedText(input.postimage)) throw new JournalRefusal("INVALID_TEXT", "lone surrogate");
    const d = doc(input.docKey);
    // Elided only on a claim the settled head still answers; equal text alone is recorded.
    const settled = d.pending.length === 0 && d.queue.length === 0;
    if (settled && input.claimsRevision !== null && input.claimsRevision === d.head && d.text === input.postimage) {
      return { doc: input.docKey, journaled: "yes", observation: null, revision: d.head };
    }
    const observation = id("obs");
    const save = { observation, text: input.postimage };
    if (captureFailures > 0 || d.queue.length > 0) {
      captureFailures = Math.max(0, captureFailures - 1);
      d.queue.push(() => d.pending.push(save));
      return { doc: input.docKey, journaled: "no", observation, revision: null };
    }
    d.pending.push(save);
    linearize(d);
    const revision = linearized.get(observation) ?? null;
    return { doc: input.docKey, journaled: revision ? "yes" : "pending", observation, revision };
  };

  return {
    prepareControlledWrite: vi.fn(prepare),
    captureSaveToJournal: vi.fn(capture),
    /** The revision a captured save linearized as, once it has. */
    linearizedAs(observation: string): string | null {
      return linearized.get(observation) ?? null;
    },
    /** The next `n` save captures fail to append (`journaled: "no"`, queued). */
    failNextCaptures(n = 1) {
      captureFailures += n;
    },
    /** Refuse the next save captures with these tokens, recording nothing. */
    refuseNextCaptures(...codes: JournalCode[]) {
      captureRefusals.push(...codes);
    },
    commitControlledWrite: vi.fn(commit),
    abortControlledWrite: vi.fn(abort),
    log,
    /** The document state for a key (head, text, reservation, queue). */
    doc,
    /** Hold the next `count` prepares after they are recorded; `release()` lets them answer. */
    holdNextPrepare(count = 1) {
      holdNext += count;
    },
    release() {
      const pending = held;
      held = [];
      for (const resolve of pending) resolve();
    },
    failNextCommits(n = 1) {
      commitFailures += n;
    },
    /** Refuse the next `n` commits; each ends its transaction `uncommitted`. */
    refuseNextCommits(n = 1) {
      commitRefusals += n;
    },
    /** Refuse the next `n` requests that carry a provenance map, as `field: "provenance"`. */
    refuseNextProvenance(n = 1) {
      provenanceRefusals += n;
    },
    /** Refuse the next prepares with these tokens, recording nothing. */
    refuseNextPrepares(...codes: JournalCode[]) {
      prepareRefusals.push(...codes);
    },
    failNextAborts(n = 1) {
      abortFailures += n;
    },
    setUnavailable(value: boolean) {
      unavailable = value;
    },
    /** Land every queued record, as the background drainer would. */
    drain() {
      for (const d of docs.values()) {
        for (const land of d.queue.splice(0)) land();
        linearize(d);
      }
    },
    reset() {
      docs.clear();
      txns.clear();
      log.length = 0;
      commitFailures = 0;
      commitRefusals = 0;
      abortFailures = 0;
      prepareRefusals = [];
      provenanceRefusals = 0;
      linearized.clear();
      captureFailures = 0;
      captureRefusals = [];
      unavailable = false;
      held = [];
      holdNext = 0;
      this.prepareControlledWrite.mockClear();
      this.commitControlledWrite.mockClear();
      this.abortControlledWrite.mockClear();
      this.captureSaveToJournal.mockClear();
    },
  };
}

/** The shared fake; reset it in `beforeEach`. */
export const agentJournalFake = createFake();
