// @vitest-environment node
// WI-AL2.2e — R31 freeze retention: a released freeze merges its frozen window back in front of the window that followed it, so the next freeze certifies both in order with every sticky break (whole or bounded, and a deferral still pending) kept; the merge happens only while that successor is still the open window (a later freeze or an apply fork fails closed), and the first settlement wins; `freezeArmed` freezes only on an epoch already armed or arming and never arms one, answering `null` otherwise
import { describe, it, expect, vi } from "vitest";
import { ProvenanceSession, type SessionJournal } from "../provenance/session";
import { textHash, verifyPayloadTexts } from "../provenance/payload";
import type { ArmedEpoch } from "../epochClient";

const DOC = "0190d3c4-0000-7000-8000-00000000000d";
const HEAD = "0190d3c4-0000-7000-8000-0000000000a1";

function journal(headText: string) {
  let epoch = 0;
  const j: SessionJournal = {
    arm: vi.fn(async (): Promise<ArmedEpoch> => {
      epoch += 1;
      return { doc: DOC, epoch: String(epoch), head: HEAD, headHash: `sha256-${await textHash(headText)}` };
    }),
    close: vi.fn(async () => undefined),
  };
  return j;
}

function session(text: string) {
  const j = journal(text);
  const s = new ProvenanceSession(text, j, { warn: vi.fn() });
  const v = {};
  return { s, j, c: s.attach(v, s.openView(v), "source") };
}

const ins = (at: number, text: string) => [{ fromA: at, toA: at, fromB: at, toB: at + text.length }];

/** Freeze `buffer`, read its payload on `basis`, and verify it against `pre`. */
async function certified(s: ProvenanceSession, pre: string, buffer: string, basis: string | null = HEAD) {
  const named = await s.freeze(buffer).payload(basis);
  expect(named).not.toBeNull();
  return verifyPayloadTexts(named!.payload, pre, buffer);
}

describe("ProvenanceFreeze.release — the frozen window carries into the next", () => {
  it("merges the released window in front of the edits typed after it, in order", async () => {
    const { s, c } = session("abc");
    c.edit("abc", ins(3, "d"), "abcd");
    const f = s.freeze("abcd");
    c.edit("abcd", ins(4, "e"), "abcde");
    f.release();
    const p = await certified(s, "abc", "abcde");
    expect(p.transactions).toBe(2);
    expect(p.whole).toBeNull();
  });

  it("keeps a whole break taken after the freeze", async () => {
    const { s, c } = session("abc");
    c.edit("abc", ins(3, "d"), "abcd");
    const f = s.freeze("abcd");
    c.gap("source:lost");
    f.release();
    const p = await certified(s, "abc", "abcd");
    expect(p.whole).toEqual({ reason: "snapshotOnly", origin: "source:lost" });
  });

  it("keeps a bounded break taken before the freeze, and a deferral still pending after it", async () => {
    const { s, c } = session("# A\n\nb");
    c.defer("# A\n\nbX", (base) => (base === "# A\n\nb" ? [{ from: 5, to: 6, insert: 2 }] : null));
    const f = s.freeze("# A\n\nbX");
    c.defer("Z# A\n\nbX", (base) => (base === "# A\n\nbX" ? [{ from: 0, to: 0, insert: 1 }] : null));
    f.release();
    const p = await certified(s, "# A\n\nb", "Z# A\n\nbX");
    expect(p.whole).toBeNull();
    expect(p.bounded).toHaveLength(2);
  });

  it("is terminal: a later recorded() changes nothing and the frozen payload is gone", async () => {
    const { s, c } = session("abc");
    c.edit("abc", ins(3, "d"), "abcd");
    const f = s.freeze("abcd");
    f.release();
    f.recorded("obs-late");
    expect(await f.payload(HEAD)).toBeNull();
    // The merged window still starts on HEAD: the late recorded() named nothing.
    await certified(s, "abc", "abcd");
  });

  it("fails closed once the window after it was frozen again", async () => {
    const { s, c } = session("abc");
    c.edit("abc", ins(3, "d"), "abcd");
    const first = s.freeze("abcd");
    c.edit("abcd", ins(4, "e"), "abcde");
    const second = s.freeze("abcde");
    first.release();
    expect(await second.payload(null)).toBeNull();
  });

  it("leaves an apply fork's window alone", async () => {
    const { s, c } = session("abc");
    const f = s.freeze("abc");
    const fork = s.fork("xyz");
    f.release();
    fork.recorded("rev-2");
    c.edit("xyz", ins(3, "!"), "xyz!");
    await certified(s, "xyz", "xyz!", "rev-2");
  });

  it("does not disturb a recorded freeze's successor", async () => {
    const { s, c } = session("abc");
    c.edit("abc", ins(3, "d"), "abcd");
    const f = s.freeze("abcd");
    c.edit("abcd", ins(4, "e"), "abcde");
    f.recorded("obs-1");
    await certified(s, "abcd", "abcde", "obs-1");
  });
});

describe("ProvenanceSession.freezeArmed — a freeze that never arms an epoch", () => {
  it("answers null and arms nothing when no epoch is armed", async () => {
    const { s, j } = session("abc");
    expect(s.freezeArmed("abc")).toBeNull();
    await s.idle();
    expect(j.arm).not.toHaveBeenCalled();
  });

  it("freezes on an epoch already armed by an edit, and certifies like freeze", async () => {
    const { s, j, c } = session("abc");
    c.edit("abc", ins(3, "d"), "abcd");
    await s.idle();
    const f = s.freezeArmed("abcd");
    expect(f).not.toBeNull();
    const named = await f!.payload(HEAD);
    await expect(verifyPayloadTexts(named!.payload, "abc", "abcd")).resolves.toBeDefined();
    expect(j.arm).toHaveBeenCalledTimes(1);
  });

  it("joins an arm already in flight instead of starting one", async () => {
    const { s, j, c } = session("abc");
    c.edit("abc", ins(3, "d"), "abcd"); // arming, not answered yet
    const f = s.freezeArmed("abcd");
    expect(f).not.toBeNull();
    expect(await f!.payload(HEAD)).not.toBeNull();
    expect(j.arm).toHaveBeenCalledTimes(1);
  });

  it("answers no payload, and arms nothing, when the epoch closed before the payload is read", async () => {
    const { s, j, c } = session("abc");
    c.edit("abc", ins(3, "d"), "abcd");
    await s.idle();
    const f = s.freezeArmed("abcd")!;
    await s.dispose();
    expect(await f.payload(HEAD)).toBeNull();
    expect(j.arm).toHaveBeenCalledTimes(1);
  });
});
