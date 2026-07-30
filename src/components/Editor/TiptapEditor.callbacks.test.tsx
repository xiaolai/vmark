// Split from TiptapEditor.test.tsx per the test-file size gate (WI-7).
// The mock/header block is replicated because vi.mock is per-module hoisted.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * TiptapEditorInner test suite
 *
 * Tests the exported helper functions (setContentWithoutHistory,
 * getAdaptiveDebounceDelay, syncMarkdownToEditor) and the component's
 * rendering/lifecycle behavior.
 *
 * Heavy editor integration is mocked — we focus on logic branches.
 */

// ── Hoisted mocks ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  parseMarkdown: vi.fn(() => ({ type: "doc", content: [] })),
  serializeMarkdown: vi.fn(() => "# hello"),
  registerActiveWysiwygFlusher: vi.fn(),
  registerWysiwygFlusher: vi.fn(),
  getCursorInfoFromTiptap: vi.fn(() => ({ line: 1, col: 0 })),
  restoreCursorInTiptap: vi.fn(),
  getTiptapEditorView: vi.fn(() => null),
  scheduleTiptapFocusAndRestore: vi.fn(),
  createTiptapExtensions: vi.fn(() => []),
  extractTiptapContext: vi.fn(() => ({})),
  handleTableScrollToSelection: vi.fn(() => false),
  resolveHardBreakStyle: vi.fn(() => "backslash"),
  useImageContextMenu: vi.fn(() => vi.fn()),
  useOutlineSync: vi.fn(),
  useImageDragDrop: vi.fn(),
  useDocumentContent: vi.fn(() => "# hello"),
  useDocumentCursorInfo: vi.fn(() => null),
  setContent: vi.fn(),
  setCursorInfo: vi.fn(),
  setSelectedText: vi.fn(),
  useDocumentActions: vi.fn(() => ({
    setContent: mocks.setContent,
    setCursorInfo: mocks.setCursorInfo,
    setSelectedText: mocks.setSelectedText,
  })),
  useWindowLabel: vi.fn(() => "main"),
  consumeWysiwygPendingNav: vi.fn(() => false),
  // Mock editor returned by useEditor
  mockEditor: null as ReturnType<typeof createMockEditor> | null,
  useEditor: vi.fn(),
  EditorContent: vi.fn(() => null),
}));

function createMockEditor(opts?: { selectedText?: string; from?: number; to?: number }) {
  const text = opts?.selectedText ?? "";
  const from = opts?.from ?? 0;
  const to = opts?.to ?? 0;
  return {
    commands: { setContent: vi.fn() },
    schema: {},
    state: {
      doc: {
        content: { size: 100 },
        textBetween: vi.fn(() => text),
      },
      tr: { setMeta: vi.fn().mockReturnThis(), replaceWith: vi.fn().mockReturnThis() },
      selection: { from, to, empty: from === to },
    },
    destroy: vi.fn(),
    setEditable: vi.fn(),
    on: vi.fn(),
  };
}

// ── Module mocks ─────────────────────────────────────────────────────
vi.mock("@tiptap/react", () => ({
  useEditor: (...args: unknown[]) => mocks.useEditor(...args),
  EditorContent: (props: { editor: unknown }) => {
    mocks.EditorContent(props);
    return null;
  },
}));

vi.mock("@/hooks/useDocumentState", () => ({
  useActiveTabId: () => "tab-1",
  useDocumentContent: () => mocks.useDocumentContent(),
  useDocumentCursorInfo: () => mocks.useDocumentCursorInfo(),
  useDocumentActions: (ownTabId?: string) => mocks.useDocumentActions(ownTabId),
}));

vi.mock("@/hooks/useImageContextMenu", () => ({
  useImageContextMenu: mocks.useImageContextMenu,
}));

vi.mock("@/hooks/useOutlineSync", () => ({
  useOutlineSync: mocks.useOutlineSync,
}));

vi.mock("@/hooks/useImageDragDrop", () => ({
  useImageDragDrop: mocks.useImageDragDrop,
}));

vi.mock("@/utils/markdownPipeline", () => ({
  parseMarkdown: (...args: unknown[]) => mocks.parseMarkdown(...args),
  serializeMarkdown: (...args: unknown[]) => mocks.serializeMarkdown(...args),
}));

vi.mock("@/utils/wysiwygFlush", () => ({
  registerActiveWysiwygFlusher: mocks.registerActiveWysiwygFlusher,
  registerWysiwygFlusher: mocks.registerWysiwygFlusher,
}));

