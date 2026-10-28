// @vitest-environment node
// WI-AL1.4 — a save carries the tab's certified provenance: the window frozen at the saved buffer is sent with the save and verifies against the journal's text for the observed parent; a recorded save becomes the next window's basis, a refused, timed-out or cancelled one leaves it uncertifiable; a map the journal refuses is resent once without it; no source still records snapshot-only; every save is bounded by a deadline (timer started before any of the client's own hashing) that reports JOURNAL_TIMEOUT loudly while the chain behind it stays ordered; past the outstanding-save cap a save is reported not recorded without freezing; each tab and file saves under its own window name
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { stubProvenancePayload } from "@/test/provenancePayloadFixture";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import type { CaptureInput, CapturedSave } from "../journalClient";
import { journalBasis, journalObservedBase, rememberJournalBasis, windowNameFor } from "../documentIdentity";
import { JOURNAL_DEADLINE_MS } from "../journalDeadline";
import { verifyPayloadTexts, type ProvenancePayload } from "../provenance/payload";
import { MAX_OUTSTANDING_SAVES, beginJournalSave } from "../saveJournal";
import type { ProvenanceFreeze } from "../provenance/session";
import { registerUnsavedProvenanceSource, resetUnsavedProvenanceSources } from "../unsavedProvenance";

const PATH = "/notes/读书笔记.md";
const KEY = `path:${PATH}`;
const TAB = "tab-1";
const MANUAL = { saveType: "manual" } as const;

afterEach(() => resetUnsavedProvenanceSources());

const captures = (): CaptureInput[] => fake.captureSaveToJournal.mock.calls.map(([i]) => i);

/** A source whose freezes are recorded, each answering `payload` for any basis. */
function source(payload: ProvenancePayload | null = stubProvenancePayload()) {
  const freezes: Array<{ buffer: string; expected: Array<string | null>; settled: string[] }> = [];
  registerUnsavedProvenanceSource(TAB, {
    freeze: (buffer): ProvenanceFreeze => {
      const f = { buffer, expected: [] as Array<string | null>, settled: [] as string[] };
      freezes.push(f);
      return {
        touched: true, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(),
        payload: async (expected) => {
          f.expected.push(expected);
          return payload && { basis: expected ?? "genesis", payload };
        },
        // Terminal, the first settlement wins (`ProvenanceFreeze`): a later one is not recorded.
        recorded: (id) => void (f.settled.length === 0 && f.settled.push(`recorded:${id}`)),
        invalidate: () => void (f.settled.length === 0 && f.settled.push("invalidated")),
        release: () => void (f.settled.length === 0 && f.settled.push("released")),
      };
    },
    fork: () => ({ recorded: () => {}, invalidate: () => {} }),
  });
  return freezes;
}

