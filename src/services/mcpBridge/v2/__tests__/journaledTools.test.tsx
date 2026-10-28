// WI-AL1.4 — document.transform, selection.set and workflow.apply_patch on the controlled-mutation protocol, like document.write: each prepares durably under its own tool name and the request's MCP actor before anything changes, re-verifies the tab after the ack (a user edit during a held prepare is ABORTED and nothing changes), commits the postimage it applied (document.transform and workflow.apply_patch send their declared script with the prepare, WI-AL2.1b; selection.set its change), answers applied + durable, refuses JOURNAL_BUSY / JOURNAL_DEGRADED with nothing changed, answers durable false on a failed commit, and journals nothing for a no-op. CJK content and lone surrogates covered.
//
// Real stores and real editors (Tiptap, CodeMirror); the journal IPC client is
// the in-memory fake (src/test/agentJournalFake.ts) with the writer's semantics.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { markContentApplied } from "@/services/editor/contentApplied";
import StarterKit from "@tiptap/starter-kit";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentTransform } from "@/services/mcpBridge/v2/document";
import { handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import { handleWorkflowApplyPatch } from "@/services/mcpBridge/v2/workflow";
import { journalActorFor } from "@/services/agentJournal/journalActor";
import { isWellFormedText } from "@/services/agentJournal/wellFormedText";
import { declaredScriptCertificate } from "@/services/agentJournal/review/declaredScript";
import { registerUnsavedProvenanceSource, resetUnsavedProvenanceSources } from "@/services/agentJournal/unsavedProvenance";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { contextFor, FIXTURE_ATTRIBUTIONS, TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const WORKFLOW = "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
const WF_PATH = "/repo/.github/workflows/ci.yml";

let tiptap: Editor | null = null;
const cmViews: CMView[] = [];

function tab(id: string, filePath: string | null = null): DocumentTab {
  return { kind: "document", id, filePath, title: id, isPinned: false, formatId: "markdown" };
}

function seed(id: string, text: string, filePath: string | null = null): void {
  useTabStore.setState({ tabs: { main: [tab(id, filePath)] }, activeTabId: { main: id }, untitledCounter: 0 });
  useDocumentStore.getState().initDocument(id, text, filePath);
}

function mountSource(tabId: string, text: string, from: number, to: number): CMView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new CMView({ state: CMState.create({ doc: text, selection: { anchor: from, head: to } }), parent });
  cmViews.push(view);
  useUIStore.setState({ sourceMode: true });
  useEditorStore.getState().setActiveSourceView(view, tabId);
  return view;
}

function mountWysiwyg(tabId: string, html: string, from: number, to: number): Editor {
  tiptap = new Editor({ extensions: [StarterKit], content: html });
  markContentApplied(tiptap); // its initial load has run
  tiptap.commands.setTextSelection({ from, to });
  useEditorStore.getState().setTiptapEditor(tiptap);
  useEditorStore.getState().setActiveWysiwygEditor(tiptap, tabId);
  return tiptap;
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
const committed = () => fake.log.filter((e) => e.op === "commit");

/** Start a request, hold its prepare, run `race`, then let the prepare answer. */
async function raceDuringPrepare(run: () => Promise<void>, race: () => void): Promise<void> {
  const calls = fake.prepareControlledWrite.mock.calls.length;
  fake.holdNextPrepare();
  const pending = run();
  await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(calls + 1));
  race();
  fake.release();
  await pending;
}

const transform = (id: string, tabId: string, ctx = TEST_WRITE_CONTEXT) =>
  handleDocumentTransform(id, { tabId, kind: "cjk-spacing" }, ctx);
const selectionSet = (id: string, text: string, ctx = TEST_WRITE_CONTEXT) =>
  handleSelectionSet(id, { content: text }, ctx);
const applyPatch = (id: string, value = "renamed", ctx = TEST_WRITE_CONTEXT) =>
  handleWorkflowApplyPatch(id, { patches: [{ kind: "workflow.set", path: "name", value }] }, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useUIStore.setState({ sourceMode: false });
});

