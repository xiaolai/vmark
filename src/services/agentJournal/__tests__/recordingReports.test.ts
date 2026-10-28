// @vitest-environment node
// WI-AL1.7 — "history not recorded": every save and controlled agent write reports its journal outcome to the recording store under its document key, ordered by submission. A refused capture is refused (with its code), a capture that never answers is a timeout, a capture the journal only queued is queued, a save past the outstanding cap is refused JOURNAL_DEGRADED, a cancelled save reports nothing; a controlled write applied with durable false is queued, a durable one clears the document; an older outcome settling late never overwrites a newer one | AL2.2g: the write's prepare is the request spec the coordinator sends
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { controlledPrepare, type CapturedSave } from "../journalClient";
import { journalActorFor } from "../journalActor";
import { JOURNAL_DEADLINE_MS } from "../journalDeadline";
import { MAX_OUTSTANDING_SAVES, beginJournalSave } from "../saveJournal";
import { runJournaledMutation, type JournaledOutcome } from "../journaledMutation";
import { journalTabLife, resetJournalBases } from "../documentIdentity";
import { resetUnsavedProvenanceSources } from "../unsavedProvenance";
import { resetRecordingLifetimes } from "../recordingReport";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { SaveOrigin } from "@/services/persistence/saveOutcome";

const PATH = "/notes/读书笔记.md";
const KEY = `path:${PATH}`;
const TAB = "tab-1";
const MANUAL: SaveOrigin = { saveType: "manual" };

const problem = (key = KEY) => useJournalRecordingStore.getState().docs[key]?.problem;
const save = (content: string) => beginJournalSave(TAB, PATH, content, MANUAL).record();

function agentWrite(text: string) {
  return runJournaledMutation({
    tabId: TAB,
    life: journalTabLife(TAB),
    docKey: KEY,
    preimage: "",
    retryHint: "retry",
    prepare: (b) => controlledPrepare({ ...b, actor: journalActorFor(TEST_ATTRIBUTION), tool: "document.write" }),
    verify: () => null,
    apply: () => ({ postimage: text, value: null }),
    recover: () => text,
    outcome: (o: JournaledOutcome<null>) => o,
  });
}

beforeEach(() => {
  fake.reset();
  resetJournalBases();
  useJournalRecordingStore.getState().reset();
  resetRecordingLifetimes();
  // An entry is kept only for an open document (recordingLifetimes.test.ts).
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, "", PATH);
});
afterEach(() => {
  vi.useRealTimers();
  resetUnsavedProvenanceSources();
});

describe("save outcomes", () => {
  it("a recorded save leaves the document clean", async () => {
    await save("a");
    expect(problem()).toBeNull();
  });

  it("a refused capture is reported refused with its code", async () => {
    fake.refuseNextCaptures("JOURNAL_UNAVAILABLE");
    await save("a");
    expect(problem()).toEqual({ kind: "refused", code: "JOURNAL_UNAVAILABLE" });
  });

  it("a capture the journal only queued is reported queued", async () => {
    fake.failNextCaptures(1);
    await save("a");
    expect(problem()).toEqual({ kind: "queued", code: null });
  });

  it("a later recorded save clears an earlier failure", async () => {
    fake.refuseNextCaptures("JOURNAL_UNAVAILABLE");
    await save("a");
    await save("ab");
    expect(problem()).toBeNull();
  });

  it("a cancelled save reports nothing", async () => {
    beginJournalSave(TAB, PATH, "a", MANUAL).cancel();
    await Promise.resolve();
    expect(useJournalRecordingStore.getState().docs[KEY]).toBeUndefined();
  });

  it("a save past the outstanding cap is reported refused JOURNAL_DEGRADED", async () => {
    // The held saves are never recorded, so none of them reaches a capture.
    const held = Array.from({ length: MAX_OUTSTANDING_SAVES }, (_, i) => beginJournalSave(TAB, PATH, `t${i}`, MANUAL));
    const over = await beginJournalSave(TAB, PATH, "over", MANUAL).record();
    expect(over.reason).toBe("JOURNAL_DEGRADED");
    expect(problem()).toEqual({ kind: "refused", code: "JOURNAL_DEGRADED" });
    held.forEach((t) => t.cancel());
    expect(fake.captureSaveToJournal).not.toHaveBeenCalled();
  });

  it("a later agent write waits for the earlier save in flight, and the earlier save's report does not overwrite it", async () => {
    let answer: (v: CapturedSave) => void = () => {};
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const firstOut = save("a");
    await vi.waitFor(() => expect(fake.captureSaveToJournal).toHaveBeenCalledTimes(1));
    fake.failNextCommits(1);
    const written = agentWrite("x");
    // One macrotask turn drains every microtask: an unwaited path reaches the asserted call within it.
    await new Promise((resolve) => setImmediate(resolve));
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    fake.doc(KEY).head = "r";
    answer({ doc: KEY, journaled: "yes", observation: null, revision: "r" });
    await firstOut;
    expect(await written).toMatchObject({ status: "applied", durable: false });
    expect(problem()).toEqual({ kind: "queued", code: null });
  });
});

describe("the save deadline", () => {
  beforeEach(() => vi.useFakeTimers());

  it("a capture that never answers is reported as a timeout", async () => {
    fake.captureSaveToJournal.mockImplementationOnce(() => new Promise(() => {}));
    const record = save("a");
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await record;
    expect(problem()).toEqual({ kind: "timeout", code: "JOURNAL_TIMEOUT" });
  });
});

describe("controlled agent writes", () => {
  it("a durable commit leaves the document clean", async () => {
    await agentWrite("x");
    expect(problem()).toBeNull();
  });

  it("an applied write whose commit was not durable is reported queued", async () => {
    fake.failNextCommits(1);
    const out = await agentWrite("x");
    expect(out).toMatchObject({ status: "applied", durable: false });
    expect(problem()).toEqual({ kind: "queued", code: null });
  });

  it("a refused prepare applies nothing and reports nothing", async () => {
    fake.refuseNextPrepares("JOURNAL_BUSY");
    await agentWrite("x");
    expect(useJournalRecordingStore.getState().docs[KEY]).toBeUndefined();
  });
});