describe("a save's provenance", () => {
  it("freezes at submission, sends the payload for the observed parent, and records the save's id", async () => {
    const freezes = source();
    const first = await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    const ticket = beginJournalSave(TAB, PATH, "ab", MANUAL);
    expect(freezes.map((f) => f.buffer)).toEqual(["a", "ab"]);
    await ticket.record();
    expect(freezes[0].expected).toEqual([null]);
    expect(freezes[1].expected).toEqual([first.revision]);
    expect(captures()[1].provenance).toEqual(stubProvenancePayload());
    expect(freezes.map((f) => f.settled)).toEqual([[`recorded:${first.revision}`], [expect.stringMatching(/^recorded:rev-save-/)]]);
  });

  it("with no source the save is sent without a map (snapshot-only)", async () => {
    await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    expect(captures()[0].provenance).toBeNull();
  });

  it("with no certified map the save is sent without one and the window is still told the outcome", async () => {
    const freezes = source(null);
    await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    expect(captures()[0].provenance).toBeNull();
    expect(freezes[0].settled).toEqual([expect.stringMatching(/^recorded:/)]);
  });

  it("a map the journal refuses is resent once without it", async () => {
    const freezes = source();
    fake.refuseNextProvenance(1);
    const out = await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    expect(out.journaled).toBe("yes");
    expect(captures().map((c) => c.provenance)).toEqual([stubProvenancePayload(), null]);
    expect(freezes[0].settled).toEqual([`recorded:${out.revision}`]);
  });

  it("the snapshot-only resend keeps the parent the map's basis named", async () => {
    registerUnsavedProvenanceSource(TAB, {
      freeze: (): ProvenanceFreeze => ({
        touched: true, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(),
        // The session knows the window's basis though the tab's identity has none.
        payload: async () => ({ basis: "rev-window", payload: stubProvenancePayload() }),
        recorded: () => {},
        invalidate: () => {}, release: () => {},
      }),
      fork: () => ({ recorded: () => {}, invalidate: () => {} }),
    });
    fake.refuseNextProvenance(1);
    await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    const parents = captures().map((c) => c.observedParent);
    expect(parents).toEqual([{ ref: "revision", revision: "rev-window" }, { ref: "revision", revision: "rev-window" }]);
    expect(captures()[1].provenance).toBeNull();
  });

  it("a refused save and a cancelled save leave the next window uncertifiable", async () => {
    const freezes = source();
    fake.refuseNextCaptures("JOURNAL_UNAVAILABLE");
    await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    beginJournalSave(TAB, PATH, "b", MANUAL).cancel();
    await vi.waitFor(() => expect(freezes.map((f) => f.settled)).toEqual([["invalidated"], ["invalidated"]]));
  });

  it("an append that only queued is not a basis to certify against", async () => {
    const freezes = source();
    fake.failNextCaptures(1);
    await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    expect(freezes[0].settled).toEqual(["invalidated"]);
  });

  it("a source that throws is logged and the save is still recorded, snapshot-only", async () => {
    registerUnsavedProvenanceSource(TAB, {
      freeze: () => {
        throw new Error("collector broke");
      },
      fork: () => ({ recorded: () => {}, invalidate: () => {} }),
    });
    const out = await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    expect(out.journaled).toBe("yes");
    expect(captures()[0].provenance).toBeNull();
  });

  it("a real window's map verifies against the journal's texts", async () => {
    const { ProvenanceSession } = await import("../provenance/session");
    const { agentJournalEpochFake: epochs } = await import("@/test/agentJournalEpochFake");
    const session = new ProvenanceSession("", { arm: () => epochs.armEpoch(KEY), close: (e) => epochs.closeEpoch(KEY, e) }, { warn: vi.fn() });
    registerUnsavedProvenanceSource(TAB, { freeze: (b) => session.freeze(b), fork: (t) => session.fork(t) });
    const c = session.attach({}, null, "source");
    c.edit("", [{ fromA: 0, toA: 0, fromB: 0, toB: 3 }], "中文😀");
    await beginJournalSave(TAB, PATH, "中文😀", MANUAL).record();
    await expect(verifyPayloadTexts(captures()[0].provenance, "", "中文😀")).resolves.toBeDefined();
    c.edit("中文😀", [{ fromA: 4, toA: 4, fromB: 4, toB: 5 }], "中文😀!");
    const out = await beginJournalSave(TAB, PATH, "中文😀!", MANUAL).record();
    expect(captures()[1].provenance).toMatchObject({ basis: captures()[1].observedParent && (captures()[1].observedParent as { revision: string }).revision });
    await expect(verifyPayloadTexts(captures()[1].provenance, "中文😀", "中文😀!")).resolves.toBeDefined();
    expect(out.journaled).toBe("yes");
  });
});

describe("the save deadline", () => {
  beforeEach(() => vi.useFakeTimers());

  it("reports a capture that never answers as JOURNAL_TIMEOUT, and invalidates the window", async () => {
    const freezes = source();
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise(() => {}));
    const record = beginJournalSave(TAB, PATH, "a", MANUAL).record();
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await expect(record).resolves.toEqual({ journaled: "no", revision: null, reason: "JOURNAL_TIMEOUT" });
    expect(freezes[0].settled).toEqual(["invalidated"]);
  });

  it("a map still hashing when the deadline passes: the save is never sent", async () => {
    let hashed: (v: null) => void = () => {};
    registerUnsavedProvenanceSource(TAB, {
      freeze: (): ProvenanceFreeze => ({ touched: true, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(), payload: () => new Promise((r) => (hashed = r)), recorded: () => {}, invalidate: () => {}, release: () => {} }),
      fork: () => ({ recorded: () => {}, invalidate: () => {} }),
    });
    const record = beginJournalSave(TAB, PATH, "a", MANUAL).record();
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await expect(record).resolves.toMatchObject({ reason: "JOURNAL_TIMEOUT" });
    hashed(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.captureSaveToJournal).not.toHaveBeenCalled();
  });

  it("a save queued behind a hung one times out too, and is never sent once abandoned", async () => {
    source();
    let answer: (v: CapturedSave) => void = () => {};
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const first = beginJournalSave(TAB, PATH, "a", MANUAL).record();
    const second = beginJournalSave(TAB, PATH, "ab", MANUAL).record();
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await expect(second).resolves.toMatchObject({ reason: "JOURNAL_TIMEOUT" });
    await expect(first).resolves.toMatchObject({ reason: "JOURNAL_TIMEOUT" });
    answer({ doc: KEY, journaled: "yes", observation: "obs-late", revision: "rev-late" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.captureSaveToJournal).toHaveBeenCalledTimes(1);
    // The chain moved on: a later save is sent normally.
    vi.useRealTimers();
    await expect(beginJournalSave(TAB, PATH, "abc", MANUAL).record()).resolves.toMatchObject({ journaled: "yes" });
  });
});

