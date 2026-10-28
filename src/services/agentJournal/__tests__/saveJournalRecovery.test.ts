// @vitest-environment node
// WI-AL1.6 — recovering from a failed Save As bind (ADR-AL7): saves submitted while recording is suspended chain on one another at the destination, as any outstanding saves do, and a recovery never binds a source whose original document another tab has since moved elsewhere
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));

import { useDocumentStore } from "@/stores/documentStore";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { agentJournalFake } from "@/test/agentJournalFake";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { noteJournalDocument } from "../documentBinding";
import { rememberJournalBasis } from "../documentIdentity";
import { beginJournalSave } from "../saveJournal";
import { resetUnsavedProvenanceSources } from "../unsavedProvenance";

const store = () => useDocumentStore.getState();
const captures = () => agentJournalFake.captureSaveToJournal.mock.calls.map((c) => c[0]);
const binds = () => agentJournalEpochFake.bindDocument.mock.calls;
const MANUAL = { saveType: "manual" } as const;

beforeEach(() => useDocumentStore.setState({ documents: {} }));
afterEach(() => resetUnsavedProvenanceSources());

describe("recovery saves after a failed Save As bind", () => {
  it("two saves submitted during the suspension chain: the second names what the first recorded", async () => {
    store().initDocument("r1", "x", "/ra.md");
    rememberJournalBasis("r1", "path:/ra.md", "r0");
    agentJournalEpochFake.setDocument("path:/ra.md", "doc-ra");
    noteJournalDocument("path:/ra.md", "doc-ra");
    agentJournalEpochFake.failNextBinds(1);
    const failed = beginJournalSave("r1", "/rb.md", "x", MANUAL);
    store().setFilePath("r1", "/rb.md");
    expect((await failed.record()).journaled).toBe("no");
    const second = beginJournalSave("r1", "/rb.md", "x1", MANUAL);
    const third = beginJournalSave("r1", "/rb.md", "x2", MANUAL);
    const out = await second.record();
    await third.record();
    expect(out.journaled).not.toBe("no");
    expect(captures()).toHaveLength(2);
    expect(captures()[0].observedParent).toEqual({ ref: "revision", revision: "r0" });
    expect(captures()[1].observedParent).not.toEqual({ ref: "revision", revision: "r0" });
    expect(captures()[1].observedParent).toEqual(out.revision === null ? expect.anything() : { ref: "revision", revision: out.revision });
  });

  it("never rebinds a source whose document another tab moved elsewhere meanwhile", async () => {
    store().initDocument("t1", "x", "/sa.md");
    store().initDocument("t2", "x", "/sa.md");
    agentJournalEpochFake.failNextBinds(1);
    const failed = beginJournalSave("t1", "/sb.md", "x", MANUAL);
    store().setFilePath("t1", "/sb.md");
    expect((await failed.record()).journaled).toBe("no");
    // The other tab of the same file moves the document to C.
    const moved = beginJournalSave("t2", "/sc.md", "x", MANUAL);
    store().setFilePath("t2", "/sc.md");
    expect((await moved.record()).journaled).not.toBe("no");
    // Tab 1's next save would recover A → B, carrying whatever A holds now.
    const retry = await beginJournalSave("t1", "/sb.md", "x1", MANUAL).record();
    expect(retry.journaled).toBe("no");
    expect(binds()).toEqual([["path:/sa.md", "path:/sb.md", null], ["path:/sa.md", "path:/sc.md", null]]);
    expect(captures().map((c) => c.docKey)).toEqual(["path:/sc.md"]);
    expect(useJournalRecordingStore.getState().unbound["path:/sb.md"]).toBe(true);
  });
});