afterEach(() => {
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setTiptapEditor(null);
  useEditorStore.getState().setActiveSourceView(null);
  tiptap?.destroy();
  tiptap = null;
  for (const v of cmViews.splice(0)) {
    v.dom.parentElement?.remove();
    v.destroy();
  }
});

describe("document.transform — controlled mutation", () => {
  it("prepares under its tool name and actor, commits the transformed text, answers applied + durable", async () => {
    seed("t1", "测试ABC混合", "/notes/cjk.md");
    const ctx = contextFor(FIXTURE_ATTRIBUTIONS.ambiguous);
    await transform("x1", "t1", ctx);
    expect(fake.prepareControlledWrite).toHaveBeenCalledWith({
      docKey: "path:/notes/cjk.md",
      parent: null,
      preimage: "测试ABC混合",
      actor: journalActorFor(ctx.attribution),
      tool: "document.transform",
      baselineProvenance: null,
      baselineTouched: false,
      certificate: await declaredScriptCertificate("测试ABC混合", "测试 ABC 混合"),
    });
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
    expect(fake.log[1].detail).toBe("测试 ABC 混合");
    expect(reply("x1")).toMatchObject({ success: true, data: { applied: true, durable: true } });
    expect(content("t1")).toBe("测试 ABC 混合");
  });

  it("a transform that changes nothing journals nothing", async () => {
    seed("t1", "all ASCII text");
    await transform("x2", "t1");
    expect(reply("x2").success).toBe(true);
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
  });

  it("a user edit during a held prepare is ABORTED (edited) and nothing changes", async () => {
    seed("t1", "测试ABC");
    const before = revision("t1");
    await raceDuringPrepare(() => transform("x3", "t1"), () =>
      useDocumentStore.getState().setEditorContent("t1", "用户ABC"),
    );
    expect(refusal("x3")).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(content("t1")).toBe("用户ABC");
    expect(revision("t1")).not.toBe(before);
    expect(fake.log.at(-1)).toMatchObject({ op: "abort", detail: "edited" });
    expect(committed()).toEqual([]);
  });

  it("a busy document refuses JOURNAL_BUSY and changes nothing", async () => {
    seed("t1", "测试ABC");
    fake.refuseNextPrepares("JOURNAL_BUSY");
    await transform("x4", "t1");
    expect(refusal("x4")).toMatchObject({ error: "JOURNAL_BUSY" });
    expect(content("t1")).toBe("测试ABC");
    expect(committed()).toEqual([]);
  });

  it("a failed commit still answers applied, durable false; the next request is JOURNAL_DEGRADED", async () => {
    seed("t1", "测试ABC");
    fake.failNextCommits();
    await transform("x5", "t1");
    expect(reply("x5")).toMatchObject({ success: true, data: { applied: true, durable: false } });
    useDocumentStore.getState().setEditorContent("t1", "再测试XYZ");
    await transform("x6", "t1");
    expect(refusal("x6")).toMatchObject({ error: "JOURNAL_DEGRADED" });
    expect(content("t1")).toBe("再测试XYZ");
  });
});

