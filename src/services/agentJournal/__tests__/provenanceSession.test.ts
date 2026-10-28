// @vitest-environment node
// WI-AL1.4 — a tab's provenance session: collector edits compose into the open window and a freeze hands the journal a payload that verifies against the window's basis text and the saved buffer; the first window's basis comes from the arm handshake only when the journal head's text hashes the same; a recorded save becomes the next window's basis, a cancelled or refused one leaves the next window uncertifiable; view certificates (only the issuing view, once) carry a hidden view across, every other attach after the first is a whole snapshotOnly break even at equal text; unannounced store writes, reloads, stale collectors and over-cap windows break; deferred WYSIWYG ranges become bounded breaks; epochs are armed lazily, closed when nothing is left to certify, and closed at once when the arm answers after dispose; the frozen-window budget refuses past its cap
import { describe, it, expect, vi } from "vitest";
import { ProvenanceSession, type SessionJournal } from "../provenance/session";
import { textHash, verifyPayloadTexts } from "../provenance/payload";
import type { ArmedEpoch } from "../epochClient";

const DOC = "0190d3c4-0000-7000-8000-00000000000d";
const HEAD = "0190d3c4-0000-7000-8000-0000000000a1";

function journal(over: Partial<{ head: string | null; headText: string | null; fail: boolean }> = {}) {
  let epoch = 0;
  const closed: string[] = [];
  const j: SessionJournal & { closed: string[]; arms: () => number } = {
    arm: vi.fn(async (): Promise<ArmedEpoch> => {
      if (over.fail) throw new Error("still armed");
      epoch += 1;
      const headText = over.headText ?? null;
      return {
        doc: DOC,
        epoch: String(epoch),
        head: headText === null ? null : (over.head ?? HEAD),
        headHash: headText === null ? null : `sha256-${await textHash(headText)}`,
      };
    }),
    close: vi.fn(async (e: string) => {
      closed.push(e);
    }),
    closed,
    arms: () => epoch,
  };
  return j;
}

/** A session whose first window is certified on HEAD holding `text`. */
function session(text: string, opts: { cap?: number; maxFrozen?: number } = {}) {
  const j = journal({ headText: text });
  const warn = vi.fn();
  const s = new ProvenanceSession(text, j, { ...opts, warn });
  return { s, j, warn };
}

const ins = (at: number, text: string) => [{ fromA: at, toA: at, fromB: at, toB: at + text.length }];
const view = () => ({});
/** A fresh view attached with the start token issued for it. */
const fresh = (s: ProvenanceSession, origin: string) => {
  const v = view();
  return s.attach(v, s.openView(v), origin);
};

async function payloadOf(s: ProvenanceSession, buffer: string, basis: string | null = HEAD) {
  const f = s.freeze(buffer);
  return { f, named: await f.payload(basis) };
}

