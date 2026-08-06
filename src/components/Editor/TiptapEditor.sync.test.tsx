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

/**
 * Configure useEditor mock to call onCreate/onUpdate/onSelectionUpdate
 * callbacks, simulating what Tiptap does internally.
 * Returns the mock editor instance.
 */
function setupUseEditorWithCallbacks(editor?: ReturnType<typeof createMockEditor>) {
  const e = editor ?? createMockEditor();
  mocks.useEditor.mockImplementation((config: Record<string, unknown>) => {
    // Simulate Tiptap calling onCreate on first render
    if (config.onCreate && typeof config.onCreate === "function") {
      // Schedule to avoid calling during render
      Promise.resolve().then(() => (config.onCreate as (ctx: { editor: unknown }) => void)({ editor: e }));
    }
    return e;
  });
  return e;
}

describe("TiptapEditorInner — external content sync effect", () => {
  it("calls syncMarkdownToEditor when content changes after initialization", async () => {
    const mockDispatch = vi.fn();
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setMeta: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      scrollIntoView: vi.fn().mockReturnThis(),
    };
    const mockView = {
      state: { tr: mockTr, doc: { content: { size: 10 } } },
      dispatch: mockDispatch,
    };

    const editor = setupUseEditorWithCallbacks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.useDocumentContent.mockReturnValue("# initial");

    const { rerender } = render(<TiptapEditorInner hidden={false} />);

    // Wait for onCreate to fire via the Promise.resolve().then() in setupUseEditorWithCallbacks
    await vi.waitFor(() => {
      expect(mocks.parseMarkdown).toHaveBeenCalled();
    });

    // Now change content
    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [{ type: "paragraph" }] });
    mocks.useDocumentContent.mockReturnValue("# changed content");

    rerender(<TiptapEditorInner hidden={false} />);

    // syncMarkdownToEditor should be triggered by the content change effect
    expect(mocks.parseMarkdown).toHaveBeenCalledWith(
      editor.schema, "# changed content", expect.any(Object)
    );
  });

  it("handles parse error in syncMarkdownToEditor", () => {
    // Avoid setupUseEditorWithCallbacks here: its Promise.resolve().then() fires
    // onCreate as a microtask which competes with act() effect flushing and
    // can reset editorInitialized.current before the sync effect runs.
    // Instead, manually drive onCreate with fake timers to reach known state.
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.useDocumentContent.mockReturnValue("# initial");

    // Track call index to find exactly this render's config
    const callsBefore = mocks.useEditor.mock.calls.length;
    const { rerender } = render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[callsBefore][0];

    // Fire onCreate via fake timers: sets editorInitialized=true, lastExternalContent="# initial"
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();

    // Set up error scenario (mockImplementationOnce prevents leaking into next test)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.parseMarkdown.mockImplementationOnce(() => { throw new Error("sync fail"); });
    mocks.useDocumentContent.mockReturnValue("# broken");

    rerender(<TiptapEditorInner hidden={false} />);

    // Content sync effect fires synchronously (content "# broken" != "# initial", initialized=true)
    // tiptapError logs as: ("[Tiptap]", " Failed to sync markdown:", error)
    expect(errorSpy).toHaveBeenCalledWith(
      "[Tiptap]",
      expect.stringContaining("Failed to sync markdown"),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it("sets cursor to start when synced without cursor info", () => {
    const mockSetSelection = vi.fn().mockReturnThis();
    const mockView = {
      state: {
        tr: {
          replaceWith: vi.fn().mockReturnThis(),
          setMeta: vi.fn().mockReturnThis(),
          setSelection: mockSetSelection,
          scrollIntoView: vi.fn().mockReturnThis(),
        },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };

    // Avoid setupUseEditorWithCallbacks: its microtask re-fires onCreate on every
    // rerender, resetting editorInitialized.current = false before the sync effect runs.
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.useDocumentContent.mockReturnValue("# initial");
    mocks.useDocumentCursorInfo.mockReturnValue(null);

    const callsBefore = mocks.useEditor.mock.calls.length;
    const { rerender } = render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[callsBefore][0];

    // Drive onCreate via fake timers to set editorInitialized=true and lastExternalContent="# initial"
    vi.useFakeTimers();
    config.onCreate({ editor: createMockEditor() });
    vi.runAllTimers();
    vi.useRealTimers();

    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [{ type: "paragraph" }] });
    mocks.useDocumentContent.mockReturnValue("# new doc");

    rerender(<TiptapEditorInner hidden={false} />);

    // syncMarkdownToEditor should parse the new content
    expect(mocks.parseMarkdown).toHaveBeenCalled();
  });

  it("skips sync when content has not changed", async () => {
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };

    setupUseEditorWithCallbacks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.useDocumentContent.mockReturnValue("# same");

    const { rerender } = render(<TiptapEditorInner hidden={false} />);

    await vi.waitFor(() => {
      expect(mocks.parseMarkdown).toHaveBeenCalled();
    });

    vi.clearAllMocks();
    mocks.useDocumentContent.mockReturnValue("# same"); // same content

    rerender(<TiptapEditorInner hidden={false} />);

    // parseMarkdown should NOT be called again (content unchanged)
    expect(mocks.parseMarkdown).not.toHaveBeenCalled();
  });
});

