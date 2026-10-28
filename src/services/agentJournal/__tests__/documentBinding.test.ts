// @vitest-environment node
// WI-AL1.6 — document identity across Save As and rename (ADR-AL7): the tab's document is bound to its new key once per pair, work on either key waits for the bind, a bind sharing a key with a running one runs after it, a failed bind answers its refusal and leaves the destination unbound (no Rust call for a move out of it, persistent until a bind there lands), and the tab's basis, observed base, outstanding save chain and in-flight count move with it while the old window name is released; what work still in flight under the old key learns or finishes lands on the key the tab now holds, through any chain of moves
import { describe, it, expect, vi } from "vitest";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { bindJournalDocument, journalBindOrigin, journalDocumentReady, noteJournalDocument } from "../documentBinding";
import {
  admitOutstandingSave,
  carryJournalBasis,
  clearOutstandingSaveBase,
  finishOutstandingSave,
  journalBasis,
  journalObservedBase,
  outstandingSaveBase,
  rememberJournalBasis,
  rememberPendingSave,
  setOutstandingSaveBase,
  windowNameFor,
} from "../documentIdentity";

const A = "path:/文档/a.md";
const B = "path:/文档/b.md";
const TAB = "tab-1";

describe("bindJournalDocument", () => {
  it("binds once per pair and not at all for an unchanged key", async () => {
    await bindJournalDocument(A, B);
    await bindJournalDocument(A, B);
    await bindJournalDocument(B, B);
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, null]]);
  });

  it("binds again when the same source moves somewhere else", async () => {
    await bindJournalDocument("tab:main/t1", A);
    await bindJournalDocument("tab:main/t1", B);
    expect(agentJournalEpochFake.bindDocument).toHaveBeenCalledTimes(2);
  });

  it("binds every step of a rename there and back", async () => {
    agentJournalEpochFake.setDocument(A, "doc-a");
    await bindJournalDocument(A, B);
    await bindJournalDocument(B, A);
    await bindJournalDocument(A, B);
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, "doc-a"], [B, A, "doc-a"], [A, B, "doc-a"]]);
  });

  it("retries a pair whose bind failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    agentJournalEpochFake.setDocument(A, "doc-a");
    noteJournalDocument(A, "doc-a");
    agentJournalEpochFake.failNextBinds(1);
    await bindJournalDocument(A, B);
    await bindJournalDocument(A, B);
    expect(agentJournalEpochFake.bindDocument).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("holds work on either key until the bind settles", async () => {
    const release = agentJournalEpochFake.holdNextBind();
    const bound = bindJournalDocument(A, B);
    let ready = 0;
    void journalDocumentReady(A).then(() => ready++);
    void journalDocumentReady(B).then(() => ready++);
    await Promise.resolve();
    expect(ready).toBe(0);
    release();
    await bound;
    await Promise.resolve();
    expect(ready).toBe(2);
    await expect(journalDocumentReady("path:/other.md")).resolves.toEqual({ ok: true });
  });

  it("a bind sharing a key with a running one waits for it, and work on every key waits for both", async () => {
    const C = "path:/文档/c.md";
    agentJournalEpochFake.setDocument(A, "doc-a");
    const release = agentJournalEpochFake.holdNextBind();
    const first = bindJournalDocument(A, B);
    const second = bindJournalDocument(B, C);
    const ready: string[] = [];
    for (const key of [A, B, C]) void journalDocumentReady(key).then(() => ready.push(key));
    await Promise.resolve();
    await Promise.resolve();
    // B does not hold A's document yet: moving it on now would move nothing.
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, "doc-a"]]);
    expect(ready).toEqual([]);
    release();
    await first;
    await second;
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, "doc-a"], [B, C, "doc-a"]]);
    expect(ready.sort()).toEqual([A, B, C].sort());
  });

  it("a repeated pair answers with a promise that waits for every bind of its key", async () => {
    const C = "path:/文档/c.md";
    const release = agentJournalEpochFake.holdNextBind();
    void bindJournalDocument(A, B);
    void bindJournalDocument(B, C);
    let again = false;
    void bindJournalDocument(A, B).then(() => (again = true));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(again).toBe(false);
    release();
    await journalDocumentReady(C);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(again).toBe(true);
  });
});

