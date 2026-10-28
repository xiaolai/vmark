// WI-AL1.3, WI-AL1.4 — document.write and the agent edit ledger's pending provenance: the tab's window is frozen at the exact preimage before the prepare and its certified map (and whether a person touched it) rides the prepare (null and untouched with no collector, so the baseline is snapshot-only); the apply forks the window onto the applied text so the agent's change is never certified as a person's, recorded at the committed revision and invalidated when the commit is refused; an abort records the freeze at the baseline its prepare recorded; an evicted basis refuses STALE_PARENT before anything is sent; and every refused prepare answers its token with content and revision untouched and the freeze invalidated. AL2.2g: a clean (not admitted) refusal releases the freeze instead; a journal that stays unavailable is retried once, abandoned, and the freeze invalidated.
//
// A real Tiptap editor and the real stores; the journal transport is the
// wire fake (src/test/agentJournalWireFake.ts) over the in-memory journal
// (src/test/agentJournalFake.ts) with the writer's semantics.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stubProvenancePayload } from "@/test/provenancePayloadFixture";
import type { ProvenancePayload } from "@/services/agentJournal/provenance/payload";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/agentJournal/journalTransport", () =>
  import("@/test/agentJournalWireFake").then((m) => m.journalTransportModule()),
);

import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { JOURNAL_IDENTITY_BUDGET, rememberJournalBasis, resetJournalBases } from "@/services/agentJournal/documentIdentity";
import type { JournalCode } from "@/services/agentJournal/journalRefusal";
import {
  registerUnsavedProvenanceSource,
  resetUnsavedProvenanceSources,
  type UnsavedProvenanceSource,
} from "@/services/agentJournal/unsavedProvenance";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { abandonSpy } from "@/test/agentJournalWireFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const MAP = stubProvenancePayload();
let editor: Editor | null = null;

function tab(id: string, filePath: string | null = null): DocumentTab {
  return { kind: "document", id, filePath, title: id, isPinned: false, formatId: "markdown" };
}

function seed(tabs: DocumentTab[], focused: string): void {
  useTabStore.setState({ tabs: { main: tabs }, activeTabId: { main: focused }, untitledCounter: 0 });
  for (const t of tabs) useDocumentStore.getState().initDocument(t.id, "old document\n", t.filePath);
}

type Call = { call: string; text: string | null; journalOps: number };

/** A provenance source stand-in that records every freeze, fork and effective settlement (the first one wins, as in the real session), in order, with the journal log length. */
function collector(map: ProvenancePayload | null = MAP, touched = true) {
  const calls: Call[] = [];
  const at = (call: string, text: string | null) => calls.push({ call, text, journalOps: fake.log.length });
  const once = (prefix: string) => {
    let done = false;
    return (what: string, id: string | null) => {
      if (!done) at(`${prefix}.${what}`, id);
      done = true;
    };
  };
  const source: UnsavedProvenanceSource = {
    freeze: (buffer) => {
      at("freeze", buffer);
      const settle = once("freeze");
      return {
        touched, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(),
        payload: async (expected) => {
          at("payload", expected);
          return map && { basis: expected ?? "genesis", payload: map };
        },
        recorded: (id) => settle("recorded", id),
        invalidate: () => settle("invalidate", null),
        release: () => settle("release", null),
      };
    },
    fork: (text) => {
      at("fork", text);
      const settle = once("fork");
      return { recorded: (id) => settle("recorded", id), invalidate: () => settle("invalidate", null) };
    },
  };
  registerUnsavedProvenanceSource("t1", source);
  return calls;
}

const settles = (calls: Call[]) => calls.filter((c) => c.call.includes(".")).map((c) => [c.call, c.text]);

function reply(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}

function refusal(requestId: string): Record<string, unknown> {
  const r = reply(requestId);
  expect(r.success).toBe(false);
  return JSON.parse(r.error ?? "null") as Record<string, unknown>;
}

const content = (tabId: string) => useDocumentStore.getState().documents[tabId]?.content;
const revision = (tabId: string) => useRevisionStore.getState().getRevision(tabId);
const write = (id: string, args: Record<string, unknown>) =>
  handleDocumentWrite(id, { save: false, ...args }, TEST_WRITE_CONTEXT);