describe("selection.set — controlled mutation", () => {
  it("source mode: prepares the flushed buffer, commits the replaced text, answers applied + durable", async () => {
    seed("s1", "hello world");
    mountSource("s1", "hello world", 6, 11);
    await selectionSet("y1", "世界");
    expect(fake.prepareControlledWrite).toHaveBeenCalledWith(
      expect.objectContaining({ preimage: "hello world", tool: "selection.set", docKey: "tab:main/s1" }),
    );
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
    expect(fake.log[1].detail).toBe("hello 世界");
    expect(reply("y1")).toMatchObject({ success: true, data: { applied: true, durable: true, replaced_chars: 5 } });
    expect(content("s1")).toBe("hello 世界");
  });

  it("WYSIWYG: commits the serialized document after the replacement", async () => {
    seed("w1", "old document\n");
    const live = mountWysiwyg("w1", "<p>old document</p>", 1, 4);
    await selectionSet("y2", "new");
    expect(live.getText()).toBe("new document");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
    expect(fake.log[1].detail).toBe(content("w1"));
    expect(content("w1")).toContain("new document");
  });

  it("moving the selection during a held prepare is ABORTED (selection), editor untouched", async () => {
    seed("s1", "hello world");
    const view = mountSource("s1", "hello world", 6, 11);
    await raceDuringPrepare(() => selectionSet("y3", "X"), () => {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    expect(refusal("y3")).toMatchObject({ error: "ABORTED", reason: "selection" });
    expect(view.state.doc.toString()).toBe("hello world");
    expect(content("s1")).toBe("hello world");
  });

  it("typing in the editor during a held prepare is ABORTED (edited), the typing survives", async () => {
    seed("s1", "hello world");
    const view = mountSource("s1", "hello world", 6, 11);
    await raceDuringPrepare(() => selectionSet("y4", "X"), () => {
      view.dispatch({ changes: { from: 0, insert: "你" } });
      useDocumentStore.getState().setEditorContent("s1", view.state.doc.toString());
    });
    expect(refusal("y4")).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(view.state.doc.toString()).toBe("你hello world");
  });

  it("content with a lone surrogate is INVALID_TEXT before any prepare", async () => {
    seed("s1", "hello world");
    mountSource("s1", "hello world", 6, 11);
    await selectionSet("y5", "bad \uD800");
    expect(refusal("y5")).toMatchObject({ error: "INVALID_TEXT" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(content("s1")).toBe("hello world");
  });

  it("an empty replacement over a collapsed selection journals nothing", async () => {
    seed("s1", "hello");
    mountSource("s1", "hello", 2, 2);
    await selectionSet("y6", "");
    expect(reply("y6").success).toBe(true);
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
  });

  it("a journal that is not running refuses and leaves the editor untouched", async () => {
    seed("s1", "hello world");
    const view = mountSource("s1", "hello world", 6, 11);
    fake.setUnavailable(true);
    await selectionSet("y7", "X");
    expect(refusal("y7")).toMatchObject({ error: "JOURNAL_UNAVAILABLE" });
    expect(view.state.doc.toString()).toBe("hello world");
  });
});

describe("selection.set — a provable no-op is answered before any prepare", () => {
  /** Nothing journaled, dispatched or bumped; the existing no-op answer. */
  function expectNoOp(requestId: string, tabId: string, before: string): void {
    expect(reply(requestId)).toMatchObject({ success: true, data: { revision: before, replaced_chars: 0 } });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(fake.log).toEqual([]);
    expect(revision(tabId)).toBe(before);
  }

  it.each([
    ["ASCII", "hello world", 6, 11, "world"],
    ["CJK", "你好 世界", 3, 5, "世界"],
  ])("source mode: replacing the selection with its own text (%s) journals and dispatches nothing", async (_label, doc, from, to, text) => {
    seed("s1", doc);
    const view = mountSource("s1", doc, from, to);
    const before = revision("s1");
    const state = view.state;
    await selectionSet("n1", text);
    expectNoOp("n1", "s1", before);
    expect(view.state).toBe(state);
  });

  it.each([
    ["CJK plain text", "<p>你好世界</p>", 3, 5, "世界"],
    ["a bold CJK run, marks included", "<p><strong>粗体</strong>文字</p>", 1, 3, "**粗体**"],
  ])("WYSIWYG: a replacement that rebuilds the same nodes (%s) journals and dispatches nothing", async (_label, html, from, to, text) => {
    seed("w1", "x\n");
    const live = mountWysiwyg("w1", html, from, to);
    const before = revision("w1");
    const transactions = vi.fn();
    live.on("transaction", transactions);
    await selectionSet("n2", text);
    expectNoOp("n2", "w1", before);
    expect(transactions).not.toHaveBeenCalled();
  });

  it.each([
    ["an underlined CJK run (the Markdown cannot carry the mark)", "<p><u>下划线</u>x</p>", 1, 4, "++下划线++"],
    ["a slice across two paragraphs (the replacement splits them)", "<p>ab</p><p>cd</p>", 2, 6, "b\n\nc"],
  ])("WYSIWYG: equal selected Markdown is not a no-op when the nodes would change: %s", async (_label, html, from, to, text) => {
    seed("w1", "x\n");
    const live = mountWysiwyg("w1", html, from, to);
    const docBefore = live.state.doc;
    await selectionSet("n3", text);
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
    expect(live.state.doc.eq(docBefore)).toBe(false);
    expect(reply("n3")).toMatchObject({ success: true, data: { applied: true } });
  });

  it("source mode: a different text in the selection is still applied", async () => {
    seed("s1", "你好 世界");
    mountSource("s1", "你好 世界", 3, 5);
    await selectionSet("n4", "世間");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
    expect(content("s1")).toBe("你好 世間");
  });
});

describe("selection.set — an apply that fails after it changed the editor", () => {
  it("WYSIWYG: a dispatch that throws after applying commits the editor's text and answers applied with error", async () => {
    seed("w1", "old document\n");
    const live = mountWysiwyg("w1", "<p>old document</p>", 1, 4);
    const before = revision("w1");
    live.on("transaction", () => {
      throw new Error("listener crashed");
    });
    await selectionSet("e1", "新");
    expect(live.getText()).toBe("新 document");
    expect(content("w1")).toContain("新 document");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
    expect(fake.log[1].detail).toBe(content("w1"));
    expect(revision("w1")).not.toBe(before);
    expect(refusal("e1")).toMatchObject({ error: "INTERNAL", applied: true, durable: true, current_revision: revision("w1") });
  });

  it("source: a store mirror that throws after the dispatch commits the text, not durable when the commit fails", async () => {
    seed("s1", "hello world");
    mountSource("s1", "hello world", 6, 11);
    const stop = useDocumentStore.subscribe((state) => {
      if (state.documents.s1?.content === "hello 世界") throw new Error("listener crashed");
    });
    fake.failNextCommits();
    try {
      await selectionSet("e2", "世界");
    } finally {
      stop();
    }
    expect(content("s1")).toBe("hello 世界");
    expect(fake.log.filter((e) => e.op === "abort")).toEqual([]);
    expect(refusal("e2")).toMatchObject({ error: "INTERNAL", applied: true, durable: false, current_revision: revision("s1") });
  });
});

describe("selection.set — an apply that throws before it changed the editor", () => {
  /**
   * A source-mode tab whose one write succeeds, then the user types, then the
   * next write's dispatch throws before the editor changes ("t2").
   */
  async function crashAfterUserTyped(): Promise<void> {
    seed("s1", "hello world");
    let crash = false;
    const refuseWhenArmed = CMState.transactionFilter.of((tr) => {
      if (crash && tr.docChanged) {
        crash = false;
        throw new Error("filter crashed");
      }
      return tr;
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new CMView({
      state: CMState.create({ doc: "hello world", selection: { anchor: 6, head: 11 }, extensions: [refuseWhenArmed] }),
      parent,
    });
    cmViews.push(view);
    useUIStore.setState({ sourceMode: true });
    useEditorStore.getState().setActiveSourceView(view, "s1");
    await selectionSet("t1", "世界");
    expect(reply("t1").success).toBe(true);
    // The user types: the next prepare records that text as a baseline.
    view.dispatch({ changes: { from: 0, insert: "你好 " }, selection: { anchor: 0, head: 2 } });
    useDocumentStore.getState().setEditorContent("s1", view.state.doc.toString());
    crash = true;
    await selectionSet("t2", "再见");
  }

  afterEach(() => {
    resetUnsavedProvenanceSources();
  });

  it("source: aborts, keeps the baseline the prepare recorded, and the next write is not refused STALE_PARENT", async () => {
    await crashAfterUserTyped();
    expect(reply("t2")).toMatchObject({ success: false, error: expect.stringContaining("filter crashed") });
    expect(content("s1")).toBe("你好 hello 世界");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit", "prepare", "abort"]);
    const { baseline } = (await fake.prepareControlledWrite.mock.results[1].value) as { baseline: string | null };
    expect(baseline).not.toBeNull();
    await selectionSet("t3", "再见");
    expect(reply("t3")).toMatchObject({ success: true, data: { applied: true } });
    // The retry builds on the baseline the aborted prepare recorded, not a dropped basis.
    expect(fake.prepareControlledWrite.mock.calls[2][0]).toMatchObject({ parent: baseline });
    expect(content("s1")).toBe("再见 hello 世界");
  });

  it("source: the thrown abort records the frozen provenance at that baseline, and forks nothing", async () => {
    // The tab's provenance source, registered through the module's seam. Each
    // freeze's first settlement wins, as in the real session; freezes are
    // numbered per write (t1, then t2).
    const settled: Array<[number, string, string | null]> = [];
    const forks: string[] = [];
    let freezes = 0;
    registerUnsavedProvenanceSource("s1", {
      freeze: () => {
        const n = ++freezes;
        let done = false;
        const settle = (what: string, id: string | null) => {
          if (!done) settled.push([n, what, id]);
          done = true;
        };
        return {
          touched: true, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(),
          payload: async () => null,
          recorded: (id) => settle("recorded", id),
          invalidate: () => settle("invalidate", null),
          release: () => settle("release", null),
        };
      },
      fork: (text) => {
        forks.push(text);
        return { recorded: () => {}, invalidate: () => {} };
      },
    });
    await crashAfterUserTyped();
    expect(reply("t2")).toMatchObject({ success: false, error: expect.stringContaining("filter crashed") });
    const { baseline } = (await fake.prepareControlledWrite.mock.results[1].value) as { baseline: string | null };
    expect(baseline).not.toBeNull();
    expect(settled.filter(([n]) => n === 2)).toEqual([[2, "recorded", baseline]]);
    // Only t1's apply forked; t2 threw before changing anything.
    expect(forks).toEqual(["hello 世界"]);
  });
});

describe("workflow.apply_patch — controlled mutation", () => {
  function seedWorkflow(): void {
    seed("wf", WORKFLOW, WF_PATH);
  }

  it("prepares, commits the patched YAML and answers applied + durable", async () => {
    seedWorkflow();
    await applyPatch("z1");
    expect(fake.prepareControlledWrite).toHaveBeenCalledWith(
      expect.objectContaining({ preimage: WORKFLOW, tool: "workflow.apply_patch", docKey: `path:${WF_PATH}` }),
    );
    expect(fake.log[1]).toMatchObject({ op: "commit" });
    expect(fake.log[1].detail).toMatch(/^name: renamed/);
    expect(reply("z1")).toMatchObject({ success: true, data: { applied: true, durable: true } });
  });

  it("a no-op patch journals nothing", async () => {
    seedWorkflow();
    await applyPatch("z2", "ci");
    expect(reply("z2").success).toBe(true);
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
  });

  it("a user edit during a held prepare is ABORTED (edited) and the edit survives", async () => {
    seedWorkflow();
    const edited = WORKFLOW.replace("echo hi", "echo 你好");
    await raceDuringPrepare(() => applyPatch("z3"), () =>
      useDocumentStore.getState().setEditorContent("wf", edited),
    );
    expect(refusal("z3")).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(content("wf")).toBe(edited);
    expect(committed()).toEqual([]);
  });

  it("a patch value with a lone surrogate never reaches the journal as ill-formed text", async () => {
    seedWorkflow();
    await applyPatch("z4", "bad \uDC00 name");
    // The YAML stringifier escapes the lone surrogate, so the buffer and
    // the committed postimage stay well-formed text.
    expect(reply("z4").success).toBe(true);
    const committed = fake.log.find((e) => e.op === "commit")?.detail ?? "";
    expect(isWellFormedText(committed)).toBe(true);
    expect(committed).toBe(content("wf"));
  });

  it("a stale parent is refused and a retry rebases", async () => {
    seedWorkflow();
    await applyPatch("z5", "one");
    fake.refuseNextPrepares("STALE_PARENT");
    await applyPatch("z6", "two");
    expect(refusal("z6")).toMatchObject({ error: "STALE_PARENT" });
    await applyPatch("z7", "two");
    expect(reply("z7").success).toBe(true);
    expect(content("wf")).toMatch(/^name: two/);
  });
});
