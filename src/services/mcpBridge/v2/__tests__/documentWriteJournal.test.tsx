// WI-AL1.3 — vmark.document.write on the controlled-mutation protocol, end to end against a real editor. While prepare is held: a user edit, closing the tab, starting an IME composition, moving the selection, or switching the focused tab under an implicit-target write each end ABORTED with nothing mutated (store, editor, revision, journal commits). Two windows on one file: exactly one is applied, the other JOURNAL_BUSY; a window that missed a commit is STALE_PARENT and rebases on retry. A commit failure answers applied with durable false; the degraded queue refuses JOURNAL_DEGRADED until drained; a failed aborted append keeps the reservation and recovers once its retry lands. Lone surrogates are INVALID_TEXT before any prepare; the revision actor is the request's MCP context; the prepare carries the declared script of the buffer and the written content (WI-AL2.1b).
//
// A real Tiptap editor and the real stores; the journal IPC client is the
// in-memory fake (src/test/agentJournalFake.ts) with the writer's semantics.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { useUIStore } from "@/stores/uiStore";
import { markContentApplied } from "@/services/editor/contentApplied";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { journalActorFor } from "@/services/agentJournal/journalActor";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { declaredScriptCertificate } from "@/services/agentJournal/review/declaredScript";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { contextFor, FIXTURE_ATTRIBUTIONS, TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

let editor: Editor | null = null;

function tab(id: string, filePath: string | null = null): DocumentTab {
  return { kind: "document", id, filePath, title: id, isPinned: false, formatId: "markdown" };
}

function seed(tabs: DocumentTab[], focused: string): void {
  useTabStore.setState({ tabs: { main: tabs }, activeTabId: { main: focused }, untitledCounter: 0 });
  for (const t of tabs) useDocumentStore.getState().initDocument(t.id, "old document\n", t.filePath);
}

/** A settled editor on `tabId`: its content load has run, so its selection is the reader's. */
function mountLive(tabId: string): Editor {
  editor = new Editor({ extensions: [StarterKit], content: "<p>old document</p>" });
  markContentApplied(editor);
  editor.commands.setTextSelection({ from: 1, to: 4 });
  useEditorStore.getState().setTiptapEditor(editor);
  useEditorStore.getState().setActiveWysiwygEditor(editor, tabId);
  return editor;
}

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
const write = (id: string, args: Record<string, unknown>, ctx = TEST_WRITE_CONTEXT) =>
  handleDocumentWrite(id, { save: false, ...args }, ctx);

/** Start a write, hold its prepare, run `race`, then let the prepare answer. */
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
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useUIStore.setState({ sourceMode: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setTiptapEditor(null);
  editor?.destroy();
  editor = null;
});

describe("document.write — happy path", () => {
  it("applies, commits and answers applied + durable", async () => {
    seed([tab("t1")], "t1");
    await write("w1", { content: "AI text\n" });
    expect(reply("w1")).toMatchObject({ success: true, data: { applied: true, durable: true, saved: false } });
    expect(content("t1")).toBe("AI text\n");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
    expect(fake.log[1].detail).toBe("AI text\n");
  });

  it("prepares with the buffer as preimage and the request's MCP actor", async () => {
    seed([tab("t1", "/notes/a.md")], "t1");
    const ctx = contextFor(FIXTURE_ATTRIBUTIONS.ambiguous);
    await write("w2", { content: "new\n" }, ctx);
    expect(fake.prepareControlledWrite).toHaveBeenCalledWith({
      docKey: "path:/notes/a.md",
      parent: null,
      preimage: "old document\n",
      actor: journalActorFor(ctx.attribution),
      tool: "document.write",
      baselineProvenance: null,
      baselineTouched: false,
      certificate: await declaredScriptCertificate("old document\n", "new\n"),
    });
  });
});

describe("document.write — re-verify after a held prepare", () => {
  it("a user edit during prepare is ABORTED (edited) and the edit survives untouched", async () => {
    seed([tab("t1")], "t1");
    await raceDuringPrepare("r1", { content: "AI\n" }, () =>
      useDocumentStore.getState().setEditorContent("t1", "user typed\n"),
    );
    expect(refusal("r1")).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(content("t1")).toBe("user typed\n");
    expect(fake.log.at(-1)).toMatchObject({ op: "abort", detail: "edited" });
    expect(fake.log.filter((e) => e.op === "commit")).toEqual([]);
  });

  it("closing the tab during prepare is ABORTED (closed)", async () => {
    seed([tab("t1"), tab("t2")], "t1");
    await raceDuringPrepare("r2", { tabId: "t1", content: "AI\n" }, () => {
      useTabStore.setState({ tabs: { main: [tab("t2")] }, activeTabId: { main: "t2" } });
      useDocumentStore.getState().removeDocument("t1");
    });
    expect(refusal("r2")).toMatchObject({ error: "ABORTED", reason: "closed" });
    expect(fake.log.at(-1)).toMatchObject({ op: "abort", detail: "closed" });
  });

  it("an IME composition started during prepare is ABORTED (composing), editor untouched", async () => {
    seed([tab("t1")], "t1");
    const live = mountLive("t1");
    const before = revision("t1");
    await raceDuringPrepare("r3", { content: "AI\n" }, () => {
      vi.spyOn(live.view, "composing", "get").mockReturnValue(true);
    });
    expect(refusal("r3")).toMatchObject({ error: "ABORTED", reason: "composing" });
    expect(live.getText()).toBe("old document");
    expect(content("t1")).toBe("old document\n");
    expect(revision("t1")).toBe(before);
  });

  it("moving the selection during prepare is ABORTED (selection)", async () => {
    seed([tab("t1")], "t1");
    const live = mountLive("t1");
    await raceDuringPrepare("r4", { content: "AI\n" }, () => {
      live.commands.setTextSelection({ from: 5, to: 5 });
    });
    expect(refusal("r4")).toMatchObject({ error: "ABORTED", reason: "selection" });
    expect(live.getText()).toBe("old document");
  });

  it("switching the focused tab under an implicit-target write is ABORTED (selection)", async () => {
    seed([tab("t1"), tab("t2")], "t1");
    await raceDuringPrepare("r5", { content: "AI\n" }, () => {
      useTabStore.setState({ activeTabId: { main: "t2" } });
    });
    expect(refusal("r5")).toMatchObject({ error: "ABORTED", reason: "selection" });
    expect(content("t1")).toBe("old document\n");
    expect(content("t2")).toBe("old document\n");
  });

  it("an explicit-target write is not aborted by a focus switch", async () => {
    seed([tab("t1"), tab("t2")], "t1");
    await raceDuringPrepare("r6", { tabId: "t1", content: "AI\n" }, () => {
      useTabStore.setState({ activeTabId: { main: "t2" } });
    });
    expect(reply("r6").success).toBe(true);
    expect(content("t1")).toBe("AI\n");
  });

  it("an ABORTED write after an applied one may be retried and then applies (no STALE_PARENT)", async () => {
    seed([tab("t1", "/notes/a.md")], "t1");
    await write("r6b", { content: "first\n" });
    expect(reply("r6b").success).toBe(true);
    await raceDuringPrepare("r7", { content: "AI\n" }, () =>
      useDocumentStore.getState().setEditorContent("t1", "user typed\n"),
    );
    await write("r8", { content: "AI\n" });
    expect(reply("r8").success).toBe(true);
    expect(content("t1")).toBe("AI\n");
  });

  it("a retry after an abort whose prepare recorded the user's typing as a baseline is not STALE_PARENT", async () => {
    seed([tab("t1", "/notes/a.md"), tab("t2")], "t1");
    await write("b0", { content: "first\n" });
    useDocumentStore.getState().setEditorContent("t1", "user typed\n");
    await raceDuringPrepare("b1", { content: "AI\n" }, () => {
      useTabStore.setState({ activeTabId: { main: "t2" } });
    });
    expect(refusal("b1")).toMatchObject({ error: "ABORTED", reason: "selection" });
    useTabStore.setState({ activeTabId: { main: "t1" } });
    await write("b2", { content: "AI\n" });
    expect(reply("b2").success).toBe(true);
    expect(content("t1")).toBe("AI\n");
  });
});

describe("document.write — two windows on one file", () => {
  it("exactly one concurrent write is applied; the other is JOURNAL_BUSY and changes nothing", async () => {
    seed([tab("a", "/shared.md"), tab("b", "/shared.md")], "a");
    fake.holdNextPrepare();
    const first = write("two-a", { tabId: "a", content: "from a\n" });
    await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalled());
    await write("two-b", { tabId: "b", content: "from b\n" });
    fake.release();
    await first;
    expect(reply("two-a").success).toBe(true);
    expect(refusal("two-b")).toMatchObject({ error: "JOURNAL_BUSY" });
    expect(content("b")).toBe("old document\n");
  });

  it("a window that missed another's commit is STALE_PARENT, then rebases on retry", async () => {
    seed([tab("a", "/shared.md"), tab("b", "/shared.md")], "a");
    await write("s1", { tabId: "a", content: "a1\n" });
    await write("s2", { tabId: "b", content: "b1\n" });
    await write("s3", { tabId: "a", content: "a2\n" });
    expect(refusal("s3")).toMatchObject({ error: "STALE_PARENT" });
    expect(content("a")).toBe("a1\n");
    await write("s4", { tabId: "a", content: "a2\n" });
    expect(reply("s4").success).toBe(true);
  });
});

