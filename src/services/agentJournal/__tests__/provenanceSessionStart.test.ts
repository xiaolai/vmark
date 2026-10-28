// @vitest-environment node
// WI-AL1.4 — how a view earns its place in a provenance session: a fresh view (remount, mode switch to a new view) is certified only by the start token the session issued for it, presented once while nothing changed since; a kept-alive view by its own detach certificate; anything else (no certificate, a reused, foreign or stale token) is a whole snapshotOnly break even at equal text. A WYSIWYG deferral materializes as several bounded breaks in current coordinates, or as a whole break of the collector's choosing, and a list that does not tile the two texts fails closed.
import { describe, it, expect, vi } from "vitest";
import { ProvenanceSession, type SessionJournal } from "../provenance/session";
import { textHash, verifyPayloadTexts } from "../provenance/payload";
import type { ArmedEpoch } from "../epochClient";

const DOC = "0190d3c4-0000-7000-8000-00000000000d";
const HEAD = "0190d3c4-0000-7000-8000-0000000000a1";

function session(text: string) {
  const j: SessionJournal = {
    arm: vi.fn(async (): Promise<ArmedEpoch> => ({ doc: DOC, epoch: "1", head: HEAD, headHash: `sha256-${await textHash(text)}` })),
    close: vi.fn(async () => {}),
  };
  return new ProvenanceSession(text, j, { warn: vi.fn() });
}

type Breaks = { whole: { reason: string; origin: string } | null; bounded: { origin: string }[] };
async function breaksOf(s: ProvenanceSession, buffer: string) {
  const f = s.freeze(buffer);
  const named = await f.payload(null);
  expect(named).not.toBeNull();
  f.recorded(named!.basis);
  return { breaks: (named!.payload as unknown as { body: { breaks: Breaks } }).body.breaks, payload: named!.payload };
}
const view = () => ({});
/** A fresh view attached with the start token issued for it. */
const fresh2 = (s: ProvenanceSession, v: object, origin: string) => s.attach(v, s.openView(v), origin);
const fresh = (s: ProvenanceSession, origin: string) => {
  const v = view();
  return s.attach(v, s.openView(v), origin);
};
const ins = (at: number, text: string) => [{ fromA: at, toA: at, fromB: at, toB: at + text.length }];

