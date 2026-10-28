// WI-1.4 — vmark.document.{read, write, transform} including the
// load-bearing STALE-revision concurrency path (ADR-4). These suites pin the
// buffer, revision and journal behaviour; what a write puts on DISK is
// asserted against a stateful disk in mcpSavePipeline.test.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore, generateRevisionId } from "@/stores/documentStore";
import { agentJournalFake } from "@/test/agentJournalFake";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { markContentApplied } from "@/services/editor/contentApplied";

vi.mock("@/services/mcpBridge/utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

// Configurable editor state — defaults to no editor (writeContent's fallback
// path). Tests that exercise the active-vs-background dispatch guard mutate it.
const { mockEditorState } = vi.hoisted(() => ({
  mockEditorState: {
    tiptap: { editor: null as unknown },
    active: { activeWysiwygTabId: null as string | null },
  },
}));
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => mockEditorState,
  },
}));

import { respond } from "@/services/mcpBridge/utils";
import {
  handleDocumentRead,
  handleDocumentWrite,
  handleDocumentTransform,
} from "@/services/mcpBridge/v2/document";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

function resetStores() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
}

function seedTab(tabId: string, content: string, filePath: string | null) {
  useTabStore.setState({
    tabs: {
      main: [{ id: tabId, filePath, title: tabId, isPinned: false }],
    },
    activeTabId: { main: tabId },
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.getState().initDocument(tabId, content, filePath);
}

function lastRespond() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

function parseStructuredError(s: string | undefined) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

describe("vmark.document.read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("returns content + revision + filePath + kind for the focused tab", async () => {
    seedTab("t-1", "# hi", "/tmp/notes.md");
    await handleDocumentRead("req-1", {}, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      content: "# hi",
      filePath: "/tmp/notes.md",
      kind: "markdown",
      dirty: false,
    });
    expect((r.data as { revision: string }).revision).toMatch(/^rev-/);
  });

  it("returns INVALID_TAB when no tab exists", async () => {
    await handleDocumentRead("req-2", {}, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_TAB",
    });
  });

  it("resolves an explicit tabId to its content", async () => {
    seedTab("t-2", "first", null);
    useTabStore.setState((s) => ({
      tabs: {
        main: [
          ...s.tabs.main,
          { id: "t-other", filePath: null, title: "other", isPinned: false },
        ],
      },
    }));
    useDocumentStore.getState().initDocument("t-other", "second", null);
    await handleDocumentRead("req-3", { tabId: "t-other" }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect((r.data as { content: string }).content).toBe("second");
  });
});

