// WI-1.4 — vmark.document.{read, write, transform} including the
// load-bearing STALE-revision concurrency path (ADR-4).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore, generateRevisionId } from "@/stores/revisionStore";
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

// No editor available in tests — writeContent's fallback path runs.
vi.mock("@/stores/tiptapEditorStore", () => ({
  useTiptapEditorStore: {
    getState: () => ({ editor: null }),
  },
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
  });
});