describe("a capture answering after its deadline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("records nothing: the window stays invalidated and a newer basis is not overwritten", async () => {
    const freezes = source();
    let answer: (v: CapturedSave) => void = () => {};
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const record = beginJournalSave(TAB, PATH, "a", MANUAL).record();
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await expect(record).resolves.toMatchObject({ reason: "JOURNAL_TIMEOUT" });
    rememberJournalBasis(TAB, KEY, "rev-newer");
    answer({ doc: KEY, journaled: "yes", observation: "obs-late", revision: "rev-late" });
    await vi.advanceTimersByTimeAsync(0);
    // A freeze settles first-wins, so a repeated invalidate is a no-op; it must never be recorded.
    expect(new Set(freezes[0].settled)).toEqual(new Set(["invalidated"]));
    expect(journalBasis(TAB, KEY)).toBe("rev-newer");
    expect(journalObservedBase(TAB, KEY)).toEqual({ ref: "revision", revision: "rev-newer" });
  });

  it("an answer landing past the wall-clock deadline, before the timer fired, commits nothing", async () => {
    source();
    rememberJournalBasis(TAB, KEY, "rev-old");
    let answer: (v: CapturedSave) => void = () => {};
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const record = beginJournalSave(TAB, PATH, "a", MANUAL).record();
    await vi.advanceTimersByTimeAsync(0);
    const stalled = vi.spyOn(performance, "now").mockReturnValue(performance.now() + JOURNAL_DEADLINE_MS + 1);
    try {
      answer({ doc: KEY, journaled: "yes", observation: "obs-late", revision: "rev-late" });
      await expect(record).resolves.toMatchObject({ journaled: "no", reason: "JOURNAL_TIMEOUT" });
      expect(journalBasis(TAB, KEY)).toBe("rev-old");
    } finally {
      stalled.mockRestore();
    }
  });

  it("a late pending observation does not replace the basis either", async () => {
    source();
    let answer: (v: CapturedSave) => void = () => {};
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const record = beginJournalSave(TAB, PATH, "a", MANUAL).record();
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await record;
    rememberJournalBasis(TAB, KEY, "rev-newer");
    answer({ doc: KEY, journaled: "pending", observation: "obs-late", revision: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(journalObservedBase(TAB, KEY)).toEqual({ ref: "revision", revision: "rev-newer" });
  });

  it("a late refusal does not forget a newer basis", async () => {
    source();
    let refuse: (e: unknown) => void = () => {};
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise((_r, j) => (refuse = j)));
    const record = beginJournalSave(TAB, PATH, "a", MANUAL).record();
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await record;
    rememberJournalBasis(TAB, KEY, "rev-newer");
    refuse(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(journalBasis(TAB, KEY)).toBe("rev-newer");
  });
});

describe("the outstanding-save budget", () => {
  it("past the cap a save is reported not recorded without freezing or sending", async () => {
    const freezes = source();
    fake.captureSaveToJournal.mockImplementation(() => new Promise(() => {}));
    const tickets = Array.from({ length: MAX_OUTSTANDING_SAVES }, (_, i) => beginJournalSave(TAB, PATH, `t${i}`, MANUAL));
    const over = beginJournalSave(TAB, PATH, "over", MANUAL);
    await expect(over.record()).resolves.toEqual({ journaled: "no", revision: null, reason: "JOURNAL_DEGRADED" });
    expect(freezes).toHaveLength(MAX_OUTSTANDING_SAVES);
    for (const t of tickets) t.cancel();
    fake.captureSaveToJournal.mockReset();
  });
});

describe("window names", () => {
  it("each tab and file saves under its own name", async () => {
    await beginJournalSave(TAB, PATH, "a", MANUAL).record();
    await beginJournalSave("tab-2", PATH, "b", MANUAL).record();
    const [a, b] = captures().map((c) => c.window);
    expect(a).toBe(windowNameFor(TAB, KEY, "main"));
    expect(b).not.toBe(a);
  });
});