describe("ProvenanceSession — certified windows", () => {
  it("composes collector edits and freezes them into a payload that verifies", async () => {
    const { s, j } = session("abc");
    const c = fresh(s, "source");
    c.edit("abc", ins(3, "d"), "abcd");
    const { named } = await payloadOf(s, "abcd");
    expect(named?.basis).toBe(HEAD);
    const p = named!.payload;
    expect([p.document, p.epoch, p.basis]).toEqual([DOC, "1", HEAD]);
    await expect(verifyPayloadTexts(p, "abc", "abcd")).resolves.toBeDefined();
    expect(j.arm).toHaveBeenCalledTimes(1);
  });

  it("certifies CJK, emoji and an empty starting text", async () => {
    const { s } = session("");
    const c = fresh(s, "source");
    c.edit("", ins(0, "你好"), "你好");
    c.edit("你好", ins(2, "😀"), "你好😀");
    const { named } = await payloadOf(s, "你好😀");
    await expect(verifyPayloadTexts(named!.payload, "", "你好😀")).resolves.toBeDefined();
  });

  it("names the handshake basis when the caller names none, and refuses another basis", async () => {
    const { s } = session("abc");
    fresh(s, "source");
    expect((await s.freeze("abc").payload(null))?.basis).toBe(HEAD);
    const t = session("abc");
    fresh(t.s, "source");
    expect(await t.s.freeze("abc").payload("0190d3c4-0000-7000-8000-0000000000ff")).toBeNull();
  });

  it("starts a new document on genesis", async () => {
    const j = journal({ headText: null });
    const s = new ProvenanceSession("", j, { warn: vi.fn() });
    fresh(s, "source");
    expect((await s.freeze("").payload(null))?.basis).toBe("genesis");
  });

  it("does not trust a head whose text hashes differently", async () => {
    const j = journal({ headText: "something else" });
    const s = new ProvenanceSession("abc", j, { warn: vi.fn() });
    fresh(s, "source");
    expect(await s.freeze("abc").payload(null)).toBeNull();
  });

  it("answers null when no epoch could be armed", async () => {
    const j = journal({ headText: "abc", fail: true });
    const s = new ProvenanceSession("abc", j, { warn: vi.fn() });
    fresh(s, "source");
    expect(await s.freeze("abc").payload(HEAD)).toBeNull();
  });

  it("chains windows: a recorded save is the next window's basis and text", async () => {
    const { s } = session("abc");
    const c = fresh(s, "source");
    c.edit("abc", ins(3, "d"), "abcd");
    const first = s.freeze("abcd");
    c.edit("abcd", ins(4, "e"), "abcde"); // typed while the save is in flight
    expect(await first.payload(HEAD)).not.toBeNull();
    first.recorded("obs-1");
    const second = await s.freeze("abcde").payload("obs-1");
    await expect(verifyPayloadTexts(second!.payload, "abcd", "abcde")).resolves.toBeDefined();
  });

  it("a cancelled or refused save leaves the next window uncertifiable", async () => {
    const { s } = session("abc");
    fresh(s, "source");
    s.freeze("abc").invalidate();
    expect(await s.freeze("abc").payload(null)).toBeNull();
  });

  it("an over-cap freeze can be released", () => {
    const { s } = session("abc", { maxFrozen: 0 });
    fresh(s, "source");
    expect(() => s.freeze("abc").release()).not.toThrow();
  });

  it.each([
    ["while the epoch is arming", 0],
    ["while the texts are hashing", 5],
  ])("a freeze invalidated %s answers no payload", async (_label, ticks) => {
    const { s } = session("abc");
    const c = fresh(s, "source");
    c.edit("abc", ins(3, "d"), "abcd");
    const f = s.freeze("abcd");
    if (ticks > 0) await s.idle(); // the epoch is armed already
    const named = f.payload(HEAD);
    for (let i = 0; i < ticks; i++) await Promise.resolve();
    f.invalidate();
    expect(await named).toBeNull();
  });

  it("an apply fork starts the next window on the applied text once its revision lands", async () => {
    const { s } = session("abc");
    const c = fresh(s, "source");
    const fork = s.fork("xyz");
    c.edit("xyz", ins(3, "!"), "xyz!");
    fork.recorded("rev-2");
    const named = await s.freeze("xyz!").payload("rev-2");
    await expect(verifyPayloadTexts(named!.payload, "xyz", "xyz!")).resolves.toBeDefined();
  });

  it("reports whether the frozen window was touched", () => {
    const { s } = session("abc");
    const c = fresh(s, "source");
    expect(s.freeze("abc").touched).toBe(false);
    c.edit("abc", ins(0, "x"), "xabc");
    expect(s.freeze("xabc").touched).toBe(true);
  });
});

/** Freeze `buffer`, record it, and return the frozen window's breaks. */
async function wholeOf(s: ProvenanceSession, buffer: string) {
  const f = s.freeze(buffer);
  const named = await f.payload(null);
  f.recorded(named!.basis);
  return (named!.payload as unknown as { body: { breaks: { whole: unknown; bounded: unknown[] } } }).body.breaks;
}