const prepareInput = (n: number) => fake.prepareControlledWrite.mock.calls[n][0];
const prepared = (n: number) => fake.prepareControlledWrite.mock.results[n].value;

async function raceDuringPrepare(id: string, args: Record<string, unknown>, race: () => void) {
  const calls = fake.prepareControlledWrite.mock.calls.length;
  fake.holdNextPrepare();
  const pending = write(id, args);
  await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(calls + 1));
  race();
  fake.release();
  await pending;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  resetUnsavedProvenanceSources();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  registerWysiwygFlusher("t1", null);
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setTiptapEditor(null);
  editor?.destroy();
  editor = null;
});

describe("document.write — frozen provenance (R22)", () => {
  it("with no collector the prepare carries no map and no touch: the baseline is snapshot-only", async () => {
    seed([tab("t1")], "t1");
    await write("p1", { content: "AI\n" });
    expect(prepareInput(0)).toMatchObject({ baselineProvenance: null, baselineTouched: false });
    expect(reply("p1").success).toBe(true);
  });

  it("freezes the exact buffer before the prepare and sends its map for the tab's basis", async () => {
    seed([tab("t1")], "t1");
    useDocumentStore.getState().setEditorContent("t1", "user typed 日本語\n");
    const calls = collector();
    await write("p2", { content: "AI\n" });
    expect(prepareInput(0)).toMatchObject({ baselineProvenance: MAP, baselineTouched: true });
    expect(calls.slice(0, 2)).toEqual([
      { call: "freeze", text: "user typed 日本語\n", journalOps: 0 },
      { call: "payload", text: null, journalOps: 0 },
    ]);
    expect((await prepared(0)).baseline).not.toBeNull();
  });

  it("an untouched window sends baselineTouched false; an empty buffer is frozen as the empty string", async () => {
    seed([tab("t1")], "t1");
    useDocumentStore.getState().setEditorContent("t1", "");
    const calls = collector(null, false);
    await write("p3", { content: "AI\n" });
    expect(calls[0]).toMatchObject({ call: "freeze", text: "" });
    expect(prepareInput(0)).toMatchObject({ baselineProvenance: null, baselineTouched: false });
  });

  it("an evicted basis refuses STALE_PARENT before anything is sent, and the retry rebases", async () => {
    seed([tab("t1", "/a.md")], "t1");
    for (let i = 0; i <= JOURNAL_IDENTITY_BUDGET; i++) rememberJournalBasis(i === 0 ? "t1" : `x${i}`, "path:/a.md", "rev-old");
    const calls = collector();
    await write("p4", { content: "AI\n" });
    expect(refusal("p4")).toMatchObject({ error: "STALE_PARENT" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    await write("p5", { content: "AI\n" });
    expect(reply("p5").success).toBe(true);
    expect(prepareInput(0).parent).toBeNull();
  });
});

describe("document.write — synchronization echo", () => {
  it("forks onto the applied text after the prepare, once, and records the committed revision", async () => {
    seed([tab("t1")], "t1");
    const calls = collector();
    await write("e1", { content: "AI\n" });
    expect(calls.filter((c) => c.call === "fork")).toEqual([{ call: "fork", text: "AI\n", journalOps: 1 }]);
    const revision = (await prepared(0)).revision;
    expect(settles(calls)).toEqual([["fork.recorded", revision], ["freeze.invalidate", null]]);
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
  });

  it("forks onto the live editor's canonical serialization, the text the commit records", async () => {
    seed([tab("t1")], "t1");
    editor = new Editor({ extensions: [StarterKit], content: "<p>old document</p>" });
    useEditorStore.getState().setTiptapEditor(editor);
    useEditorStore.getState().setActiveWysiwygEditor(editor, "t1");
    const live = editor;
    registerWysiwygFlusher("t1", () => {
      useDocumentStore.getState().setEditorContent("t1", serializeMarkdown(live.schema, live.state.doc));
    });
    const calls = collector();
    await write("e2", { content: "# Title\n\n\n\nbody" });
    const forked = calls.find((x) => x.call === "fork")?.text;
    expect(forked).toBe(content("t1"));
    expect(fake.log[1]).toMatchObject({ op: "commit", detail: forked });
  });

  it("the next write records no baseline for the agent's own text: each mutation counts once", async () => {
    seed([tab("t1", "/a.md")], "t1");
    await write("e3", { content: "AI\n" });
    await write("e4", { content: "AI again\n" });
    expect(prepareInput(1).preimage).toBe("AI\n");
    expect((await prepared(1)).baseline).toBeNull();
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit", "prepare", "commit"]);
  });

  it("a refused commit invalidates the fork: the agent's text is not a basis to certify against", async () => {
    seed([tab("t1")], "t1");
    const calls = collector();
    fake.refuseNextCommits();
    await write("e5", { content: "AI\n" });
    expect(settles(calls)).toContainEqual(["fork.invalidate", null]);
  });

  it("a queued commit still records the fork at its revision", async () => {
    seed([tab("t1")], "t1");
    const calls = collector();
    fake.failNextCommits();
    await write("e6", { content: "AI\n" });
    expect(settles(calls)).toContainEqual(["fork.recorded", (await prepared(0)).revision]);
  });

  it("an abort records the freeze at the baseline its prepare recorded, and invalidates it without one", async () => {
    seed([tab("t1")], "t1");
    const calls = collector();
    useDocumentStore.getState().setEditorContent("t1", "typed\n");
    await raceDuringPrepare("a1", { content: "AI\n" }, () =>
      useDocumentStore.getState().setEditorContent("t1", "typed more\n"),
    );
    expect(refusal("a1")).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(settles(calls)).toEqual([["freeze.recorded", (await prepared(0)).baseline]]);
    calls.length = 0;
    const untouched = collector(MAP, false);
    useDocumentStore.getState().setEditorContent("t1", "typed\n");
    await raceDuringPrepare("a2", { content: "AI\n" }, () =>
      useDocumentStore.getState().setEditorContent("t1", "typed again\n"),
    );
    expect(refusal("a2")).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(settles(untouched).at(-1)?.[0]).toMatch(/^freeze\./);
  });
});

describe("document.write — refused prepares change nothing", () => {
  // A clean refusal (the request was not admitted) releases the freeze; a
  // journal that stays unavailable is uncertain: retried once, abandoned, and
  // the freeze invalidated.
  const cases: Array<[JournalCode, string, number, "freeze.release" | "freeze.invalidate"]> = [
    ["STALE_PARENT", "STALE_PARENT", 1, "freeze.release"],
    ["JOURNAL_BUSY", "JOURNAL_BUSY", 1, "freeze.release"],
    ["JOURNAL_DEGRADED", "JOURNAL_DEGRADED", 1, "freeze.release"],
    ["JOURNAL_UNAVAILABLE", "JOURNAL_UNAVAILABLE", 2, "freeze.invalidate"],
    ["INVALID_REQUEST", "INTERNAL", 1, "freeze.release"],
  ];
  it.each(cases)("%s answers %s with content and revision untouched, after %i prepare(s): %s", async (code, answer, sends, settled) => {
    seed([tab("t1")], "t1");
    useDocumentStore.getState().setEditorContent("t1", "typed\n");
    const calls = collector();
    const before = { content: content("t1"), revision: revision("t1") };
    fake.refuseNextPrepares(...Array.from({ length: sends }, () => code));
    await write("r1", { content: "AI\n" });
    expect(refusal("r1")).toMatchObject({ error: answer });
    expect({ content: content("t1"), revision: revision("t1") }).toEqual(before);
    expect(calls.map((x) => x.call)).toEqual(["freeze", "payload", settled]);
    expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(sends);
    expect(abandonSpy).toHaveBeenCalledTimes(sends - 1);
    expect(fake.log.map((e) => e.op)).toEqual([]);
    expect(fake.doc(`tab:main/t1`)).toMatchObject({ head: null, text: "", reservedBy: null });
  });
});