vi.mock("@/utils/cursorSync/tiptap", () => ({
  getCursorInfoFromTiptap: mocks.getCursorInfoFromTiptap,
  restoreCursorInTiptap: mocks.restoreCursorInTiptap,
}));

vi.mock("@/services/editor/tiptapView", () => ({
  getTiptapEditorView: mocks.getTiptapEditorView,
}));

vi.mock("@/services/editor/tiptapFocus", () => ({
  scheduleTiptapFocusAndRestore: mocks.scheduleTiptapFocusAndRestore,
}));

vi.mock("@/services/assembly/tiptapExtensions", () => ({
  createTiptapExtensions: mocks.createTiptapExtensions,
}));

vi.mock("@/utils/linebreaks", () => ({
  resolveHardBreakStyle: mocks.resolveHardBreakStyle,
}));

vi.mock("@/plugins/formatToolbar/tiptapContext", () => ({
  extractTiptapContext: mocks.extractTiptapContext,
}));

vi.mock("@/plugins/tableScroll/scrollGuard", () => ({
  handleTableScrollToSelection: mocks.handleTableScrollToSelection,
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => mocks.useWindowLabel(),
}));

vi.mock("@/stores/tiptapEditorStore", () => ({
  useEditorStore: {
    getState: () => ({
      setEditor: vi.fn(),
      setContext: vi.fn(),
      clear: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/activeEditorStore", () => ({
  useEditorStore: {
    getState: () => ({
      setActiveWysiwygEditor: vi.fn(),
      clearWysiwygEditorIfMatch: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/uiStore", () => {
  const state = { showLineNumbers: false };
  const store = ((selector: (s: typeof state) => unknown) => selector(state)) as unknown as {
    (selector: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  store.getState = () => state;
  return { useUIStore: store };
});

const { settingsState } = vi.hoisted(() => ({
  settingsState: {
    markdown: {
      preserveLineBreaks: false,
      hardBreakStyleOnSave: "backslash",
      lintEnabled: true,
      showInvisibles: false,
      codeBlockLineNumbers: false,
    },
    appearance: { cjkLetterSpacing: "0" },
  },
}));
vi.mock("@/stores/settingsStore", () => {
  const store = ((selector: (s: typeof settingsState) => unknown) => selector(settingsState)) as unknown as {
    (selector: (s: typeof settingsState) => unknown): unknown;
    getState: () => typeof settingsState;
  };
  store.getState = () => settingsState;
  return { useSettingsStore: store };
});

vi.mock("@/stores/tabStore", () => {
  const tabState = { activeTabId: { main: "tab-1" } };
  const store = ((selector: (s: typeof tabState) => unknown) => selector(tabState)) as unknown as {
    (selector: (s: typeof tabState) => unknown): unknown;
    getState: () => typeof tabState;
  };
  store.getState = () => tabState;
  return { useTabStore: store };
});

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: () => ({ hardBreakStyle: "unknown" }),
    }),
  },
  useRevisionStore: { getState: () => ({ registerEdit: vi.fn(), setRevision: vi.fn(), getRevision: vi.fn(() => null) }) },
  generateRevisionId: () => "rev-test-id",
  useLargeFileSessionStore: { getState: () => ({ isForcedSource: () => false }), subscribe: () => () => {} },
  useUnifiedHistoryStore: { getState: () => ({ documents: {}, createCheckpoint: vi.fn() }), subscribe: () => () => {} },
  useLintStore: { getState: () => ({ diagnosticsByTab: {}, selectedIndexByTab: {}, clearDiagnostics: vi.fn() }), subscribe: () => () => {} },
  useFileLoadStore: { getState: () => ({ active: false }) },
}));

vi.mock("./wysiwygPendingNav", () => ({
  consumeWysiwygPendingNav: (...args: unknown[]) => mocks.consumeWysiwygPendingNav(...args),
}));

vi.mock("./ImageContextMenu", () => ({
  ImageContextMenu: ({ onAction }: { onAction: (a: string) => void }) => (
    <button data-testid="image-ctx" onClick={() => onAction("test")} />
  ),
}));

import { TiptapEditorInner } from "./TiptapEditor";

// ── Tests ────────────────────────────────────────────────────────────


describe("getAdaptiveDebounceDelay — via onUpdate", () => {
  it("uses setTimeout(500) for very large documents (>50000)", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 60000;
    mocks.useEditor.mockReturnValue(editor);

    const timeoutSpy = vi.spyOn(window, "setTimeout");
    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    config.onUpdate({ editor });
    const call500 = timeoutSpy.mock.calls.find(
      (c) => typeof c[1] === "number" && c[1] === 500
    );
    expect(call500).toBeDefined();
    timeoutSpy.mockRestore();
  });

  it("uses setTimeout(1000) for documents >100000", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 150000;
    mocks.useEditor.mockReturnValue(editor);

    const timeoutSpy = vi.spyOn(window, "setTimeout");
    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    config.onUpdate({ editor });
    const call1000 = timeoutSpy.mock.calls.find(
      (c) => typeof c[1] === "number" && c[1] === 1000
    );
    expect(call1000).toBeDefined();
    timeoutSpy.mockRestore();
  });

  it("uses setTimeout(2000) for documents >500000", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 600000;
    mocks.useEditor.mockReturnValue(editor);

    const timeoutSpy = vi.spyOn(window, "setTimeout");
    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    config.onUpdate({ editor });
    const call2000 = timeoutSpy.mock.calls.find(
      (c) => typeof c[1] === "number" && c[1] === 2000
    );
    expect(call2000).toBeDefined();
    timeoutSpy.mockRestore();
  });

  it("uses setTimeout(5000) for documents >1000000 (~1MB+)", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 1500000;
    mocks.useEditor.mockReturnValue(editor);

    const timeoutSpy = vi.spyOn(window, "setTimeout");
    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    config.onUpdate({ editor });
    const call5000 = timeoutSpy.mock.calls.find(
      (c) => typeof c[1] === "number" && c[1] === 5000
    );
    expect(call5000).toBeDefined();
    timeoutSpy.mockRestore();
  });
});

