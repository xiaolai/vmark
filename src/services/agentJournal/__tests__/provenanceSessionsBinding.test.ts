// @vitest-environment node
// WI-AL1.6 — a tab's path change carries its journal document (ADR-AL7): Save As of an untitled tab and an in-app rename bind the old key to the new one, the new session arms only after the bind, an epoch is closed on the document it was armed on, and a new or closed tab binds nothing; a failed bind carries no basis and arms nothing on the destination (nor on a key moved to after it), the tab's state stays on the source, and the destination arms once a bind there lands
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));

import { useDocumentStore } from "@/stores/documentStore";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { bindJournalDocument, journalDocumentReady, noteJournalDocument } from "../documentBinding";
import { journalBasis, rememberJournalBasis } from "../documentIdentity";
import { provenanceSessionFor, startProvenanceSessions } from "../provenanceSessions";

const ins = (at: number, text: string) => [{ fromA: at, toA: at, fromB: at, toB: at + text.length }];
const owner = {};
const store = () => useDocumentStore.getState();
let stop: (() => void) | null = null;

beforeEach(() => useDocumentStore.setState({ documents: {} }));
afterEach(() => {
  stop?.();
  stop = null;
});

function edit(tabId: string, before: string, text: string): void {
  const s = provenanceSessionFor(tabId)!;
  s.attach(owner, s.openView(owner), "source").edit(before, ins(before.length, text), before + text);
  store().setEditorContent(tabId, before + text);
}

