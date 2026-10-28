// @vitest-environment node
// WI-AL1.3, WI-AL1.4 — the explicit point where a tab's provenance source hands the journal its unsaved edits: with no source registered there is nothing to freeze or fork (the journal then records a snapshotOnly barrier, fail closed); a registered source is asked for exactly the buffer, per tab; a source that throws is not swallowed; a stale disposer never removes a newer source
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  forkUnsavedProvenance,
  freezeUnsavedProvenance,
  registerUnsavedProvenanceSource,
  resetUnsavedProvenanceSources,
  type UnsavedProvenanceSource,
} from "../unsavedProvenance";
import type { ProvenanceFork, ProvenanceFreeze } from "../provenance/session";

const FREEZE: ProvenanceFreeze = { touched: true, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(), payload: async () => null, recorded: () => {}, invalidate: () => {}, release: () => {} };
const FORK: ProvenanceFork = { recorded: () => {}, invalidate: () => {} };

function source() {
  return { freeze: vi.fn((_buffer: string) => FREEZE), fork: vi.fn((_text: string) => FORK) } satisfies UnsavedProvenanceSource;
}

beforeEach(() => resetUnsavedProvenanceSources());

describe("freeze and fork", () => {
  it("are null for a tab with no source: the journal records a snapshot barrier", () => {
    expect(freezeUnsavedProvenance("t1", "typed")).toBeNull();
    expect(forkUnsavedProvenance("t1", "typed")).toBeNull();
  });

  it("ask the registered source with the exact text, CJK, emoji and empty included", () => {
    const s = source();
    registerUnsavedProvenanceSource("t1", s);
    expect(freezeUnsavedProvenance("t1", "日本語 🙂")).toBe(FREEZE);
    expect(freezeUnsavedProvenance("t1", "")).toBe(FREEZE);
    expect(forkUnsavedProvenance("t1", "applied")).toBe(FORK);
    expect(s.freeze.mock.calls).toEqual([["日本語 🙂"], [""]]);
    expect(s.fork).toHaveBeenCalledWith("applied");
  });

  it("keep tabs apart", () => {
    const a = source();
    registerUnsavedProvenanceSource("a", a);
    expect(freezeUnsavedProvenance("b", "x")).toBeNull();
    expect(a.freeze).not.toHaveBeenCalled();
  });

  it("do not swallow a source that throws: the write is refused, not guessed", () => {
    registerUnsavedProvenanceSource("t1", {
      freeze: () => {
        throw new Error("collector broke");
      },
      fork: () => FORK,
    });
    expect(() => freezeUnsavedProvenance("t1", "x")).toThrow("collector broke");
  });
});

describe("registration", () => {
  it("unregistering restores the null answer", () => {
    const off = registerUnsavedProvenanceSource("t1", source());
    off();
    expect(freezeUnsavedProvenance("t1", "x")).toBeNull();
  });

  it("a stale disposer does not remove a newer source", () => {
    const off = registerUnsavedProvenanceSource("t1", source());
    const newer = source();
    registerUnsavedProvenanceSource("t1", newer);
    off();
    off();
    expect(freezeUnsavedProvenance("t1", "x")).toBe(FREEZE);
    expect(newer.freeze).toHaveBeenCalledTimes(1);
  });
});
