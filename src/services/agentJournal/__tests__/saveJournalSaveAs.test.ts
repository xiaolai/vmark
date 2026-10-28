// @vitest-environment node
// WI-AL1.6 — Save As carries the tab's journal document (ADR-AL7): the save's base is frozen from the key the tab held, the recorded save binds that key to the destination before the capture is sent and moves the tab's basis there; a cancelled Save As binds nothing, nor does a save to the tab's own path or by a tab the store does not hold; a failed bind sends no capture (the file is on disk; the save reports not recorded), keeps the tab's basis on the source, invalidates the window and suspends recording on the destination, through repeated failures and a close and reopen, until a later save rebinds from the source; the first capture after the gap carries no certified map
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));

import { useDocumentStore } from "@/stores/documentStore";
import { agentJournalFake } from "@/test/agentJournalFake";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { bindJournalDocument, noteJournalDocument } from "../documentBinding";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { carryJournalBasis, journalObservedBase, rememberJournalBasis, releaseTabJournal } from "../documentIdentity";
import { beginJournalSave } from "../saveJournal";
import { provenanceSessionFor, startProvenanceSessions } from "../provenanceSessions";
import type { ProvenanceFreeze } from "../provenance/session";
import { registerUnsavedProvenanceSource, resetUnsavedProvenanceSources } from "../unsavedProvenance";

const store = () => useDocumentStore.getState();
const captures = () => agentJournalFake.captureSaveToJournal.mock.calls.map((c) => c[0]);
const unbound = () => useJournalRecordingStore.getState().unbound;
const binds = () => agentJournalEpochFake.bindDocument.mock.calls;
const MANUAL = { saveType: "manual" } as const;

beforeEach(() => useDocumentStore.setState({ documents: {} }));
afterEach(() => resetUnsavedProvenanceSources());