describe("bindJournalDocument — a failed bind", () => {
  const C = "path:/文档/c.md";
  const unbound = () => useJournalRecordingStore.getState().unbound;
  const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("answers its refusal; the destination stays unbound and the source ready", async () => {
    const warn = quiet();
    agentJournalEpochFake.failNextBinds(1);
    const result = await bindJournalDocument(A, B);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.journalCode).toBe("JOURNAL_IO");
    expect((await journalDocumentReady(B)).ok).toBe(false);
    expect((await journalDocumentReady(A)).ok).toBe(true);
    expect(journalBindOrigin(B)).toBe(A);
    expect(unbound()).toEqual({ [B]: true });
    warn.mockRestore();
  });

  it("stays unbound across repeated failures, and only a bind that lands clears it", async () => {
    const warn = quiet();
    agentJournalEpochFake.setDocument(A, "doc-a");
    noteJournalDocument(A, "doc-a");
    agentJournalEpochFake.failNextBinds(3);
    for (let i = 0; i < 3; i++) expect((await bindJournalDocument(A, B)).ok).toBe(false);
    expect(unbound()).toEqual({ [B]: true });
    expect(await bindJournalDocument(A, B)).toEqual({ ok: true });
    expect((await journalDocumentReady(B)).ok).toBe(true);
    expect(journalBindOrigin(B)).toBeNull();
    expect(unbound()).toEqual({});
    warn.mockRestore();
  });

  it("a move out of a failed key never reaches the journal: the next key is unbound from the original source", async () => {
    const warn = quiet();
    agentJournalEpochFake.setDocument(A, "doc-a");
    noteJournalDocument(A, "doc-a");
    agentJournalEpochFake.failNextBinds(1);
    await bindJournalDocument(A, B);
    const result = await bindJournalDocument(B, C);
    expect(result.ok).toBe(false);
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, "doc-a"]]);
    expect(journalBindOrigin(C)).toBe(A);
    expect(journalBindOrigin(B)).toBeNull();
    expect(unbound()).toEqual({ [C]: true });
    // Recovery binds the original source straight to where the tab is.
    expect(await bindJournalDocument(A, C)).toEqual({ ok: true });
    expect(unbound()).toEqual({});
    warn.mockRestore();
  });

  it("a move queued behind a bind that then fails does not proceed (A to B held and failing, then B to C)", async () => {
    const warn = quiet();
    const release = agentJournalEpochFake.holdNextBind();
    agentJournalEpochFake.failNextBinds(1);
    const first = bindJournalDocument(A, B);
    const second = bindJournalDocument(B, C);
    release();
    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(false);
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, null]]);
    expect(journalBindOrigin(C)).toBe(A);
    warn.mockRestore();
  });

  it("a move back to the source after a failed bind is ready without a journal call", async () => {
    const warn = quiet();
    agentJournalEpochFake.failNextBinds(1);
    await bindJournalDocument(A, B);
    expect(await bindJournalDocument(B, A)).toEqual({ ok: true });
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, null]]);
    expect(unbound()).toEqual({});
    expect((await journalDocumentReady(A)).ok).toBe(true);
    warn.mockRestore();
  });

  it("an unbound key is never forgotten to make room: past the bind memory the oldest still refuses, keeps its origin and stays marked", async () => {
    const warn = quiet();
    const count = 1025;
    agentJournalEpochFake.failNextBinds(count);
    for (let i = 0; i < count; i++) await bindJournalDocument(`path:/s${i}.md`, `path:/d${i}.md`);
    expect((await journalDocumentReady("path:/d0.md")).ok).toBe(false);
    expect(journalBindOrigin("path:/d0.md")).toBe("path:/s0.md");
    expect(unbound()["path:/d0.md"]).toBe(true);
    expect(Object.keys(unbound())).toHaveLength(count);
    warn.mockRestore();
  });

  it("recovery never moves a replacement identity: once the origin's document moved elsewhere, the destination stays unbound", async () => {
    const warn = quiet();
    agentJournalEpochFake.failNextBinds(1);
    // Tab 1's Save As A → B fails; tab 2 holding the same file then moves A's document to C.
    await bindJournalDocument(A, B);
    expect(await bindJournalDocument(A, C)).toEqual({ ok: true });
    // A is reopened by now: binding A → B would carry the replacement document.
    const recovery = await bindJournalDocument(A, B);
    expect(recovery.ok).toBe(false);
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, null], [A, C, null]]);
    expect((await journalDocumentReady(B)).ok).toBe(false);
    expect(unbound()[B]).toBe(true);
    warn.mockRestore();
  });

  it("recovery is refused once the origin is known to hold a different document than the one that failed to move", async () => {
    const warn = quiet();
    agentJournalEpochFake.setDocument(A, "doc-x");
    noteJournalDocument(A, "doc-x");
    agentJournalEpochFake.failNextBinds(1);
    await bindJournalDocument(A, B);
    // A later arm or capture at A (another window moved X away and A was reopened) names Y.
    noteJournalDocument(A, "doc-y");
    expect((await bindJournalDocument(A, B)).ok).toBe(false);
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, "doc-x"]]);
    expect(unbound()[B]).toBe(true);
    warn.mockRestore();
  });

  it("recovery asks the journal to compare and set: it names the document the failed bind was carrying", async () => {
    const warn = quiet();
    agentJournalEpochFake.setDocument(A, "doc-x");
    noteJournalDocument(A, "doc-x");
    agentJournalEpochFake.failNextBinds(1);
    await bindJournalDocument(A, B);
    expect((await bindJournalDocument(A, B)).ok).toBe(true);
    // The first bind and the recovery both name it.
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, "doc-x"], [A, B, "doc-x"]]);
    expect(unbound()[B]).toBeUndefined();
    warn.mockRestore();
  });

  it("every bind names the source's document when it is known, not only a recovery", async () => {
    agentJournalEpochFake.setDocument(A, "doc-d1");
    noteJournalDocument(A, "doc-d1");
    expect(await bindJournalDocument(A, B)).toEqual({ ok: true });
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, "doc-d1"]]);
  });

  it("a failed recovery keeps the expectation captured at the original failure, even once the origin's cached id is evicted", async () => {
    const warn = quiet();
    agentJournalEpochFake.setDocument(A, "doc-x");
    noteJournalDocument(A, "doc-x");
    agentJournalEpochFake.failNextBinds(2);
    await bindJournalDocument(A, B);
    // Push A's cached id out of the bounded memory.
    for (let i = 0; i < 1025; i++) noteJournalDocument(`path:/n${i}.md`, `doc-n${i}`);
    // The retry is refused (A holds a replacement now); the next one must still compare and set.
    expect((await bindJournalDocument(A, B)).ok).toBe(false);
    await bindJournalDocument(A, B);
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, "doc-x"], [A, B, "doc-x"], [A, B, "doc-x"]]);
    warn.mockRestore();
  });

  it("recovery whose origin was looked up as empty fails closed once the origin is learned to hold a document: the destination stays unbound", async () => {
    const warn = quiet();
    agentJournalEpochFake.failNextBinds(1);
    await bindJournalDocument(A, B);
    // Another window opened A meanwhile (a new document there), which this window then learns.
    noteJournalDocument(A, agentJournalEpochFake.resolveDocument(A));
    const recovery = await bindJournalDocument(A, B);
    expect(recovery.ok).toBe(false);
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([[A, B, null]]);
    expect((await journalDocumentReady(B)).ok).toBe(false);
    expect(unbound()[B]).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("names the source of a bind still running, and nothing once it has landed", async () => {
    const release = agentJournalEpochFake.holdNextBind();
    const bound = bindJournalDocument(A, B);
    expect(journalBindOrigin(B)).toBe(A);
    expect(journalBindOrigin(A)).toBeNull();
    release();
    await bound;
    expect(journalBindOrigin(B)).toBeNull();
  });
});

