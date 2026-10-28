// @vitest-environment node
// WI-AL2.2a — every freeze a save takes is settled on every exit, so the save never holds its session's send turn: after any outcome of a save (recorded, refused, cancelled, timed out, or found past its deadline when its base resolves) a later freeze of the same session can send at once
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { JOURNAL_DEADLINE_MS } from "../journalDeadline";
import { ProvenanceSession } from "../provenance/session";
import { beginJournalSave, type JournalSaveTicket } from "../saveJournal";
import { registerUnsavedProvenanceSource, resetUnsavedProvenanceSources } from "../unsavedProvenance";

const PATH = "/notes/读书笔记.md";
const TAB = "tab-1";
const MANUAL = { saveType: "manual" } as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetUnsavedProvenanceSources();
});

function session(): ProvenanceSession {
  const s = new ProvenanceSession("", { arm: () => Promise.reject(new Error("unarmed")), close: async () => {} }, { warn: vi.fn(), view: "main/t-1" });
  registerUnsavedProvenanceSource(TAB, s);
  return s;
}

/** A later freeze of `s` gets its send turn without waiting on anything else. */
async function laterFreezeSends(s: ProvenanceSession): Promise<void> {
  const send = vi.fn(async () => {});
  void s.freeze("later").inTurn(send);
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledOnce();
}

/** Each way a submitted save can end; `end` drives the ticket to that end. */
const OUTCOMES: Array<[string, (t: JournalSaveTicket) => Promise<unknown>]> = [
  ["recorded", (t) => t.record()],
  ["refused", (t) => {
    fake.captureSaveToJournal.mockImplementationOnce(() => Promise.reject(new Error("refused")));
    return t.record();
  }],
  ["cancelled", async (t) => t.cancel()],
  ["cancelled after it was recorded", async (t) => {
    await t.record();
    t.cancel();
  }],
  ["timed out on a send that never answers", async (t) => {
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise(() => {}));
    const out = t.record();
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS + 1);
    return out;
  }],
  ["past its deadline when its base resolved, though its timer was not", async (t) => {
    // record() takes its deadline at 0 and the timer starts at 10; the base
    // resolves at MS + 5: past the first, not the second.
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(10).mockReturnValue(JOURNAL_DEADLINE_MS + 5);
    const out = await t.record();
    vi.restoreAllMocks();
    return out;
  }],
];

describe("a save's freeze is settled on every exit", () => {
  it.each(OUTCOMES)("a later freeze of the session can send after a save %s", async (_name, end) => {
    const s = session();
    await end(beginJournalSave(TAB, PATH, "a", MANUAL));
    await laterFreezeSends(s);
  });

  it("a save past its deadline when its base resolves sends nothing and reports the timeout", async () => {
    session();
    const t = beginJournalSave(TAB, PATH, "a", MANUAL);
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(10).mockReturnValue(JOURNAL_DEADLINE_MS + 5);
    expect(await t.record()).toEqual({ journaled: "no", revision: null, reason: "JOURNAL_TIMEOUT" });
    expect(fake.captureSaveToJournal).not.toHaveBeenCalled();
  });
});