describe("vmark.document.write — STALE concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mockEditorState.tiptap.editor = null;
    mockEditorState.active.activeWysiwygTabId = null;
  });

  // A fake editor complete enough to REACH `view.dispatch` if the dispatch path
  // is entered — so the guard test actually distinguishes dispatch vs no-dispatch.
  function fakeEditor(dispatch: ReturnType<typeof vi.fn>) {
    const tr = {
      replaceWith: vi.fn().mockReturnThis(),
      setMeta: vi.fn().mockReturnThis(),
    };
    const editor = {
      schema: getSchema([StarterKit]),
      view: { state: { tr, doc: { content: { size: 1 } } }, dispatch },
    };
    // A mounted editor whose initial load has run.
    markContentApplied(editor as unknown as Editor);
    return editor;
  }

  // C5 follow-up — a write to a background markdown tab must not dispatch into
  // the active editor (which would clobber the active doc).
  it("does not dispatch into the active editor when writing a background markdown tab", async () => {
    seedTab("t-active", "# active", "/a.md");
    useTabStore.setState((s) => ({
      tabs: {
        main: [
          ...s.tabs.main,
          { id: "t-bg", filePath: "/bg.md", title: "bg", isPinned: false },
        ],
      },
    }));
    useDocumentStore.getState().initDocument("t-bg", "# bg", "/bg.md");

    const dispatch = vi.fn();
    // The live editor shows the ACTIVE tab (t-active), not the write target.
    mockEditorState.tiptap.editor = fakeEditor(dispatch);
    mockEditorState.active.activeWysiwygTabId = "t-active";

    const revBefore = useRevisionStore.getState().getRevision("t-bg");
    await handleDocumentWrite("req-bg", {
      tabId: "t-bg",
      content: "# new bg",
      save: false,
    }, TEST_WRITE_CONTEXT);

    const r = lastRespond();
    expect(r.success).toBe(true);
    // The active editor must NOT have been dispatched into.
    expect(dispatch).not.toHaveBeenCalled();
    // The background tab's content + its own revision still updated.
    expect(useDocumentStore.getState().documents["t-bg"].content).toBe("# new bg");
    expect(useRevisionStore.getState().getRevision("t-bg")).not.toBe(revBefore);
  });

  it("does dispatch into the editor when writing the ACTIVE markdown tab", async () => {
    seedTab("t-active", "# active", "/a.md");
    const dispatch = vi.fn();
    mockEditorState.tiptap.editor = fakeEditor(dispatch);
    mockEditorState.active.activeWysiwygTabId = "t-active";
    // The mounted editor's flusher; this fake editor's store already holds its text.
    const flush = vi.fn();
    registerWysiwygFlusher("t-active", flush);

    try {
      await handleDocumentWrite("req-active", {
        tabId: "t-active",
        content: "# new active",
        save: false,
      }, TEST_WRITE_CONTEXT);
    } finally {
      registerWysiwygFlusher("t-active", null);
    }

    const r = lastRespond();
    expect(r.success).toBe(true);
    // The active tab's write DOES re-render the live editor, then flushes it.
    expect(dispatch).toHaveBeenCalled();
    expect(flush).toHaveBeenCalled();
  });

  it("rejects writes whose expected_revision is stale", async () => {
    seedTab("t-w", "original", null);
    const stale = "rev-OLDOLDOL";
    // Force a known-current revision distinct from `stale`.
    useRevisionStore.getState().setRevision("t-w", generateRevisionId());

    await handleDocumentWrite("req-stale", {
      tabId: "t-w",
      content: "should not land",
      expected_revision: stale,
    }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(false);
    const err = parseStructuredError(r.error);
    expect(err).toMatchObject({ error: "STALE" });
    expect(typeof err.current_revision).toBe("string");
    // Document content unchanged.
    expect(useDocumentStore.getState().documents["t-w"].content).toBe(
      "original",
    );
  });

  it("accepts writes whose expected_revision matches current", async () => {
    seedTab("t-w2", "before", null);
    const current = useRevisionStore.getState().getRevision("t-w2");
    await handleDocumentWrite("req-ok", {
      tabId: "t-w2",
      content: "after",
      expected_revision: current,
    }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-w2"].content).toBe(
      "after",
    );
  });

  // WI-0.10 — per-tab revision keying (C5). A write to a non-active tab must
  // be validated against THAT tab's revision, not the active tab's.
  it("validates expected_revision against the target tab, not the active one", async () => {
    // Active tab is "t-active"; we write to the non-active "t-bg".
    seedTab("t-active", "active doc", null);
    useTabStore.setState((s) => ({
      tabs: {
        main: [
          ...s.tabs.main,
          { id: "t-bg", filePath: null, title: "bg", isPinned: false },
        ],
      },
    }));
    useDocumentStore.getState().initDocument("t-bg", "background doc", null);
    useRevisionStore.getState().setRevision("t-active", "rev-ACTIVEXX");
    useRevisionStore.getState().setRevision("t-bg", "rev-BGBGBGBG");

    // Passing the ACTIVE tab's revision for a write to t-bg must be STALE.
    await handleDocumentWrite("req-cross", {
      tabId: "t-bg",
      content: "should not land",
      expected_revision: "rev-ACTIVEXX",
    }, TEST_WRITE_CONTEXT);
    let r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({ error: "STALE" });
    expect(useDocumentStore.getState().documents["t-bg"].content).toBe(
      "background doc",
    );

    // Passing t-bg's OWN revision succeeds.
    await handleDocumentWrite("req-cross-ok", {
      tabId: "t-bg",
      content: "landed",
      expected_revision: "rev-BGBGBGBG",
    }, TEST_WRITE_CONTEXT);
    r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-bg"].content).toBe("landed");
  });

  it("allows writes without expected_revision (greenfield path)", async () => {
    seedTab("t-w3", "", null);
    await handleDocumentWrite("req-blind", {
      tabId: "t-w3",
      content: "first paragraph",
    }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-w3"].content).toBe(
      "first paragraph",
    );
  });

  it("rejects non-string content", async () => {
    seedTab("t-w4", "x", null);
    await handleDocumentWrite("req-bad", { tabId: "t-w4", content: 42 }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INTERNAL",
    });
  });

  it("records the write in the agent edit journal, with the text it replaced", async () => {
    seedTab("t-cp", "before", "/notes.md");
    await handleDocumentWrite("req-cp", {
      tabId: "t-cp",
      content: "after",
    }, TEST_WRITE_CONTEXT);
    expect(agentJournalFake.prepareControlledWrite).toHaveBeenCalledWith(
      expect.objectContaining({ docKey: "path:/notes.md", preimage: "before", tool: "document.write" }),
    );
    expect(agentJournalFake.doc("path:/notes.md").text).toBe("after");
  });

  it("re-detects kind from the INCOMING content (empty-tab YAML write)", async () => {
    // Empty untitled tab. Pre-write kind is markdown (no path, empty
    // content). Writing workflow-shaped YAML must NOT route through
    // Tiptap's markdown parser — the bridge should detect kind from
    // the new content and store it verbatim.
    seedTab("t-yaml-write", "", null);
    const yaml =
      "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
    await handleDocumentWrite("req-yaml", {
      tabId: "t-yaml-write",
      content: yaml,
    }, TEST_WRITE_CONTEXT);
    // The doc store must hold the YAML verbatim, including newlines
    // and indentation that the markdown parser would otherwise mangle.
    const stored =
      useDocumentStore.getState().documents["t-yaml-write"].content;
    expect(stored).toBe(yaml);
  });
});