describe("carryJournalBasis", () => {
  it("moves the basis, observed base and outstanding chain and releases the old window name", async () => {
    rememberJournalBasis(TAB, A, "rev-1");
    const chain = Promise.resolve(null);
    setOutstandingSaveBase(TAB, A, chain);
    const oldWindow = windowNameFor(TAB, A, "main");
    carryJournalBasis(TAB, A, B);
    expect(journalBasis(TAB, B)).toBe("rev-1");
    expect(journalObservedBase(TAB, B)).toEqual({ ref: "revision", revision: "rev-1" });
    expect(outstandingSaveBase(TAB, B)).toBe(chain);
    expect(journalBasis(TAB, A)).toBeNull();
    await Promise.resolve();
    expect(agentJournalEpochFake.released).toContain(oldWindow);
  });

  it("never overwrites what the destination already learned, and an unchanged key is a no-op", () => {
    rememberJournalBasis(TAB, A, "rev-old");
    rememberJournalBasis(TAB, B, "rev-new");
    carryJournalBasis(TAB, A, B);
    expect(journalBasis(TAB, B)).toBe("rev-new");
    carryJournalBasis(TAB, B, B);
    expect(journalBasis(TAB, B)).toBe("rev-new");
  });

  it("a save in flight across the move counts against, and finishes on, the key the tab now holds", () => {
    expect(admitOutstandingSave(TAB, A, 1)).toBe(true);
    const chain = Promise.resolve(null);
    setOutstandingSaveBase(TAB, A, chain);
    carryJournalBasis(TAB, A, B);
    expect(admitOutstandingSave(TAB, B, 1)).toBe(false);
    // The ticket still names A: its completion lands on B.
    finishOutstandingSave(TAB, A);
    clearOutstandingSaveBase(TAB, A, chain);
    expect(outstandingSaveBase(TAB, B)).toBeNull();
    expect(admitOutstandingSave(TAB, B, 1)).toBe(true);
  });

  it("what a write in flight learns under the old key lands on the new one", () => {
    carryJournalBasis(TAB, A, B);
    rememberJournalBasis(TAB, A, "rev-late");
    expect(journalBasis(TAB, B)).toBe("rev-late");
    rememberPendingSave(TAB, A, "obs-late");
    expect(journalObservedBase(TAB, B)).toEqual({ ref: "pending", observation: "obs-late" });
  });

  it("follows a chain of moves, and a move back makes the old key the tab's own again", () => {
    const C = "path:/文档/c.md";
    rememberJournalBasis(TAB, A, "rev-1");
    carryJournalBasis(TAB, A, B);
    carryJournalBasis(TAB, B, C);
    rememberJournalBasis(TAB, A, "rev-2");
    expect(journalBasis(TAB, C)).toBe("rev-2");
    carryJournalBasis(TAB, C, A);
    expect(journalBasis(TAB, A)).toBe("rev-2");
    rememberJournalBasis(TAB, A, "rev-3");
    expect(journalBasis(TAB, A)).toBe("rev-3");
    // B and C are old keys now: late news under either lands on A.
    rememberJournalBasis(TAB, B, "rev-b");
    expect(journalBasis(TAB, A)).toBe("rev-b");
    expect(journalBasis(TAB, B)).toBeNull();
  });

  it("carries nothing for a tab with no state", () => {
    carryJournalBasis("tab-empty", A, B);
    expect(journalBasis("tab-empty", B)).toBeNull();
  });
});