describe("document.write — journal failures", () => {
  it("a commit failure answers applied with durable false; the next write is JOURNAL_DEGRADED until drained", async () => {
    seed([tab("t1")], "t1");
    fake.failNextCommits();
    await write("d1", { content: "AI\n" });
    expect(reply("d1")).toMatchObject({ success: true, data: { applied: true, durable: false } });
    expect(content("t1")).toBe("AI\n");
    await write("d2", { content: "AI again\n" });
    expect(refusal("d2")).toMatchObject({ error: "JOURNAL_DEGRADED" });
    expect(content("t1")).toBe("AI\n");
    fake.drain();
    await write("d3", { content: "AI again\n" });
    expect(reply("d3").success).toBe(true);
  });

  it("a commit the journal refuses answers applied with durable false; the next write is not STALE_PARENT", async () => {
    seed([tab("t1", "/notes/a.md")], "t1");
    await write("u0", { content: "first\n" });
    fake.refuseNextCommits();
    await write("u1", { content: "AI\n" });
    expect(reply("u1")).toMatchObject({ success: true, data: { applied: true, durable: false } });
    expect(content("t1")).toBe("AI\n");
    await write("u2", { content: "AI again\n" });
    expect(reply("u2").success).toBe(true);
    expect(content("t1")).toBe("AI again\n");
  });

  it("a failed aborted append keeps the reservation; writes are refused until the retry lands", async () => {
    seed([tab("t1")], "t1");
    fake.failNextAborts();
    await raceDuringPrepare("f1", { content: "AI\n" }, () =>
      useDocumentStore.getState().setEditorContent("t1", "user typed\n"),
    );
    expect(refusal("f1")).toMatchObject({ error: "ABORTED", reason: "edited" });
    await write("f2", { content: "AI\n" });
    expect(refusal("f2")).toMatchObject({ error: "JOURNAL_DEGRADED" });
    fake.drain();
    await write("f3", { content: "AI\n" });
    expect(reply("f3").success).toBe(true);
  });

  it("content with a lone surrogate is INVALID_TEXT before any prepare", async () => {
    seed([tab("t1")], "t1");
    await write("i1", { content: "bad \uD800 text" });
    expect(refusal("i1")).toMatchObject({ error: "INVALID_TEXT" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(content("t1")).toBe("old document\n");
  });

  it("a journal that is not running refuses the write and changes nothing", async () => {
    seed([tab("t1")], "t1");
    fake.setUnavailable(true);
    await write("u1", { content: "AI\n" });
    expect(refusal("u1")).toMatchObject({ error: "JOURNAL_UNAVAILABLE" });
    expect(content("t1")).toBe("old document\n");
  });

  it("an IME composition before the write is still BUSY, and nothing is prepared", async () => {
    seed([tab("t1")], "t1");
    const live = mountLive("t1");
    vi.spyOn(live.view, "composing", "get").mockReturnValue(true);
    await write("b1", { content: "AI\n" });
    expect(refusal("b1")).toMatchObject({ error: "BUSY" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
  });
});