describe("Save As in the save journal", () => {
  it("binds an untitled tab's key to the Save As path before the capture", async () => {
    store().initDocument("s1", "草稿", null);
    const ticket = beginJournalSave("s1", "/文档/草稿.md", "草稿", { saveType: "manual" });
    store().setFilePath("s1", "/文档/草稿.md");
    await ticket.record();
    expect(agentJournalEpochFake.bindDocument).toHaveBeenCalledWith("tab:main/s1", "path:/文档/草稿.md", null);
    expect(captures().at(-1)?.docKey).toBe("path:/文档/草稿.md");
  });

  it("freezes the base the tab held on its old path and moves it to the new one", async () => {
    store().initDocument("s2", "v1", "/a.md");
    rememberJournalBasis("s2", "path:/a.md", "rev-a");
    const ticket = beginJournalSave("s2", "/b.md", "v1", { saveType: "manual" });
    store().setFilePath("s2", "/b.md");
    const out = await ticket.record();
    expect(captures().at(-1)?.observedParent).toEqual({ ref: "revision", revision: "rev-a" });
    expect(journalObservedBase("s2", "path:/a.md")).toBeNull();
    const id = out.revision ?? null;
    if (id !== null) expect(journalObservedBase("s2", "path:/b.md")).toEqual({ ref: "revision", revision: id });
    else expect(journalObservedBase("s2", "path:/b.md")).not.toBeNull();
  });

  it("sends the capture only once the bind has landed", async () => {
    store().initDocument("s3", "x", "/c.md");
    const release = agentJournalEpochFake.holdNextBind();
    const ticket = beginJournalSave("s3", "/d.md", "x", { saveType: "manual" });
    store().setFilePath("s3", "/d.md"); // its post-save state, as saveToPath applies it before recording
    const before = agentJournalFake.captureSaveToJournal.mock.calls.length;
    const recorded = ticket.record();
    await new Promise((r) => setTimeout(r, 0));
    expect(agentJournalFake.captureSaveToJournal.mock.calls.length).toBe(before);
    release();
    await recorded;
    expect(captures().at(-1)?.docKey).toBe("path:/d.md");
  });

  // Two Save As from one path in flight at once: the later submission owns
  // the tab (saveTargetClaim), so the earlier one wrote a copy and must not
  // move the tab's document; the winner moves it from wherever it is now.
  it.each([
    ["the copy records first", false],
    ["the winner records first", true],
  ])("concurrent Save As to two paths bind the tab's document once, to the path it ends on (%s)", async (_label, winnerFirst) => {
    store().initDocument("s6", "x", "/j.md");
    rememberJournalBasis("s6", "path:/j.md", "rev-j");
    const copy = beginJournalSave("s6", "/k.md", "x", { saveType: "manual" });
    const winner = beginJournalSave("s6", "/l.md", "x", { saveType: "manual" });
    const recordWinner = async () => {
      store().setFilePath("s6", "/l.md");
      await winner.record();
    };
    if (winnerFirst) await recordWinner();
    await copy.record();
    if (!winnerFirst) await recordWinner();
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([["path:/j.md", "path:/l.md", null]]);
    expect(captures().find((c) => c.docKey === "path:/l.md")?.observedParent).toEqual({ ref: "revision", revision: "rev-j" });
  });

  it("a Save As recorded after the tab's key already moved binds from where the document is now", async () => {
    store().initDocument("s7", "x", "/m.md");
    const first = beginJournalSave("s7", "/n.md", "x", { saveType: "manual" });
    store().setFilePath("s7", "/n.md");
    await first.record();
    const second = beginJournalSave("s7", "/o.md", "x", { saveType: "manual" });
    store().setFilePath("s7", "/o.md");
    await second.record();
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([
      // m carried no document: the bind names that (a lookup), and the journal mints one at n.
      ["path:/m.md", "path:/n.md", null],
      // The capture at n named its document: the onward bind compares and sets on it.
      ["path:/n.md", "path:/o.md", "path:/n.md"],
    ]);
  });

  it("a rename landing while a Save As is in flight: the Save As moves the document from the renamed key", async () => {
    store().initDocument("s8", "x", "/p.md");
    const ticket = beginJournalSave("s8", "/r.md", "x", { saveType: "manual" });
    // The rename's session sync, as provenanceSessions runs it.
    store().setFilePath("s8", "/q.md");
    await bindJournalDocument("path:/p.md", "path:/q.md");
    carryJournalBasis("s8", "path:/p.md", "path:/q.md");
    store().setFilePath("s8", "/r.md");
    await ticket.record();
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([
      ["path:/p.md", "path:/q.md", null],
      // The lookup names the document the rename minted at q.
      ["path:/q.md", "path:/r.md", "path:/q.md"],
    ]);
  });

  it("binds nothing for a cancelled Save As, a save to the tab's own path, or an unknown tab", async () => {
    store().initDocument("s4", "x", "/e.md");
    beginJournalSave("s4", "/f.md", "x", { saveType: "manual" }).cancel();
    await beginJournalSave("s4", "/e.md", "x", { saveType: "manual" }).record();
    await beginJournalSave("ghost", "/g.md", "x", { saveType: "manual" }).record();
    await new Promise((r) => setTimeout(r, 0));
    expect(agentJournalEpochFake.bindDocument).not.toHaveBeenCalled();
  });

  it("a failed bind sends no capture, keeps the basis on the source and invalidates the window; the next save rebinds from the source", async () => {
    store().initDocument("s5", "x", "/h.md");
    rememberJournalBasis("s5", "path:/h.md", "rev-h");
    agentJournalEpochFake.setDocument("path:/h.md", "doc-h");
    noteJournalDocument("path:/h.md", "doc-h");
    const settled: string[] = [];
    registerUnsavedProvenanceSource("s5", {
      freeze: (): ProvenanceFreeze => ({ touched: true, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(), payload: async () => null, recorded: (id) => void (settled.length === 0 && settled.push(`recorded:${id}`)), invalidate: () => void (settled.length === 0 && settled.push("invalidated")), release: () => void (settled.length === 0 && settled.push("released")) }), // the first settlement wins
      fork: () => ({ recorded: () => {}, invalidate: () => {} }),
    });
    agentJournalEpochFake.failNextBinds(1);
    const ticket = beginJournalSave("s5", "/i.md", "x", MANUAL);
    store().setFilePath("s5", "/i.md");
    expect(await ticket.record()).toEqual({ journaled: "no", revision: null, reason: "JOURNAL_IO" });
    expect(captures()).toEqual([]);
    expect(settled).toEqual(["invalidated"]);
    expect(journalObservedBase("s5", "path:/h.md")).toEqual({ ref: "revision", revision: "rev-h" });
    expect(journalObservedBase("s5", "path:/i.md")).toBeNull();
    expect(unbound()).toEqual({ "path:/i.md": true });
    // An ordinary save of the file the tab now holds retries the move from the source.
    const again = await beginJournalSave("s5", "/i.md", "xy", MANUAL).record();
    expect(binds()).toEqual([["path:/h.md", "path:/i.md", "doc-h"], ["path:/h.md", "path:/i.md", "doc-h"]]);
    expect(again.journaled).not.toBe("no");
    expect(captures()).toHaveLength(1);
    expect(captures()[0]).toMatchObject({ docKey: "path:/i.md", observedParent: { ref: "revision", revision: "rev-h" } });
    expect(unbound()).toEqual({});
  });

  it("while binds keep failing every save is reported not recorded, nothing is captured and the suspension stays", async () => {
    store().initDocument("s9", "x", "/w.md");
    agentJournalEpochFake.setDocument("path:/w.md", "doc-w");
    noteJournalDocument("path:/w.md", "doc-w");
    agentJournalEpochFake.failNextBinds(4);
    const first = beginJournalSave("s9", "/y.md", "x", MANUAL);
    store().setFilePath("s9", "/y.md");
    const outcomes = [await first.record()];
    for (const text of ["x1", "x2", "x3"]) outcomes.push(await beginJournalSave("s9", "/y.md", text, MANUAL).record());
    expect(outcomes.map((o) => o.journaled)).toEqual(["no", "no", "no", "no"]);
    expect(outcomes.map((o) => o.reason)).toEqual(["JOURNAL_IO", "JOURNAL_IO", "JOURNAL_IO", "JOURNAL_IO"]);
    expect(binds()).toHaveLength(4);
    expect(captures()).toEqual([]);
    expect(unbound()).toEqual({ "path:/y.md": true });
  });

  it("a Save As onward from a key whose bind failed moves the document from the original source, never from the failed key", async () => {
    store().initDocument("s12", "x", "/p1.md");
    rememberJournalBasis("s12", "path:/p1.md", "rev-p1");
    agentJournalEpochFake.failNextBinds(1);
    const failed = beginJournalSave("s12", "/p2.md", "x", MANUAL);
    store().setFilePath("s12", "/p2.md");
    await failed.record();
    const onward = beginJournalSave("s12", "/p3.md", "x", MANUAL);
    store().setFilePath("s12", "/p3.md");
    await onward.record();
    expect(binds()).toEqual([["path:/p1.md", "path:/p2.md", null], ["path:/p1.md", "path:/p3.md", null]]);
    expect(captures()).toHaveLength(1);
    expect(captures()[0]).toMatchObject({ docKey: "path:/p3.md", observedParent: { ref: "revision", revision: "rev-p1" } });
    expect(unbound()["path:/p3.md"]).toBeUndefined();
  });

  it("the suspension outlives the tab: a tab reopening the file rebinds from the source before its first capture", async () => {
    store().initDocument("s10", "x", "/u.md");
    agentJournalEpochFake.setDocument("path:/u.md", "doc-u");
    noteJournalDocument("path:/u.md", "doc-u");
    agentJournalEpochFake.failNextBinds(1);
    const ticket = beginJournalSave("s10", "/v.md", "x", MANUAL);
    store().setFilePath("s10", "/v.md");
    await ticket.record();
    store().removeDocument("s10");
    releaseTabJournal("s10");
    expect(unbound()).toEqual({ "path:/v.md": true });
    store().initDocument("s11", "x", "/v.md");
    const out = await beginJournalSave("s11", "/v.md", "x", MANUAL).record();
    expect(out.journaled).not.toBe("no");
    expect(binds()).toEqual([["path:/u.md", "path:/v.md", "doc-u"], ["path:/u.md", "path:/v.md", "doc-u"]]);
    expect(captures().map((c) => c.docKey)).toEqual(["path:/v.md"]);
    const rebind = agentJournalEpochFake.bindDocument.mock.invocationCallOrder[1];
    expect(rebind).toBeLessThan(agentJournalFake.captureSaveToJournal.mock.invocationCallOrder[0]);
    expect(unbound()).toEqual({});
  });

  it("the first capture after the gap carries no certified map (a provenance barrier)", async () => {
    const stop = startProvenanceSessions();
    try {
      const owner = {};
      const edit = (before: string, text: string) => {
        const s = provenanceSessionFor("s13")!;
        const at = before.length;
        s.attach(owner, s.openView(owner), "source").edit(before, [{ fromA: at, toA: at, fromB: at, toB: at + text.length }], before + text);
        store().setEditorContent("s13", before + text);
      };
      store().initDocument("s13", "", "/q1.md");
      agentJournalEpochFake.setDocument("path:/q1.md", "doc-q1");
      noteJournalDocument("path:/q1.md", "doc-q1");
      // The session's move and the save's own retry both fail.
      agentJournalEpochFake.failNextBinds(2);
      const moved = beginJournalSave("s13", "/q2.md", "", MANUAL);
      store().setFilePath("s13", "/q2.md");
      expect((await moved.record()).journaled).toBe("no");
      edit("", "a");
      expect((await beginJournalSave("s13", "/q2.md", "a", MANUAL).record()).journaled).toBe("no");
      edit("a", "b");
      const out = await beginJournalSave("s13", "/q2.md", "ab", MANUAL).record();
      expect(out.journaled).not.toBe("no");
      expect(captures()).toHaveLength(1);
      expect(captures()[0]).toMatchObject({ docKey: "path:/q2.md", postimage: "ab", provenance: null });
      // Nothing armed on the destination before the bind that landed.
      const landed = Math.max(...agentJournalEpochFake.bindDocument.mock.invocationCallOrder);
      const arms = agentJournalEpochFake.armEpoch.mock.calls.map(([key], i) => [key, agentJournalEpochFake.armEpoch.mock.invocationCallOrder[i]] as const);
      expect(arms.filter(([key, order]) => key === "path:/q2.md" && order < landed)).toEqual([]);
    } finally {
      stop();
    }
  });
});