describe("vmark.document.transform — CJK rewriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("adds spacing between CJK and ASCII (cjk-spacing)", async () => {
    seedTab("t-c", "测试ABC123混合", null);
    await handleDocumentTransform("req-cjk", {
      tabId: "t-c",
      kind: "cjk-spacing",
    }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-c"].content).toBe(
      "测试 ABC123 混合",
    );
  });

  it("converts ASCII punctuation adjacent to CJK to fullwidth (cjk-punctuation)", async () => {
    seedTab("t-p", "你好,世界.再见!", null);
    await handleDocumentTransform("req-pn", {
      tabId: "t-p",
      kind: "cjk-punctuation",
    }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-p"].content).toBe(
      "你好，世界。再见！",
    );
  });

  it("rejects unknown transform kinds", async () => {
    seedTab("t-x", "hello", null);
    await handleDocumentTransform("req-x", {
      tabId: "t-x",
      kind: "not-a-kind",
    }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INTERNAL",
    });
  });

  it("returns no-op when transform leaves content unchanged", async () => {
    seedTab("t-noop", "all ASCII text", null);
    const before = useRevisionStore.getState().getRevision("t-noop");
    await handleDocumentTransform("req-noop", {
      tabId: "t-noop",
      kind: "cjk-spacing",
    }, TEST_WRITE_CONTEXT);
    const r = lastRespond();
    expect(r.success).toBe(true);
    // No content change → revision should not bump, and nothing is journaled.
    expect(useRevisionStore.getState().getRevision("t-noop")).toBe(before);
    expect(agentJournalFake.prepareControlledWrite).not.toHaveBeenCalled();
  });

  it("records a transform in the agent edit journal, with the text it replaced", async () => {
    seedTab("t-cp-tf", "测试ABC", "/cjk.md");
    await handleDocumentTransform("req-cp-tf", {
      tabId: "t-cp-tf",
      kind: "cjk-spacing",
    }, TEST_WRITE_CONTEXT);
    expect(agentJournalFake.prepareControlledWrite).toHaveBeenCalledWith(
      expect.objectContaining({ docKey: "path:/cjk.md", preimage: "测试ABC", tool: "document.transform" }),
    );
    expect(agentJournalFake.doc("path:/cjk.md").text).not.toBe("测试ABC");
  });
});
