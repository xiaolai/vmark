// @vitest-environment node
// What each controlled outcome settles, on its own: the basis recorded or forgotten, the freeze released, recorded at the outcome's head or left for invalidation, the forks recorded only when the commit landed on the basis, and what the coordinator does next. Edge cases: a refusal that releases and one that does not, a STALE_PARENT refusal, a decision or an abort with no head, an abort that carries a thrown apply, a commit off the basis (not durable), a fork recorded first and then invalidated (the first settlement wins), a tab with no provenance source
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ControlledOutcome } from "../controlledMutation";
import { JournalRefusal } from "../journalRefusal";
import { MutationProvenance, settleControlledOutcome } from "../mutationSettlement";
import { registerUnsavedProvenanceSource, resetUnsavedProvenanceSources } from "../unsavedProvenance";
import type { ProvenanceFreeze } from "../provenance/session";

const TAB = "tab-设置";

function freeze() {
  return {
    touched: false,
    capture: { view: "v", session: "s", seq: "1" },
    inTurn: <T,>(send: () => Promise<T>) => send(),
    payload: vi.fn(async () => null),
    recorded: vi.fn(),
    invalidate: vi.fn(),
    release: vi.fn(),
  };
}

function harness() {
  const forks: Array<{ recorded: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> }> = [];
  registerUnsavedProvenanceSource(TAB, {
    freeze: () => freeze() as unknown as ProvenanceFreeze,
    fork: () => {
      const f = { recorded: vi.fn(), invalidate: vi.fn() };
      forks.push(f);
      return f;
    },
  });
  const fz = freeze();
  const provenance = new MutationProvenance(TAB, fz as unknown as ProvenanceFreeze);
  provenance.fork("改后的文本 🙂");
  const bases: Array<string | null> = [];
  return { fz, forks, provenance, bases, settle: (basis: string | null) => bases.push(basis) };
}

type Row = {
  name: string;
  outcome: ControlledOutcome<string, string>;
  bases: Array<string | null>;
  freeze: "released" | ["recorded", string] | "invalidated";
  forksAt: string | null;
  next: string;
};

const stale = new JournalRefusal("STALE_PARENT", "stale", "h-9");
const busy = new JournalRefusal("JOURNAL_BUSY", "busy");
const boom = new Error("apply threw");

const ROWS: Row[] = [
  { name: "a refusal proven unadmitted releases", outcome: { status: "refused", refusal: busy, disposition: "release" }, bases: [], freeze: "released", forksAt: null, next: "answer" },
  { name: "a refusal of unknown fate invalidates", outcome: { status: "refused", refusal: busy, disposition: "invalidate" }, bases: [], freeze: "invalidated", forksAt: null, next: "answer" },
  { name: "STALE_PARENT forgets the basis", outcome: { status: "refused", refusal: stale, disposition: "invalidate" }, bases: [null], freeze: "invalidated", forksAt: null, next: "answer" },
  { name: "a decision records its head", outcome: { status: "decided", decision: "d", head: "h-2" }, bases: ["h-2"], freeze: ["recorded", "h-2"], forksAt: null, next: "decided" },
  { name: "a decision with no head drops both", outcome: { status: "decided", decision: "d", head: null }, bases: [null], freeze: "invalidated", forksAt: null, next: "decided" },
  { name: "recovery forgets the basis", outcome: { status: "recoveryRequired", error: boom, txn: "t" }, bases: [null], freeze: "invalidated", forksAt: null, next: "answer" },
  { name: "an abort records the baseline", outcome: { status: "aborted", reason: "edited", basis: "h-1" }, bases: ["h-1"], freeze: ["recorded", "h-1"], forksAt: null, next: "answer" },
  { name: "an abort with no basis invalidates", outcome: { status: "aborted", reason: "edited", basis: null }, bases: [null], freeze: "invalidated", forksAt: null, next: "answer" },
  { name: "an abort of a thrown apply rethrows", outcome: { status: "aborted", reason: "edited", basis: "h-1", thrown: { error: boom } }, bases: ["h-1"], freeze: ["recorded", "h-1"], forksAt: null, next: "rethrow" },
  { name: "a durable apply records the forks", outcome: { status: "applied", value: "v", revision: "r-3", durable: true, basis: "r-3" }, bases: ["r-3"], freeze: "invalidated", forksAt: "r-3", next: "answer" },
  { name: "an apply off the basis records no fork", outcome: { status: "applied", value: "v", revision: "r-3", durable: false, basis: "h-1" }, bases: ["h-1"], freeze: "invalidated", forksAt: null, next: "answer" },
  { name: "an applied-with-error records the forks", outcome: { status: "appliedWithError", error: boom, postimage: "x", revision: "r-4", durable: true, basis: "r-4" }, bases: ["r-4"], freeze: "invalidated", forksAt: "r-4", next: "answer" },
];

describe("settleControlledOutcome", () => {
  beforeEach(() => resetUnsavedProvenanceSources());

  it.each(ROWS)("$name", (row) => {
    const h = harness();
    const settled = settleControlledOutcome(row.outcome, h.provenance, h.settle);
    h.provenance.invalidateUnsettled();

    expect(settled.next).toBe(row.next);
    expect(h.bases).toEqual(row.bases);
    if (row.freeze === "released") {
      expect(h.fz.release).toHaveBeenCalledOnce();
      expect(h.fz.invalidate).not.toHaveBeenCalled();
    } else if (row.freeze === "invalidated") {
      expect(h.fz.invalidate).toHaveBeenCalledOnce();
      expect(h.fz.release).not.toHaveBeenCalled();
      expect(h.fz.recorded).not.toHaveBeenCalled();
    } else {
      expect(h.fz.recorded).toHaveBeenCalledExactlyOnceWith(row.freeze[1]);
      expect(h.fz.invalidate).not.toHaveBeenCalled();
    }
    expect(h.forks).toHaveLength(1);
    if (row.forksAt) expect(h.forks[0].recorded).toHaveBeenCalledExactlyOnceWith(row.forksAt);
    else expect(h.forks[0].recorded).not.toHaveBeenCalled();
    // Every fork is invalidated at the end; a recorded one ignores it.
    expect(h.forks[0].invalidate).toHaveBeenCalledOnce();
  });

  it("maps each outcome to the answer its caller sees", () => {
    const h = harness();
    expect(settleControlledOutcome({ status: "applied", value: "v", revision: "r", durable: false, basis: "h" }, h.provenance, h.settle)).toEqual({
      next: "answer",
      outcome: { status: "applied", value: "v", durable: false },
    });
    expect(settleControlledOutcome({ status: "aborted", reason: "edited", basis: "h", thrown: { error: boom } }, h.provenance, h.settle)).toEqual({ next: "rethrow", error: boom });
    expect(settleControlledOutcome({ status: "decided", decision: "d", head: "h" }, h.provenance, h.settle)).toEqual({ next: "decided", decision: "d" });
  });

  it("holds no fork for a tab with no provenance source", () => {
    const provenance = new MutationProvenance("tab-none", null);
    provenance.fork("text");
    expect(() => {
      provenance.recordForks("r");
      provenance.recordFreeze("h");
      provenance.release();
      provenance.invalidateUnsettled();
    }).not.toThrow();
  });
});