describe("ProvenanceSession — start certificates", () => {
  it("a fresh view presenting its start token attaches without a break", async () => {
    const s = session("abc");
    fresh(s, "source").edit("abc", ins(3, "d"), "abcd");
    const { breaks, payload } = await breaksOf(s, "abcd");
    expect(breaks.whole).toBeNull();
    await expect(verifyPayloadTexts(payload, "abc", "abcd")).resolves.toBeDefined();
  });

  it("a remount (detach, then a new view with its own start token) stays certified", async () => {
    const s = session("你好");
    fresh(s, "wysiwyg").detach();
    fresh(s, "source");
    expect((await breaksOf(s, "你好")).breaks.whole).toBeNull();
  });

  it("the very first view without a certificate breaks, even at equal text", async () => {
    const s = session("abc");
    s.attach(view(), null, "source");
    expect((await breaksOf(s, "abc")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "source:attach" });
  });

  it("an empty document is no exception", async () => {
    const s = session("");
    s.attach(view(), null, "source");
    expect((await breaksOf(s, "")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "source:attach" });
  });

  it("a start token presented twice certifies only the first view", async () => {
    const s = session("abc");
    const v = view();
    const token = s.openView(v);
    s.attach(v, token, "source").detach();
    s.attach(v, token, "wysiwyg");
    expect((await breaksOf(s, "abc")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:attach" });
  });

  it("a token is stale once the session's text moved, even back to the same text", async () => {
    const s = session("abc");
    const v = view();
    const token = s.openView(v);
    s.observeStoreText("abX");
    s.observeStoreText("abc");
    const f = s.freeze("abc"); // settle the store breaks into their own window
    f.recorded((await f.payload(null))?.basis ?? HEAD);
    s.attach(v, token, "source");
    expect((await breaksOf(s, "abc")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "source:attach" });
  });

  it("a token issued by another session certifies nothing", async () => {
    const s = session("abc");
    const other = session("abc");
    const v = view();
    s.attach(v, other.openView(v), "source");
    expect((await breaksOf(s, "abc")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "source:attach" });
  });

  it("a token issued while another view was attached is valid while nothing changed", async () => {
    const s = session("abc");
    const v = view();
    const c = s.attach(v, s.openView(v), "wysiwyg");
    const w = view();
    const token = s.openView(w);
    c.detach();
    s.attach(w, token, "source");
    expect((await breaksOf(s, "abc")).breaks.whole).toBeNull();
  });

  it("a token is redeemed only by the owner it was issued for", async () => {
    const s = session("abc");
    const a = view();
    const token = s.openView(a);
    s.attach(view(), token, "source");
    expect((await breaksOf(s, "abc")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "source:attach" });
  });

  it("a detach certificate is stale once the session's text moved while detached", async () => {
    const s = session("abc");
    const v = view();
    const cert = fresh2(s, v, "wysiwyg").detach();
    fresh(s, "source").edit("abc", ins(3, "d"), "abcd");
    s.attach(v, cert, "wysiwyg");
    expect((await breaksOf(s, "abcd")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:attach" });
  });

  it("a view mutated while detached cannot carry the mutation in on its certificate", async () => {
    const s = session("abc");
    const v = view();
    const cert = fresh2(s, v, "source").detach();
    // the detached view now holds "abZ"; nothing told the session
    s.attach(v, cert, "source");
    expect((await breaksOf(s, "abZ")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "freeze:unaligned" });
  });
});

describe("ProvenanceSession — bounded deferrals", () => {
  const base = "# A\n\nb\n\nc\n\nd";
  it("composes several bounded breaks in document order, each under its own origin", async () => {
    const s = session(base);
    const after = "# A\n\nbXY\n\nc\n\n";
    fresh(s, "wysiwyg").defer(after, (b) =>
      b === base
        ? [
            { from: 5, to: 6, insert: 3, origin: "wysiwyg:pm-touched" },
            { from: 9, to: 12, insert: 2, origin: "wysiwyg:pm-removed" },
          ]
        : null,
    );
    const { breaks, payload } = await breaksOf(s, after);
    expect(breaks.whole).toBeNull();
    expect(breaks.bounded.map((x) => x.origin)).toEqual(["wysiwyg:pm-touched", "wysiwyg:pm-removed"]);
    await expect(verifyPayloadTexts(payload, base, after)).resolves.toBeDefined();
  });

  it("an empty list is the identity (an unchanged flush)", async () => {
    const s = session(base);
    fresh(s, "wysiwyg").defer(base, () => []);
    expect((await breaksOf(s, base)).breaks).toMatchObject({ whole: null, bounded: [] });
  });

  it("a whole outcome is recorded under the collector's reason and origin", async () => {
    const s = session(base);
    fresh(s, "wysiwyg").defer("zz", () => ({ whole: "capOverflow", origin: "wysiwyg:chain-cap" }));
    expect((await breaksOf(s, "zz")).breaks.whole).toEqual({ reason: "capOverflow", origin: "wysiwyg:chain-cap" });
  });

  it.each([
    ["overlapping", [{ from: 5, to: 7, insert: 3 }, { from: 6, to: 8, insert: 0 }]],
    ["descending", [{ from: 9, to: 12, insert: 2 }, { from: 5, to: 6, insert: 3 }]],
    ["text outside differs", [{ from: 5, to: 6, insert: 3 }]],
    ["negative", [{ from: -1, to: 6, insert: 3 }]],
    ["fractional", [{ from: 5.5, to: 6, insert: 3 }]],
  ])("a list that does not tile both texts breaks whole (%s)", async (_name, ranges) => {
    const s = session(base);
    const after = "# A\n\nbXY\n\nc\n\n";
    fresh(s, "wysiwyg").defer(after, () => ranges);
    expect((await breaksOf(s, after)).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unmatched" });
  });

  it("a whole outcome with a reason the journal does not know fails closed", async () => {
    const s = session(base);
    fresh(s, "wysiwyg").defer("zz", () => ({ whole: "made-up" as "snapshotOnly", origin: "wysiwyg:x" }));
    expect((await breaksOf(s, "zz")).breaks.whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unmatched" });
  });
});

describe("ProvenanceSession — which collector holds the text", () => {
  it("a certified attach holds it; an uncertified one does not", () => {
    const s = session("abc");
    expect(fresh(s, "wysiwyg").holds()).toBe(true);
    const t = session("abc");
    expect(t.attach(view(), null, "wysiwyg").holds()).toBe(false);
  });

  it("the collector's own edits and deferrals keep it", () => {
    const s = session("abc");
    const c = fresh(s, "wysiwyg");
    c.defer("abcd", () => []);
    expect(c.holds()).toBe(true);
    c.edit("abcd", ins(4, "e"), "abcde");
    expect(c.holds()).toBe(true);
  });

  it.each([
    ["another collector's edit", (s: ProvenanceSession) => fresh(s, "source").edit("abc", ins(3, "d"), "abcd")],
    ["an unannounced store write", (s: ProvenanceSession) => s.observeStoreText("abX")],
    ["a reload at equal text", (s: ProvenanceSession) => s.observeReload("abc")],
    ["a controlled write", (s: ProvenanceSession) => void s.fork("agent")],
    ["an unaligned freeze", (s: ProvenanceSession) => s.freeze("zzz").invalidate()],
  ])("%s takes it away, even when the text comes back", (_name, act) => {
    const s = session("abc");
    const c = fresh(s, "wysiwyg");
    act(s);
    expect(c.holds()).toBe(false);
  });

  it("a delete and retype by another collector, back to equal text, takes it away", () => {
    const s = session("abc");
    const w = fresh(s, "wysiwyg");
    const src = fresh(s, "source");
    src.edit("abc", [{ fromA: 2, toA: 3, fromB: 2, toB: 2 }], "ab");
    src.edit("ab", ins(2, "c"), "abc");
    expect(s.text).toBe("abc");
    expect(w.holds()).toBe(false);
  });

  it("an aligned freeze keeps it; a detached collector holds nothing", () => {
    const s = session("abc");
    const c = fresh(s, "wysiwyg");
    c.defer("abcd", () => [{ from: 3, to: 3, insert: 1 }]);
    s.freeze("abcd").invalidate();
    expect(c.holds()).toBe(true);
    c.detach();
    expect(c.holds()).toBe(false);
  });
});