describe("provenance sessions across a path change", () => {
  it("binds an untitled tab's key to its Save As path, and a renamed file's old path to its new one", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", null);
    store().setFilePath("t1", "/文档/a.md");
    store().setFilePath("t1", "/文档/b.md");
    // The second bind shares a.md with the first, so it runs once that one lands.
    await journalDocumentReady("path:/文档/b.md");
    await provenanceSessionFor("t1")?.idle();
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([
      // The untitled key carried no document; the second names the one minted at a.md.
      ["tab:main/t1", "path:/文档/a.md", null],
      ["path:/文档/a.md", "path:/文档/b.md", "path:/文档/a.md"],
    ]);
  });

  it("arms the new key only after the bind lands", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", "/a.md");
    const release = agentJournalEpochFake.holdNextBind();
    store().setFilePath("t1", "/b.md");
    edit("t1", "", "x");
    await new Promise((r) => setTimeout(r, 0));
    expect(agentJournalEpochFake.armEpoch).not.toHaveBeenCalledWith("path:/b.md");
    release();
    await new Promise((r) => setTimeout(r, 0));
    await provenanceSessionFor("t1")?.idle();
    expect(agentJournalEpochFake.armEpoch).toHaveBeenCalledWith("path:/b.md");
  });

  it("arms the new key only after the old session's epoch has closed", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", "/a.md");
    edit("t1", "", "x");
    await provenanceSessionFor("t1")!.idle();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const realClose = agentJournalEpochFake.closeEpoch.getMockImplementation()!;
    agentJournalEpochFake.closeEpoch.mockImplementationOnce(async (...args) => {
      await held;
      return realClose(...args);
    });
    store().setFilePath("t1", "/b.md");
    edit("t1", "x", "y");
    await journalDocumentReady("path:/b.md");
    await new Promise((r) => setTimeout(r, 0));
    // The writer keys epochs by document, which the bind carried to b.md: an
    // arm before the close lands would be refused.
    expect(agentJournalEpochFake.armEpoch).not.toHaveBeenCalledWith("path:/b.md");
    release();
    await new Promise((r) => setTimeout(r, 0));
    await provenanceSessionFor("t1")?.idle();
    expect(agentJournalEpochFake.armEpoch).toHaveBeenCalledWith("path:/b.md");
    expect(agentJournalEpochFake.openEpoch("path:/a.md")).toBeNull();
  });

  it("a session moved on again before it armed never arms its old key (A to B held, then B to C)", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", "/a.md");
    edit("t1", "", "x");
    await provenanceSessionFor("t1")!.idle();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const realClose = agentJournalEpochFake.closeEpoch.getMockImplementation()!;
    agentJournalEpochFake.closeEpoch.mockImplementationOnce(async (...args) => {
      await held;
      return realClose(...args);
    });
    store().setFilePath("t1", "/b.md");
    edit("t1", "x", "y"); // B's session wants an epoch, behind A's held close
    store().setFilePath("t1", "/c.md");
    edit("t1", "xy", "z");
    release();
    await journalDocumentReady("path:/c.md");
    await new Promise((r) => setTimeout(r, 0));
    await provenanceSessionFor("t1")?.idle();
    expect(agentJournalEpochFake.armEpoch).not.toHaveBeenCalledWith("path:/b.md");
    expect(agentJournalEpochFake.armEpoch).toHaveBeenCalledWith("path:/c.md");
  });

  it("closes an epoch on the document it was armed on", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", "/a.md");
    edit("t1", "", "x");
    const before = provenanceSessionFor("t1")!;
    await before.idle();
    store().setFilePath("t1", "/b.md");
    await before.idle();
    const armed = await agentJournalEpochFake.armEpoch.mock.results[0].value;
    expect(agentJournalEpochFake.closeEpoch).toHaveBeenCalledWith("path:/a.md", armed.epoch, "path:/a.md");
  });

  it("binds nothing for a new tab, a closed tab or an unrelated update", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "a", "/a.md");
    store().setSelectedText("t1", "a");
    store().removeDocument("t1");
    expect(agentJournalEpochFake.bindDocument).not.toHaveBeenCalled();
  });

  it("a failed bind carries no basis and never arms the destination; a bind that lands there does both", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", "/a.md");
    rememberJournalBasis("t1", "path:/a.md", "rev-a");
    agentJournalEpochFake.setDocument("path:/a.md", "doc-a");
    noteJournalDocument("path:/a.md", "doc-a");
    agentJournalEpochFake.failNextBinds(1);
    store().setFilePath("t1", "/b.md");
    edit("t1", "", "x");
    await journalDocumentReady("path:/b.md");
    await new Promise((r) => setTimeout(r, 0));
    await provenanceSessionFor("t1")?.idle();
    expect(agentJournalEpochFake.armEpoch).not.toHaveBeenCalledWith("path:/b.md");
    expect(journalBasis("t1", "path:/b.md")).toBeNull();
    expect(journalBasis("t1", "path:/a.md")).toBe("rev-a");
    expect(useJournalRecordingStore.getState().unbound).toEqual({ "path:/b.md": true });
    // Recovery (a save retries from the source): the next edit arms on one identity.
    expect(await bindJournalDocument("path:/a.md", "path:/b.md")).toEqual({ ok: true });
    edit("t1", "x", "y");
    await new Promise((r) => setTimeout(r, 0));
    await provenanceSessionFor("t1")?.idle();
    expect(agentJournalEpochFake.armEpoch).toHaveBeenCalledWith("path:/b.md");
    expect(useJournalRecordingStore.getState().unbound).toEqual({});
  });

  it("after a failed bind, moving on again (B to C) binds nothing and arms nothing on C", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", "/a.md");
    rememberJournalBasis("t1", "path:/a.md", "rev-a");
    agentJournalEpochFake.failNextBinds(1);
    store().setFilePath("t1", "/b.md");
    await journalDocumentReady("path:/b.md");
    store().setFilePath("t1", "/c.md");
    edit("t1", "", "z");
    await journalDocumentReady("path:/c.md");
    await new Promise((r) => setTimeout(r, 0));
    await provenanceSessionFor("t1")?.idle();
    expect(agentJournalEpochFake.bindDocument.mock.calls).toEqual([["path:/a.md", "path:/b.md", null]]);
    expect(agentJournalEpochFake.armEpoch).not.toHaveBeenCalledWith("path:/c.md");
    expect(journalBasis("t1", "path:/a.md")).toBe("rev-a");
    expect(useJournalRecordingStore.getState().unbound).toEqual({ "path:/c.md": true });
  });
});