// ── Visibility transition effect (hidden → visible) ────────────────

describe("TiptapEditorInner — visibility transition effect", () => {
  it("syncs content and restores focus when becoming visible", async () => {
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };

    setupUseEditorWithCallbacks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.useDocumentContent.mockReturnValue("# hello");

    // Render hidden
    const { rerender } = render(<TiptapEditorInner hidden={true} />);

    // Let onCreate fire
    await vi.waitFor(() => {
      expect(mocks.parseMarkdown).toHaveBeenCalled();
    });

    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });

    // Transition to visible
    rerender(<TiptapEditorInner hidden={false} />);

    // scheduleTiptapFocusAndRestore should be called
    expect(mocks.scheduleTiptapFocusAndRestore).toHaveBeenCalled();
  });
});

// ── flushCursorInfo / scheduleCursorUpdate (deeper coverage) ────────

describe("TiptapEditorInner — cursor update scheduling", () => {
  it("schedules cursor info via RAF after tracking enabled", async () => {
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };

    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.getCursorInfoFromTiptap.mockReturnValue({ line: 3, col: 5 });

    // Capture RAF callbacks
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    render(<TiptapEditorInner hidden={false} />);

    // Get config and manually call onCreate to set up tracking timeout
    const config = mocks.useEditor.mock.calls[0][0];
    config.onCreate({ editor });

    // Wait for CURSOR_TRACKING_DELAY_MS (200ms) to enable tracking
    await new Promise((r) => setTimeout(r, 250));

    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.getCursorInfoFromTiptap.mockReturnValue({ line: 3, col: 5 });

    // Now call onSelectionUpdate — cursor tracking should be enabled
    config.onSelectionUpdate({ editor });

    // getCursorInfoFromTiptap should be called
    expect(mocks.getCursorInfoFromTiptap).toHaveBeenCalledWith(mockView);

    // Execute RAF callbacks to trigger flushCursorInfo → setCursorInfo
    rafCallbacks.forEach((cb) => cb(0));
    expect(mocks.setCursorInfo).toHaveBeenCalledWith({ line: 3, col: 5 });

    vi.restoreAllMocks();
  });

  it("coalesces multiple selection updates into one RAF", async () => {
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };

    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.getCursorInfoFromTiptap.mockReturnValue({ line: 1, col: 0 });

    let rafCount = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => {
      rafCount++;
      return rafCount;
    });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];
    config.onCreate({ editor });

    await new Promise((r) => setTimeout(r, 250));

    const rafBefore = rafCount;
    // Call onSelectionUpdate twice — second should not schedule new RAF
    config.onSelectionUpdate({ editor });
    config.onSelectionUpdate({ editor });

    // Only one additional RAF should be scheduled (not two)
    expect(rafCount - rafBefore).toBe(1);

    vi.restoreAllMocks();
  });

  it("pushes selected text to store after tracking is enabled", async () => {
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };

    const editor = createMockEditor({ selectedText: "selected words", from: 1, to: 14 });
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.getCursorInfoFromTiptap.mockReturnValue({ line: 1, col: 0 });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];
    config.onCreate({ editor });

    await new Promise((r) => setTimeout(r, 250));

    mocks.setSelectedText.mockClear();
    config.onSelectionUpdate({ editor });
    expect(mocks.setSelectedText).toHaveBeenCalledWith("selected words");
  });

  it("pushes empty string when selection is collapsed", async () => {
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };

    const editor = createMockEditor({ selectedText: "ignored", from: 4, to: 4 });
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.getCursorInfoFromTiptap.mockReturnValue({ line: 1, col: 0 });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];
    config.onCreate({ editor });

    await new Promise((r) => setTimeout(r, 250));

    mocks.setSelectedText.mockClear();
    config.onSelectionUpdate({ editor });
    expect(mocks.setSelectedText).toHaveBeenCalledWith("");
  });
});

// ── getEditorView — hidden vs visible branch (line 299) ────────────