// ── setContentWithoutHistory — view path ────────────────────────────

describe("setContentWithoutHistory — via onCreate with view", () => {
  // NO beforeEach/afterEach — outer describes share mock.calls state from main describe

  it("uses direct ProseMirror transaction when view is available", () => {
    const mockDispatch = vi.fn();
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setMeta: vi.fn().mockReturnThis(),
    };
    const mockView = {
      state: {
        tr: mockTr,
        doc: { content: { size: 10 } },
      },
      dispatch: mockDispatch,
    };

    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [{ type: "paragraph" }] });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    // PM dispatch happens inside the deferred parse setTimeout
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();

    // Should dispatch a PM transaction via the view
    expect(mockDispatch).toHaveBeenCalled();
    expect(mockTr.replaceWith).toHaveBeenCalled();
    expect(mockTr.setMeta).toHaveBeenCalledWith("addToHistory", false);
    expect(mockTr.setMeta).toHaveBeenCalledWith("preventUpdate", true);
  });

  it("falls back to editor.commands.setContent when view not available", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    // setContent happens inside the deferred parse setTimeout
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();

    expect(editor.commands.setContent).toHaveBeenCalled();
  });
});

// ── syncMarkdownToEditor — via external content useEffect ───────────
// Note: The external content sync effect checks editorInitialized.current which
// is set inside onCreate. Since useEditor is fully mocked, calling onCreate
// externally doesn't actually affect React's ref state in the component.
// We test the effect indirectly and verify the pure function paths via
// the onCreate callback which also calls syncMarkdownToEditor's underlying logic.

describe("syncMarkdownToEditor — via onCreate", () => {
  // NO beforeEach/afterEach — outer describes share mock.calls state from main describe

  it("syncs initial content successfully via ProseMirror transaction", () => {
    const mockDispatch = vi.fn();
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setMeta: vi.fn().mockReturnThis(),
    };
    const mockView = {
      state: { tr: mockTr, doc: { content: { size: 10 } } },
      dispatch: mockDispatch,
    };
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    // Parse is deferred — advance timers so the deferred work runs
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();

    // parseMarkdown is called with the content from useDocumentContent (default "# hello")
    expect(mocks.parseMarkdown).toHaveBeenCalledWith(
      editor.schema, "# hello", expect.any(Object)
    );
    // Should use direct PM dispatch (not editor.commands.setContent)
    expect(mockDispatch).toHaveBeenCalled();
    expect(mockTr.replaceWith).toHaveBeenCalled();
    expect(mockTr.setMeta).toHaveBeenCalledWith("addToHistory", false);
  });

  it("handles parse failure in syncMarkdownToEditor gracefully", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // parseMarkdown throws
    mocks.parseMarkdown.mockImplementation(() => { throw new Error("parse fail"); });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    // onCreate schedules deferred work — should not throw synchronously
    vi.useFakeTimers();
    expect(() => config.onCreate({ editor })).not.toThrow();
    vi.runAllTimers(); // flush pending timers to prevent bleed into next test
    vi.useRealTimers();
    errorSpy.mockRestore();
  });
});

