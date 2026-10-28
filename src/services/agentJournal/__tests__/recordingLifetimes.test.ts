// @vitest-environment node
// WI-AL1.7 — the "history not recorded" entries are bounded by document lifetime: an entry is kept only while its document key is open in a tab or a save to it is outstanding; two tabs of one file share the key until the last closes; a cancelled save releases its key; Save As drops the abandoned key; and an outcome from a retired incarnation of a key never recreates its entry or touches the document reopened under it | AL2.2g: the write's prepare is the request spec the coordinator sends
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { controlledPrepare, type CapturedSave, type CommittedTxn } from "../journalClient";
import { journalActorFor } from "../journalActor";
import { beginJournalSave } from "../saveJournal";
import { runJournaledMutation, type JournaledOutcome } from "../journaledMutation";
import { journalTabLife, resetJournalBases } from "../documentIdentity";
import { resetUnsavedProvenanceSources } from "../unsavedProvenance";
import { resetRecordingLifetimes, sameOpenFiles, startRecordingLifetimes, trackedRecordingKeys } from "../recordingReport";
import { beginRecordingSubmission, useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { SaveOrigin } from "@/services/persistence/saveOutcome";

const MANUAL: SaveOrigin = { saveType: "manual" };
const key = (path: string) => `path:${path}`;
const docs = () => useJournalRecordingStore.getState().docs;
const problem = (path: string) => docs()[key(path)]?.problem;
const open = (tab: string, path: string) => useDocumentStore.getState().initDocument(tab, "", path);
const close = (tab: string) => useDocumentStore.getState().removeDocument(tab);
const save = (tab: string, path: string, content: string) => beginJournalSave(tab, path, content, MANUAL).record();

/** The next save capture waits until the test answers it (once it has been asked). */
function holdNextCapture(): (answer: CapturedSave) => Promise<void> {
  let answer: ((v: CapturedSave) => void) | null = null;
  fake.captureSaveToJournal.mockImplementationOnce(() => new Promise((r) => (answer = r)));
  return async (v) => {
    await vi.waitFor(() => expect(answer).not.toBeNull());
    answer!(v);
  };
}

/** The next controlled-write commit waits until the test answers it. */
function holdNextCommit(): (ack: CommittedTxn) => void {
  let answer: (v: CommittedTxn) => void = () => {};
  fake.commitControlledWrite.mockImplementationOnce(() => new Promise((r) => (answer = r)));
  return (v) => answer(v);
}

/** An agent write to `path` from a tab of its own (the outcome is reported under the key, not the tab). */
function agentWrite(path: string, text: string) {
  return runJournaledMutation({
    tabId: "agent",
    life: journalTabLife("agent"),
    docKey: key(path),
    preimage: "",
    retryHint: "retry",
    prepare: (b) => controlledPrepare({ ...b, actor: journalActorFor(TEST_ATTRIBUTION), tool: "document.write" }),
    verify: () => null,
    apply: () => ({ postimage: text, value: null }),
    recover: () => text,
    outcome: (o: JournaledOutcome<null>) => o,
  });
}

let stop: () => void = () => {};
beforeEach(() => {
  fake.reset();
  resetJournalBases();
  useJournalRecordingStore.getState().reset();
  useDocumentStore.setState({ documents: {} });
  resetRecordingLifetimes();
  stop = startRecordingLifetimes();
});
afterEach(() => {
  stop();
  resetUnsavedProvenanceSources();
});

describe("entries live as long as their document", () => {
  it("repeated open → failed save → close cycles retain nothing", async () => {
    for (let i = 0; i < 40; i++) {
      const path = `/notes/第${i}章.md`;
      open(`t${i}`, path);
      fake.refuseNextCaptures("JOURNAL_UNAVAILABLE");
      await save(`t${i}`, path, `text ${i}`);
      expect(problem(path)).toEqual({ kind: "refused", code: "JOURNAL_UNAVAILABLE" });
      close(`t${i}`);
    }
    expect(docs()).toEqual({});
    expect(trackedRecordingKeys()).toBe(0);
  });

  it("successful saves of closed documents are not kept either", async () => {
    for (let i = 0; i < 10; i++) {
      open("t", `/d${i}.md`);
      await save("t", `/d${i}.md`, "x");
      close("t");
    }
    expect(docs()).toEqual({});
  });

  it("two tabs of one file share its key until the last one closes", async () => {
    open("t1", "/a.md");
    open("t2", "/a.md");
    fake.refuseNextCaptures("JOURNAL_UNAVAILABLE");
    await save("t1", "/a.md", "x");
    close("t1");
    expect(problem("/a.md")).toEqual({ kind: "refused", code: "JOURNAL_UNAVAILABLE" });
    close("t2");
    expect(docs()).toEqual({});
  });

  it("an open document keeps its entry", async () => {
    open("t", "/a.md");
    fake.failNextCaptures(1);
    await save("t", "/a.md", "x");
    open("other", "/b.md"); // an unrelated tab change sweeps nothing open
    expect(problem("/a.md")).toEqual({ kind: "queued", code: null });
  });
});

describe("outstanding saves", () => {
  it("a cancelled save to a key no tab holds releases it", () => {
    beginJournalSave("t", "/unopened.md", "x", MANUAL).cancel();
    expect(trackedRecordingKeys()).toBe(0);
    expect(docs()).toEqual({});
  });

  it("a cancelled save releases its key once its tab has closed", () => {
    open("t", "/a.md");
    const ticket = beginJournalSave("t", "/a.md", "x", MANUAL);
    close("t");
    expect(trackedRecordingKeys()).toBe(1); // still outstanding
    ticket.cancel();
    expect(trackedRecordingKeys()).toBe(0);
  });

  it("a failure settling after its document closed leaves no entry", async () => {
    open("t", "/a.md");
    const answer = holdNextCapture();
    const out = save("t", "/a.md", "x");
    close("t");
    await answer({ doc: key("/a.md"), journaled: "no", observation: "o", revision: null });
    await out;
    expect(docs()).toEqual({});
    expect(trackedRecordingKeys()).toBe(0);
  });

  it("a late older failure after close, reopen and a newer success does not mark the document", async () => {
    open("t1", "/a.md");
    const answer = holdNextCapture();
    const old = save("t1", "/a.md", "old");
    close("t1");
    open("t2", "/a.md");
    await save("t2", "/a.md", "new");
    expect(problem("/a.md")).toBeNull();
    await answer({ doc: key("/a.md"), journaled: "no", observation: "o", revision: null });
    await old;
    expect(problem("/a.md")).toBeNull();
  });
});

describe("Save As", () => {
  it("drops the abandoned key and reports under the new one", async () => {
    open("t", "/a.md");
    fake.refuseNextCaptures("JOURNAL_UNAVAILABLE");
    await save("t", "/a.md", "x");
    expect(problem("/a.md")).toBeDefined();
    const ticket = beginJournalSave("t", "/b.md", "x", MANUAL);
    useDocumentStore.getState().setFilePath("t", "/b.md"); // the save pipeline moves the tab before recording
    fake.failNextCaptures(1);
    await ticket.record();
    expect(Object.keys(docs())).toEqual([key("/b.md")]);
    expect(problem("/b.md")).toEqual({ kind: "queued", code: null });
  });

  it("a Save As that wrote nothing leaves no entry for its target", () => {
    open("t", "/a.md");
    beginJournalSave("t", "/b.md", "x", MANUAL).cancel();
    expect(docs()[key("/b.md")]).toBeUndefined();
    expect(trackedRecordingKeys()).toBe(0);
  });
});

describe("agent writes from a retired incarnation", () => {
  const notDurable = (path: string): CommittedTxn => ({ doc: key(path), revision: "r", applied: true, durable: false });

  it("a late non-durable outcome never recreates a closed document's entry", async () => {
    open("t", "/a.md");
    const ack = holdNextCommit();
    const write = agentWrite("/a.md", "x");
    await vi.waitFor(() => expect(fake.commitControlledWrite).toHaveBeenCalled());
    close("t");
    ack(notDurable("/a.md"));
    await write;
    expect(docs()).toEqual({});
  });

  it("a late non-durable outcome never marks the document reopened under its key", async () => {
    open("t", "/a.md");
    const ack = holdNextCommit();
    const write = agentWrite("/a.md", "x");
    await vi.waitFor(() => expect(fake.commitControlledWrite).toHaveBeenCalled());
    close("t");
    open("t", "/a.md");
    ack(notDurable("/a.md"));
    await write;
    expect(problem("/a.md")).toBeUndefined();
  });

  it("an agent write to a key no tab holds reports nothing", async () => {
    fake.failNextCommits(1);
    await agentWrite("/never-open.md", "x");
    expect(docs()).toEqual({});
  });
});

describe("the lifetime watcher skips edits", () => {
  const files = (entries: Record<string, string | null>) =>
    Object.fromEntries(Object.entries(entries).map(([tab, filePath]) => [tab, { filePath }]));

  it.each<[string, Record<string, string | null> | null, Record<string, string | null>, boolean]>([
    ["no previous state", null, {}, false],
    ["no tabs, twice", {}, {}, true],
    ["the same tabs and files (an edit)", { t1: "/a.md", t2: null }, { t1: "/a.md", t2: null }, true],
    ["a tab opened", { t1: "/a.md" }, { t1: "/a.md", t2: "/b.md" }, false],
    ["a tab closed", { t1: "/a.md", t2: "/b.md" }, { t1: "/a.md" }, false],
    ["a tab moved (Save As)", { t1: null }, { t1: "/读书笔记.md" }, false],
    ["one tab swapped for another on the same file", { t1: "/a.md" }, { t2: "/a.md" }, false],
  ])("%s", (_case, before, after, same) => {
    expect(sameOpenFiles(before && files(before), files(after))).toBe(same);
  });

  it("answers the same map by identity", () => {
    const m = files({ t1: "/a.md" });
    expect(sameOpenFiles(m, m)).toBe(true);
  });

  it("a document-store change that keeps the open files does not sweep; the next tab change does", () => {
    open("t1", "/a.md");
    // An entry for a key no tab holds and no save awaits: any sweep retires it.
    useJournalRecordingStore.getState().report(key("/幽灵.md"), beginRecordingSubmission(), { kind: "queued", code: null });
    for (let i = 0; i < 3; i++) useDocumentStore.getState().setEditorContent("t1", `edit ${i}`);
    useDocumentStore.setState((s) => ({ documents: { ...s.documents } })); // a new map, same tabs and files
    expect(problem("/幽灵.md")).toEqual({ kind: "queued", code: null });
    open("t2", "/b.md");
    expect(docs()[key("/幽灵.md")]).toBeUndefined();
  });

  it("content edits keep entries; a close after them still retires", async () => {
    open("t1", "/a.md");
    fake.captureSaveToJournal.mockRejectedValueOnce(new Error("journal unavailable"));
    await save("t1", "/a.md", "x");
    expect(problem("/a.md")).toBeDefined();
    for (let i = 0; i < 5; i++) useDocumentStore.getState().setEditorContent("t1", `edit ${i}`);
    expect(problem("/a.md")).toBeDefined();
    close("t1");
    expect(docs()[key("/a.md")]).toBeUndefined();
  });
});