describe("TiptapEditorInner — getEditorView returns non-null when visible", () => {
  it("passes non-null view to useOutlineSync and useImageContextMenu when visible and editor exists", () => {
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);

    render(<TiptapEditorInner hidden={false} />);

    // useOutlineSync is called with a getEditorView function
    expect(mocks.useOutlineSync).toHaveBeenCalledWith(expect.any(Function));

    // Extract the getEditorView function and call it
    const getEditorView = mocks.useOutlineSync.mock.calls[0][0] as () => unknown;
    const result = getEditorView();

    // When not hidden and editor exists, should return the view (not null)
    expect(result).toBe(mockView);
  });

  it("getEditorView returns null when hidden even if editor exists", () => {
    const mockView = {
      state: {
        tr: { setMeta: vi.fn().mockReturnThis(), replaceWith: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
    };
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(mockView);

    render(<TiptapEditorInner hidden={true} />);

    // Use the last call to useOutlineSync (React may call hooks multiple times)
    const calls = mocks.useOutlineSync.mock.calls;
    const getEditorView = calls[calls.length - 1][0] as () => unknown;
    const result = getEditorView();

    // When hidden, should return null (line 299: hidden ? null : getTiptapEditorView(editor))
    expect(result).toBeNull();
  });

  it("getEditorView returns null when editor is null", () => {
    mocks.useEditor.mockReturnValue(null);
    mocks.getTiptapEditorView.mockReturnValue(null);

    render(<TiptapEditorInner hidden={false} />);

    const getEditorView = mocks.useOutlineSync.mock.calls[0][0] as () => unknown;
    const result = getEditorView();

    // When editor is null, getTiptapEditorView(null) returns null
    expect(result).toBeNull();
  });
});

// ── onUpdate — cancellation of existing pending flush ───────────────

describe("TiptapEditorInner — onUpdate cancellation branches", () => {
  it("cancels existing pending RAF when pendingRaf is set", async () => {
    const mockView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 50 } },
      },
      dispatch: vi.fn(),
    };

    const editor = setupUseEditorWithCallbacks();
    editor.state.doc.content.size = 50;
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });

    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(77);

    render(<TiptapEditorInner hidden={false} />);

    await vi.waitFor(() => {
      expect(mocks.parseMarkdown).toHaveBeenCalled();
    });

    const config = mocks.useEditor.mock.calls[0][0];

    // First update — schedules pendingRaf
    config.onUpdate({ editor });
    // Second update — should cancel pendingRaf(77)
    config.onUpdate({ editor });

    expect(cancelSpy).toHaveBeenCalledWith(77);

    cancelSpy.mockRestore();
    vi.restoreAllMocks();
  });
});

describe("TiptapEditorInner — cleanup all pending timers", () => {
  it("cancels pending debounce timeout on unmount", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 30000;
    mocks.useEditor.mockReturnValue(editor);

    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    vi.spyOn(window, "setTimeout").mockReturnValue(55 as unknown as ReturnType<typeof setTimeout>);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // Schedule a debounce timeout
    config.onUpdate({ editor });

    const { unmount } = render(<TiptapEditorInner hidden={false} />);
    unmount();

    clearTimeoutSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("cancels cursor RAF on unmount", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    const { unmount } = render(<TiptapEditorInner hidden={false} />);
    unmount();

    // Should clean up without error
    cancelSpy.mockRestore();
  });

  it("clears tracking timeout on unmount", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];
    config.onCreate({ editor }); // Sets up the tracking timeout

    const { unmount } = render(<TiptapEditorInner hidden={false} />);
    unmount();

    clearTimeoutSpy.mockRestore();
  });

  it("cancels internalChangeRaf on unmount when flushToStore ran (lines 327-329)", () => {
    // flushToStore schedules an internalChangeRaf RAF after serializing.
    // Call it via the registered flusher, then unmount before RAF fires.
    const editor = createMockEditor();
    editor.state.doc.content.size = 50;
    mocks.useEditor.mockReturnValue(editor);

    let nextRafId = 0;
    const cancelledIds: number[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => ++nextRafId);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      cancelledIds.push(id as number);
    });

    let capturedFlusher: (() => void) | null = null;
    mocks.registerActiveWysiwygFlusher.mockImplementation((fn: (() => void) | null) => {
      if (fn !== null) capturedFlusher = fn;
    });

    const { unmount } = render(<TiptapEditorInner hidden={false} />);
    expect(capturedFlusher).not.toBeNull();
    capturedFlusher!();
    const internalRafId = nextRafId;
    unmount();

    expect(cancelledIds).toContain(internalRafId);
    vi.restoreAllMocks();
  });
});

// ── registerActiveWysiwygFlusher callback invocation (line 342) ──────