describe("ProvenanceSession — gaps fail closed", () => {
  it("a second view without a certificate breaks the whole window, even at equal text", async () => {
    const { s } = session("abc");
    fresh(s, "source").detach();
    s.attach(view(), null, "wysiwyg");
    expect((await wholeOf(s, "abc")).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:attach" });
  });

  it("the issuing view's own certificate carries it across, once", async () => {
    const { s } = session("abc");
    const v = view();
    const cert = s.attach(v, s.openView(v), "source").detach();
    s.attach(v, cert, "source");
    expect((await wholeOf(s, "abc")).whole).toBeNull();
    const again = session("abc");
    const w = view();
    const c2 = again.s.attach(w, again.s.openView(w), "source").detach();
    again.s.attach(w, c2, "source").detach();
    again.s.attach(w, c2, "source");
    expect((await wholeOf(again.s, "abc")).whole).not.toBeNull();
  });

  it("refuses a certificate presented by another view or issued by another session", async () => {
    const a = session("abc");
    const cert = fresh(a.s, "source").detach();
    a.s.attach(view(), cert, "source");
    expect((await wholeOf(a.s, "abc")).whole).not.toBeNull();
    const b = session("abc");
    const v = view();
    b.s.attach(v, b.s.openView(v), "source");
    const foreign = new ProvenanceSession("abc", journal({ headText: "abc" }), { warn: vi.fn() }).attach(v, null, "source").detach();
    b.s.attach(v, foreign, "source");
    expect((await wholeOf(b.s, "abc")).whole).not.toBeNull();
  });

  it("a repeated detach issues nothing new: a stale collector cannot mint a certificate or drop the live one's hold", async () => {
    const { s } = session("abc");
    const v = view();
    const stale = s.attach(v, s.openView(v), "source");
    const cert = stale.detach();
    const live = s.attach(v, cert, "source");
    live.edit("abc", ins(0, "x"), "xabc");
    expect(stale.detach()).toBe(cert);
    expect(live.holds()).toBe(true);
    s.attach(v, stale.detach(), "source");
    expect((await wholeOf(s, "xabc")).whole).toEqual({ reason: "snapshotOnly", origin: "source:attach" });
  });

  it("a detached collector is inert", async () => {
    const { s } = session("abc");
    const c = fresh(s, "source");
    c.detach();
    c.edit("abc", ins(0, "x"), "xabc");
    expect(s.text).toBe("abc");
  });

  it("a store write no collector announced breaks the whole window", async () => {
    const { s } = session("abc");
    fresh(s, "source");
    s.observeStoreText("abc"); // nothing changed
    expect((await wholeOf(s, "abc")).whole).toBeNull();
    s.observeStoreText("abX");
    expect((await wholeOf(s, "abX")).whole).toEqual({ reason: "snapshotOnly", origin: "store:unobserved-write" });
  });

  it("a reload breaks as externalReload even when the text is unchanged", async () => {
    const { s } = session("abc");
    fresh(s, "source");
    s.observeReload("abc");
    expect((await wholeOf(s, "abc")).whole).toEqual({ reason: "externalReload", origin: "store:document-replaced" });
  });

  it("ignores a stale collector's sync to the session text, and breaks on anything else", async () => {
    const { s } = session("abc");
    const c = fresh(s, "source");
    c.edit("old", [{ fromA: 0, toA: 3, fromB: 0, toB: 3 }], "abc");
    expect((await wholeOf(s, "abc")).whole).toBeNull();
    c.edit("old", ins(3, "!"), "old!");
    expect((await wholeOf(s, "old!")).whole).toEqual({ reason: "snapshotOnly", origin: "source:unaligned" });
  });

  it("a section list that does not fit the text breaks instead of throwing", async () => {
    const { s } = session("abc");
    const c = fresh(s, "source");
    c.edit("abc", [{ fromA: 2, toA: 9, fromB: 2, toB: 2 }], "ab");
    expect((await wholeOf(s, "ab")).whole).toEqual({ reason: "snapshotOnly", origin: "source:malformed" });
  });

  it("a buffer the window never reached is frozen as a whole break", async () => {
    const { s } = session("abc");
    fresh(s, "source");
    expect((await wholeOf(s, "zzz")).whole).toEqual({ reason: "snapshotOnly", origin: "freeze:unaligned" });
  });

  it("past the entry cap the window is a whole capOverflow break", async () => {
    const { s } = session("abcdefghij", { cap: 4 });
    const c = fresh(s, "source");
    let text = "abcdefghij";
    for (const at of [1, 3, 5, 7]) {
      const next = text.slice(0, at) + "x" + text.slice(at);
      c.edit(text, ins(at, "x"), next);
      text = next;
    }
    expect((await wholeOf(s, text)).whole).toEqual({ reason: "capOverflow", origin: "accumulator" });
  });

  it("a collector gap breaks the whole window under the collector's origin", async () => {
    const { s } = session("abc");
    fresh(s, "wysiwyg").gap("wysiwyg:plugin-set-changed");
    expect((await wholeOf(s, "abc")).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:plugin-set-changed" });
  });
});

describe("ProvenanceSession — deferred WYSIWYG ranges", () => {
  it("materializes the latest deferral as one bounded break before the freeze", async () => {
    const { s } = session("# A\n\nb\n\nc");
    const c = fresh(s, "wysiwyg");
    c.defer("# A\n\nbX\n\nc", (base) => (base === "# A\n\nb\n\nc" ? [{ from: 5, to: 6, insert: 2 }] : null));
    expect(s.text).toBe("# A\n\nbX\n\nc");
    const breaks = await wholeOf(s, "# A\n\nbX\n\nc");
    expect(breaks.whole).toBeNull();
    expect(breaks.bounded).toHaveLength(1);
  });

  it("a deferral that cannot be matched breaks the whole window", async () => {
    const { s } = session("abc");
    fresh(s, "wysiwyg").defer("abX", () => null);
    expect((await wholeOf(s, "abX")).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unmatched" });
  });

  it("a deferral whose range does not add up breaks the whole window", async () => {
    const { s } = session("abc");
    fresh(s, "wysiwyg").defer("abX", () => [{ from: 2, to: 3, insert: 5 }]);
    expect((await wholeOf(s, "abX")).whole).toEqual({ reason: "snapshotOnly", origin: "wysiwyg:unmatched" });
  });

  it("another collector's edit materializes the deferral first", async () => {
    const { s } = session("abc");
    const v = view();
    const w = s.attach(v, s.openView(v), "wysiwyg");
    w.defer("abcX", () => [{ from: 3, to: 3, insert: 1 }]);
    const src = fresh(s, "source"); // certified: nothing changed since its token
    src.edit("abcX", ins(4, "Y"), "abcXY");
    expect(s.text).toBe("abcXY");
  });
});

describe("ProvenanceSession — epochs and budgets", () => {
  it("arms on the first edit, and closes once nothing is left to certify", async () => {
    const { s, j } = session("abc");
    const c = fresh(s, "source");
    expect(j.arm).not.toHaveBeenCalled();
    c.edit("abc", ins(3, "d"), "abcd");
    await vi.waitFor(() => expect(j.arm).toHaveBeenCalledTimes(1));
    const f = s.freeze("abcd");
    await f.payload(HEAD);
    expect(j.closed).toEqual([]);
    f.recorded("obs-1");
    await s.idle();
    expect(j.closed).toEqual(["1"]);
  });

  it("keeps the epoch while a frozen window or new edits still need it", async () => {
    const { s, j } = session("abc");
    const c = fresh(s, "source");
    c.edit("abc", ins(3, "d"), "abcd");
    const f1 = s.freeze("abcd");
    const f2 = s.freeze("abcd");
    f1.recorded("obs-1");
    await s.idle();
    expect(j.closed).toEqual([]);
    c.edit("abcd", ins(4, "e"), "abcde");
    f2.recorded("obs-2");
    await s.idle();
    expect(j.closed).toEqual([]);
  });

  it("closes an epoch whose arm answers after dispose", async () => {
    const { s, j } = session("abc");
    fresh(s, "source").edit("abc", ins(3, "d"), "abcd");
    await s.dispose();
    expect(j.closed).toEqual(["1"]);
    expect(await s.freeze("abcd").payload(HEAD)).toBeNull();
  });

  it("past the frozen-window budget a freeze is refused loudly and the next window is uncertifiable", async () => {
    const { s, warn } = session("abc", { maxFrozen: 2 });
    fresh(s, "source");
    s.freeze("abc");
    s.freeze("abc");
    const over = s.freeze("abc");
    expect(await over.payload(null)).toBeNull();
    expect(warn).toHaveBeenCalled();
    over.recorded("obs-x");
    expect(await s.freeze("abc").payload("obs-x")).toBeNull();
  });
});
