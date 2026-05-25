// WI-1.4 — vmark.document.{read, write, transform} including the
// load-bearing STALE-revision concurrency path (ADR-4).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore, generateRevisionId } from "@/stores/revisionStore";
import { useMcpStore } from "@/stores/mcpStore";
import {
  handleDocumentRead,
  handleDocumentWrite,
  handleDocumentTransform,
} from "../document";

vi.mock("../../utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

vi.mock("@/stores/mcpCheckpointPersistence", () => ({
  appendCheckpoint: vi.fn(async () => undefined),
}));

// No editor available in tests — writeContent's fallback path runs.
vi.mock("@/stores/tiptapEditorStore", () => ({
  useTiptapEditorStore: {
    getState: () => ({ editor: null }),
  },
}));

const writeTextFileMock = vi.fn(async () => undefined);
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (path: string, content: string) =>
    writeTextFileMock(path, content),
}));

import { respond } from "../../utils";

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
  });

  it("rejects writes whose expected_revision is stale", async () => {
    seedTab("t-w", "original", null);
    const stale = "rev-OLDOLDOL";
    // Force a known-current revision distinct from `stale`.
    useRevisionStore.getState().setRevision(generateRevisionId());

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
    const current = useRevisionStore.getState().getRevision();
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
    const before = useRevisionStore.getState().getRevision();
    await handleDocumentTransform("req-noop", {
      tabId: "t-noop",
      kind: "cjk-spacing",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    // No content change → revision should not bump.
    expect(useRevisionStore.getState().getRevision()).toBe(before);
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
