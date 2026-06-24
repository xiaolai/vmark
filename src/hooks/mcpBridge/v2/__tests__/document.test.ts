// WI-1.4 — vmark.document.{read, write, transform} including the
// load-bearing STALE-revision concurrency path (ADR-4).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore, generateRevisionId } from "@/stores/documentStore";
import { useMcpStore } from "@/stores/mcpStore";

vi.mock("../../utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

vi.mock("@/stores/mcpCheckpointPersistence", () => ({
  appendCheckpoint: vi.fn(async () => undefined),
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

const writeTextFileMock = vi.fn(async () => undefined);
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (path: string, content: string) =>
    writeTextFileMock(path, content),
}));

const registerPendingSaveMock = vi.fn(() => 1);
const clearPendingSaveMock = vi.fn();
vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: (path: string, content: string) =>
    registerPendingSaveMock(path, content),
  clearPendingSave: (path: string, token?: number) =>
    clearPendingSaveMock(path, token),
}));

// The path guard is unit-tested in services/mcpBridge/bridgePathGuard.test.ts
// and utils/mcpBridgePathPolicy.test.ts. Here we mock it (default: allow) so
// handler tests stay focused on wiring — and can flip it to denied to assert
// the defense-in-depth disk-write block.
const checkBridgePathMock = vi.fn<
  (p: string) => Promise<{ allowed: boolean; reason?: string }>
>(async () => ({ allowed: true }));
vi.mock("@/services/mcpBridge/bridgePathGuard", () => ({
  checkBridgePath: (p: string) => checkBridgePathMock(p),
}));

import { respond } from "../../utils";
import {
  handleDocumentRead,
  handleDocumentWrite,
  handleDocumentTransform,
} from "../document";

function resetStores() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
  useMcpStore.setState((s) => ({ checkpoint: { ...s.checkpoint, checkpoints: [], hydrated: false } }));
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
    await handleDocumentRead("req-1", {});
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
    await handleDocumentRead("req-2", {});
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
    await handleDocumentRead("req-3", { tabId: "t-other" });
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
    return {
      schema: getSchema([StarterKit]),
      view: { state: { tr, doc: { content: { size: 1 } } }, dispatch },
    };
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
    });

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

    await handleDocumentWrite("req-active", {
      tabId: "t-active",
      content: "# new active",
      save: false,
    });

    const r = lastRespond();
    expect(r.success).toBe(true);
    // The active tab's write DOES re-render the live editor.
    expect(dispatch).toHaveBeenCalled();
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
    });
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
    });
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
    });
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
    });
    r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-bg"].content).toBe("landed");
  });

  it("allows writes without expected_revision (greenfield path)", async () => {
    seedTab("t-w3", "", null);
    await handleDocumentWrite("req-blind", {
      tabId: "t-w3",
      content: "first paragraph",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-w3"].content).toBe(
      "first paragraph",
    );
  });

  it("rejects non-string content", async () => {
    seedTab("t-w4", "x", null);
    await handleDocumentWrite("req-bad", { tabId: "t-w4", content: 42 });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INTERNAL",
    });
  });

  it("pushes a checkpoint after a successful write", async () => {
    seedTab("t-cp", "before", "/notes.md");
    await handleDocumentWrite("req-cp", {
      tabId: "t-cp",
      content: "after",
    });
    const cps = useMcpStore.getState().checkpointList({
      filePath: "/notes.md",
    });
    expect(cps).toHaveLength(1);
    expect(cps[0]).toMatchObject({
      tabId: "t-cp",
      filePath: "/notes.md",
      tool: "document.write",
      contentBefore: "before",
    });
    expect(cps[0].byteSize).toBe("before".length);
  });

  it("does not push a checkpoint when content is unchanged", async () => {
    seedTab("t-noop", "same", null);
    await handleDocumentWrite("req-noop", {
      tabId: "t-noop",
      content: "same",
    });
    expect(useMcpStore.getState().checkpoint.checkpoints).toHaveLength(0);
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
    });
    // The doc store must hold the YAML verbatim, including newlines
    // and indentation that the markdown parser would otherwise mangle.
    const stored =
      useDocumentStore.getState().documents["t-yaml-write"].content;
    expect(stored).toBe(yaml);
  });
});

