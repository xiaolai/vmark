// @vitest-environment node
// A save ticket settles once on every exit: the chain link is released exactly once (freeing the slot and handing the next save a base) and the freeze is invalidated unless the run recorded it. Edge cases: record twice (same answer, one run), cancel then record, record then cancel, a run that throws (released with the fallback base, reported not recorded), a run that leaves no next base, a deadline already passed when the base arrives (released with the parent, never run), a tab with no provenance source
import { describe, it, expect, vi, afterEach } from "vitest";
import type { JournalObservedRef } from "../journalClient";
import type { CaptureResult } from "../saveCapture";
import { ChainedSaveTicket, type ChainLink } from "../saveChain";
import type { ProvenanceFreeze } from "../provenance/session";

const PARENT: JournalObservedRef = { ref: "revision", revision: "r-1" };
const NEXT: JournalObservedRef = { ref: "revision", revision: "r-2" };
const FALLBACK: JournalObservedRef = { ref: "revision", revision: "r-0" };

function setup(run: () => Promise<CaptureResult>, withFreeze = true) {
  const release = vi.fn();
  const link: ChainLink = { base: Promise.resolve(PARENT), release };
  const freeze = withFreeze ? { invalidate: vi.fn() } : null;
  const runSpy = vi.fn(run);
  const ticket = new ChainedSaveTicket(link, freeze as unknown as ProvenanceFreeze | null, runSpy, () => FALLBACK);
  return { ticket, release, freeze, runSpy };
}

const saved: CaptureResult = { outcome: { journaled: "yes", revision: "r-2", reason: null }, next: NEXT };

afterEach(() => vi.useRealTimers());

describe("ChainedSaveTicket", () => {
  it("records once and hands the next save the base it left", async () => {
    const t = setup(async () => saved);
    const first = t.ticket.record();
    expect(t.ticket.record()).toBe(first);
    expect(await first).toEqual(saved.outcome);
    expect(t.runSpy).toHaveBeenCalledOnce();
    expect(t.release).toHaveBeenCalledExactlyOnceWith(NEXT);
    expect(t.freeze?.invalidate).toHaveBeenCalledOnce(); // a no-op on a recorded freeze
  });

  it("hands on the fallback base when the run left none", async () => {
    const t = setup(async () => ({ outcome: { journaled: "no", revision: null, reason: null }, next: undefined }));
    await t.ticket.record();
    expect(t.release).toHaveBeenCalledExactlyOnceWith(FALLBACK);
  });

  it("releases and reports a run that throws, never throwing itself", async () => {
    const t = setup(async () => {
      throw new Error("写入失败");
    });
    const out = await t.ticket.record();
    expect(out.journaled).toBe("no");
    expect(t.release).toHaveBeenCalledExactlyOnceWith(FALLBACK);
    expect(t.freeze?.invalidate).toHaveBeenCalled();
  });

  it("a cancel settles it: the base passes on, a later record answers not recorded", async () => {
    const t = setup(async () => saved);
    t.ticket.cancel();
    t.ticket.cancel();
    expect(await t.ticket.record()).toEqual({ journaled: "no", revision: null, reason: null });
    await Promise.resolve();
    expect(t.runSpy).not.toHaveBeenCalled();
    expect(t.release).toHaveBeenCalledExactlyOnceWith(PARENT);
    expect(t.freeze?.invalidate).toHaveBeenCalledOnce();
  });

  it("a cancel after record is a no-op", async () => {
    const t = setup(async () => saved);
    const out = t.ticket.record();
    t.ticket.cancel();
    expect(await out).toEqual(saved.outcome);
    expect(t.release).toHaveBeenCalledExactlyOnceWith(NEXT);
  });

  it("never runs a save whose deadline passed before its base arrived", async () => {
    vi.useFakeTimers();
    let arrive: (b: JournalObservedRef) => void = () => {};
    const release = vi.fn();
    const link: ChainLink = { base: new Promise((r) => (arrive = r)), release };
    const run = vi.fn(async () => saved);
    const ticket = new ChainedSaveTicket(link, null, run, () => FALLBACK);
    const out = ticket.record();
    await vi.advanceTimersByTimeAsync(60_000);
    arrive(PARENT);
    await vi.runAllTimersAsync();
    expect((await out).journaled).toBe("no");
    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledExactlyOnceWith(PARENT);
  });

  it("holds no freeze for a tab with no provenance source", async () => {
    const t = setup(async () => saved, false);
    expect(await t.ticket.record()).toEqual(saved.outcome);
    t.ticket.cancel();
    expect(t.release).toHaveBeenCalledOnce();
  });
});