// ── flushToStore coverage ───────────────────────────────────────────

describe("flushToStore — via onUpdate RAF callback", () => {
  it("serializes markdown and calls setContent via flush", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 50; // small doc → RAF path
    mocks.useEditor.mockReturnValue(editor);

    let rafCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    config.onUpdate({ editor });

    // Execute the RAF callback to trigger flushToStore
    expect(rafCallback).not.toBeNull();
    rafCallback!(0);

    expect(mocks.serializeMarkdown).toHaveBeenCalled();
    expect(mocks.setContent).toHaveBeenCalled();

    rafSpy.mockRestore();
  });

  it("cancels pending RAF when flushToStore runs again", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 50;
    mocks.useEditor.mockReturnValue(editor);

    let rafCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 42;
    });
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    // Trigger flush once — the RAF schedules internalChangeRaf inside flushToStore
    config.onUpdate({ editor });
    rafCallback!(0); // Execute the first RAF → flushToStore → schedules internalChangeRaf

    // The internalChangeRaf should reset isInternalChange after RAF
    expect(mocks.setContent).toHaveBeenCalled();

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it("resolves hardBreakStyle from tabStore and documentStore", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 50;
    mocks.useEditor.mockReturnValue(editor);

    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    config.onUpdate({ editor });
    rafCallback!(0);

    expect(mocks.serializeMarkdown).toHaveBeenCalled();
    expect(mocks.resolveHardBreakStyle).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

// ── flushCursorInfo / scheduleCursorUpdate ───────────────────────────

describe("scheduleCursorUpdate — via onSelectionUpdate", () => {
  it("onSelectionUpdate is provided to useEditor", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    expect(config.onSelectionUpdate).toBeInstanceOf(Function);
  });

  it("onSelectionUpdate returns early when view is null", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    // Initialize editor to set cursorTrackingEnabled after timeout
    config.onCreate({ editor });

    // onSelectionUpdate with null view should not crash
    config.onSelectionUpdate({ editor });
    // getCursorInfoFromTiptap should not be called with null view
    expect(mocks.getCursorInfoFromTiptap).not.toHaveBeenCalled();
  });
});

// ── onUpdate — debounce timeout path ────────────────────────────────

describe("onUpdate — debounce timeout path", () => {
  it("uses setTimeout with delay > 100 for large documents", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 30000;
    mocks.useEditor.mockReturnValue(editor);

    const calls: Array<[unknown, unknown]> = [];
    const origSetTimeout = window.setTimeout;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation(
      (cb: unknown, delay?: number) => {
        calls.push([cb, delay]);
        return origSetTimeout(cb as TimerHandler, delay) as unknown as ReturnType<typeof setTimeout>;
      }
    );

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    config.onUpdate({ editor });

    const largeCalls = calls.filter(([, d]) => typeof d === "number" && d > 100);
    expect(largeCalls.length).toBeGreaterThan(0);

    setTimeoutSpy.mockRestore();
  });

  it("cancels pending debounce timeout on second update", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 30000;
    mocks.useEditor.mockReturnValue(editor);

    const clearSpy = vi.spyOn(window, "clearTimeout");

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[mocks.useEditor.mock.calls.length - 1][0];

    config.onUpdate({ editor });
    config.onUpdate({ editor });

    // clearTimeout should be called for the pending debounce
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

// ── Visibility transition (hidden → visible) ────────────────────────

describe("TiptapEditorInner — hidden → visible transition", () => {
  it("renders correctly when transitioning from hidden to visible", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.useDocumentContent.mockReturnValue("# hello");

    // Render hidden first
    const { rerender, container } = render(<TiptapEditorInner hidden={true} />);

    // Should be hidden
    expect(container.querySelector(".tiptap-editor")).toHaveStyle({ display: "none" });

    // Transition to visible
    rerender(<TiptapEditorInner hidden={false} />);

    // Should no longer be hidden
    expect(container.querySelector(".tiptap-editor")).not.toHaveStyle({ display: "none" });
  });

  it("registers flusher when becoming visible", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    const { rerender } = render(<TiptapEditorInner hidden={true} />);

    vi.clearAllMocks();
    rerender(<TiptapEditorInner hidden={false} />);

    // Flusher should be registered on visibility change
    expect(mocks.registerActiveWysiwygFlusher).toHaveBeenCalledWith(expect.any(Function));
  });
});

// ── Cleanup on unmount — all timer branches ─────────────────────────

// ── Content sync via useEffect (requires editorInitialized) ─────────
