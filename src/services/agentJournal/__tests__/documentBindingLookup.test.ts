// @vitest-environment node
// WI-AL1.6 — every bind is a compare-and-set (ADR-AL7): when the source's document id was never learned, the bind first looks it up read-only and names what it found (an id, or none); a failed lookup fails closed with no bind; the looked-up expectation is pinned for recovery, so a failed bind whose origin was never learned recovers, and the journal itself refuses recovery once the origin was reused
import { describe, it, expect, vi } from "vitest";
import { agentJournalEpochFake as fake } from "@/test/agentJournalEpochFake";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { bindJournalDocument, journalBindOrigin, journalDocumentReady, noteJournalDocument } from "../documentBinding";

const A = "path:/文档/a.md";
const B = "path:/文档/b.md";
const C = "path:/文档/c.md";
const unbound = () => useJournalRecordingStore.getState().unbound;
const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

describe("bindJournalDocument — looking the source up", () => {
  it("names that the source carries no document when the lookup finds none", async () => {
    expect(await bindJournalDocument(A, B)).toEqual({ ok: true });
    expect(fake.findDocument.mock.calls).toEqual([[A]]);
    expect(fake.bindDocument.mock.calls).toEqual([[A, B, null]]);
  });

  it("names the document the lookup found, and it lands at the destination", async () => {
    const doc = fake.resolveDocument(A);
    expect(await bindJournalDocument(A, B)).toEqual({ ok: true });
    expect(fake.bindDocument.mock.calls).toEqual([[A, B, doc]]);
    expect(fake.documentOf(B)).toBe(doc);
    expect(fake.documentOf(A)).toBeNull();
  });

  it("does not look up a source whose document is already known", async () => {
    const doc = fake.resolveDocument(A);
    noteJournalDocument(A, doc);
    await bindJournalDocument(A, B);
    expect(fake.findDocument).not.toHaveBeenCalled();
    expect(fake.bindDocument.mock.calls).toEqual([[A, B, doc]]);
  });

  it("a known id the source no longer carries is refused by the journal: the destination stays unbound", async () => {
    const warn = quiet();
    noteJournalDocument(A, "doc-stale");
    fake.reuseDocument(A);
    const result = await bindJournalDocument(A, B);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.journalCode).toBe("INVALID_REQUEST");
    expect(fake.documentOf(B)).toBeNull();
    expect(unbound()).toEqual({ [B]: true });
    warn.mockRestore();
  });

  it("a failed lookup fails closed: no bind at all, the destination unbound with a warning", async () => {
    const warn = quiet();
    fake.failNextFinds(1);
    const result = await bindJournalDocument(A, B);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.journalCode).toBe("JOURNAL_UNAVAILABLE");
    expect(fake.bindDocument).not.toHaveBeenCalled();
    expect((await journalDocumentReady(B)).ok).toBe(false);
    expect(journalBindOrigin(B)).toBe(A);
    expect(unbound()).toEqual({ [B]: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("after a failed lookup, recovery stays closed: it never binds unchecked or trusts a later lookup", async () => {
    const warn = quiet();
    fake.failNextFinds(1);
    await bindJournalDocument(A, B);
    expect((await bindJournalDocument(A, B)).ok).toBe(false);
    expect(fake.bindDocument).not.toHaveBeenCalled();
    expect(unbound()).toEqual({ [B]: true });
    warn.mockRestore();
  });
});

describe("bindJournalDocument — recovering when the origin's id was never learned", () => {
  it("recovers with the looked-up expectation, pinned at the failure", async () => {
    const warn = quiet();
    fake.failNextBinds(1);
    expect((await bindJournalDocument(A, B)).ok).toBe(false);
    expect(await bindJournalDocument(A, B)).toEqual({ ok: true });
    // One lookup: recovery uses the expectation pinned at the failure.
    expect(fake.findDocument.mock.calls).toEqual([[A]]);
    expect(fake.bindDocument.mock.calls).toEqual([[A, B, null], [A, B, null]]);
    expect(unbound()).toEqual({});
    expect(fake.documentOf(B)).not.toBeNull();
    warn.mockRestore();
  });

  it("recovers a found id after the tab moved on from the failed destination", async () => {
    const warn = quiet();
    const doc = fake.resolveDocument(A);
    fake.failNextBinds(1);
    await bindJournalDocument(A, B);
    expect((await bindJournalDocument(B, C)).ok).toBe(false);
    expect(await bindJournalDocument(A, C)).toEqual({ ok: true });
    expect(fake.bindDocument.mock.calls).toEqual([[A, B, doc], [A, C, doc]]);
    expect(fake.documentOf(C)).toBe(doc);
    expect(unbound()).toEqual({});
    warn.mockRestore();
  });

  it("the journal refuses recovery once the origin carries a document it did not have (reused meanwhile)", async () => {
    const warn = quiet();
    fake.failNextBinds(1);
    await bindJournalDocument(A, B);
    // Another window opened A meanwhile: it carries a new document now.
    const replacement = fake.resolveDocument(A);
    const recovery = await bindJournalDocument(A, B);
    expect(recovery.ok).toBe(false);
    if (!recovery.ok) expect(recovery.refusal.journalCode).toBe("INVALID_REQUEST");
    expect(fake.bindDocument.mock.calls).toEqual([[A, B, null], [A, B, null]]);
    expect(fake.documentOf(A)).toBe(replacement);
    expect(fake.documentOf(B)).toBeNull();
    expect(unbound()).toEqual({ [B]: true });
    warn.mockRestore();
  });
});

describe("bindJournalDocument — the destination's id after a bind", () => {
  it("a bind that minted a fresh document replaces the destination's stale cached id", async () => {
    noteJournalDocument(B, "doc-old");
    expect(await bindJournalDocument(A, B)).toEqual({ ok: true });
    const minted = fake.documentOf(B);
    expect(minted).not.toBeNull();
    expect(minted).not.toBe("doc-old");
    expect(await bindJournalDocument(B, C)).toEqual({ ok: true });
    expect(fake.bindDocument.mock.calls).toEqual([[A, B, null], [B, C, minted]]);
    expect(fake.documentOf(C)).toBe(minted);
    expect(unbound()).not.toHaveProperty(C);
  });
});