// Regression: AI agents bypassed MCP and wrote files directly when they
// noticed the on-disk content was stale after a `document.write` —
// losing checkpoint history and racing with VMark's auto-save. The fix:
// `document.write` saves to disk by default. The buffer-vs-disk
// distinction is a VMark internal concern that has no business in the
// AI's reasoning loop.
describe("vmark.document.write — save-on-write (UX fix for buffered writes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    writeTextFileMock.mockReset().mockResolvedValue(undefined);
    registerPendingSaveMock.mockReset().mockReturnValue(1);
    clearPendingSaveMock.mockReset();
  });

  it("persists to disk by default and reports saved=true", async () => {
    seedTab("t-save", "before", "/tmp/notes.md");
    await handleDocumentWrite("req-save", {
      tabId: "t-save",
      content: "after",
    });

    expect(writeTextFileMock).toHaveBeenCalledWith("/tmp/notes.md", "after");
    const r = lastRespond();
    expect(r.success).toBe(true);
    const data = r.data as { saved: boolean; revision: string };
    expect(data.saved).toBe(true);
    // Buffer's dirty flag is cleared by markSaved.
    expect(useDocumentStore.getState().documents["t-save"].isDirty).toBe(false);
  });

  it("skips disk write when save:false is passed (save_skipped='opt_out')", async () => {
    seedTab("t-nosave", "before", "/tmp/notes.md");
    await handleDocumentWrite("req-nosave", {
      tabId: "t-nosave",
      content: "after",
      save: false,
    });

    expect(writeTextFileMock).not.toHaveBeenCalled();
    const r = lastRespond();
    expect(r.success).toBe(true);
    const data = r.data as { saved: boolean; save_skipped?: string; save_error?: string };
    expect(data.saved).toBe(false);
    // Structured: explicit opt-out, NOT a free-form string.
    expect(data.save_skipped).toBe("opt_out");
    expect(data.save_error).toBeUndefined();
    // Buffer was updated but stays dirty since we didn't save.
    const doc = useDocumentStore.getState().documents["t-nosave"];
    expect(doc.content).toBe("after");
    expect(doc.isDirty).toBe(true);
  });

  it("untitled tabs get save_skipped='untitled' (machine-readable, not a prose hint)", async () => {
    seedTab("t-untitled", "", null);
    await handleDocumentWrite("req-untitled", {
      tabId: "t-untitled",
      content: "draft",
    });

    expect(writeTextFileMock).not.toHaveBeenCalled();
    const r = lastRespond();
    expect(r.success).toBe(true);
    const data = r.data as { saved: boolean; save_skipped?: string; save_error?: string };
    expect(data.saved).toBe(false);
    // Structured field — AI clients shouldn't have to parse English.
    expect(data.save_skipped).toBe("untitled");
    // Mutually exclusive with save_error.
    expect(data.save_error).toBeUndefined();
    // Buffer still updated.
    expect(useDocumentStore.getState().documents["t-untitled"].content).toBe(
      "draft",
    );
  });

  it("registers and clears pending save around writeTextFile to suppress the external-change dialog", async () => {
    seedTab("t-pending", "before", "/tmp/notes.md");
    await handleDocumentWrite("req-pending", {
      tabId: "t-pending",
      content: "after",
    });

    expect(registerPendingSaveMock).toHaveBeenCalledWith("/tmp/notes.md", "after");
    expect(clearPendingSaveMock).toHaveBeenCalledWith("/tmp/notes.md", 1);
    // Ordering: register before write, clear after write.
    const registerOrder = registerPendingSaveMock.mock.invocationCallOrder[0];
    const writeOrder = writeTextFileMock.mock.invocationCallOrder[0];
    const clearOrder = clearPendingSaveMock.mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(writeOrder);
    expect(writeOrder).toBeLessThan(clearOrder);
  });

  it("clears pending save even when writeTextFile rejects", async () => {
    seedTab("t-pending-fail", "before", "/readonly/notes.md");
    writeTextFileMock.mockRejectedValueOnce(new Error("EACCES"));

    await handleDocumentWrite("req-pending-fail", {
      tabId: "t-pending-fail",
      content: "after",
    });

    expect(registerPendingSaveMock).toHaveBeenCalledWith("/readonly/notes.md", "after");
    expect(clearPendingSaveMock).toHaveBeenCalledWith("/readonly/notes.md", 1);
  });

  it("FS write failure surfaces save_error (NOT save_skipped) without failing the write", async () => {
    seedTab("t-fail", "before", "/readonly/notes.md");
    writeTextFileMock.mockRejectedValueOnce(new Error("EACCES"));

    await handleDocumentWrite("req-fail", {
      tabId: "t-fail",
      content: "after",
    });

    const r = lastRespond();
    // Important: success: true. The buffer was updated; re-writing on a
    // transient FS error would lose intent. The caller surfaces the hint.
    expect(r.success).toBe(true);
    const data = r.data as { saved: boolean; save_skipped?: string; save_error?: string };
    expect(data.saved).toBe(false);
    expect(data.save_error).toContain("EACCES");
    // We DID attempt the write — save_skipped must NOT be set.
    expect(data.save_skipped).toBeUndefined();
    // Buffer reflects the new content even though disk save failed.
    expect(useDocumentStore.getState().documents["t-fail"].content).toBe(
      "after",
    );
  });

  it("defense in depth: a denied path guard skips the disk write and surfaces save_error", async () => {
    seedTab("t-guard", "before", "/tmp/notes.md");
    checkBridgePathMock.mockResolvedValueOnce({
      allowed: false,
      reason: "Path is outside the workspace and open documents",
    });

    await handleDocumentWrite("req-guard", {
      tabId: "t-guard",
      content: "after",
    });

    const r = lastRespond();
    expect(r.success).toBe(true);
    const data = r.data as { saved: boolean; save_error?: string };
    expect(data.saved).toBe(false);
    expect(data.save_error).toBeTruthy();
    // The disk write must NOT have been attempted.
    expect(writeTextFileMock).not.toHaveBeenCalled();
    // Buffer still updated — consistent with the save-failure contract.
    expect(useDocumentStore.getState().documents["t-guard"].content).toBe(
      "after",
    );
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
    });
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
    });
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
    });
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
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    // No content change → revision should not bump.
    expect(useRevisionStore.getState().getRevision("t-noop")).toBe(before);
    // No checkpoint either.
    expect(useMcpStore.getState().checkpoint.checkpoints).toHaveLength(0);
  });

  it("pushes a checkpoint after a successful transform", async () => {
    seedTab("t-cp-tf", "测试ABC", "/cjk.md");
    await handleDocumentTransform("req-cp-tf", {
      tabId: "t-cp-tf",
      kind: "cjk-spacing",
    });
    const cps = useMcpStore.getState().checkpointList({
      filePath: "/cjk.md",
    });
    expect(cps).toHaveLength(1);
    expect(cps[0]).toMatchObject({
      tool: "document.transform",
      contentBefore: "测试ABC",
    });
    expect(cps[0].description).toContain("cjk-spacing");
  });
});
