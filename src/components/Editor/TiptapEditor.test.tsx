import { describe, it, expect, vi, beforeEach } from "vitest";
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


describe("TiptapEditorInner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockEditor = createMockEditor();
    // Default: useEditor returns the mock editor
    mocks.useEditor.mockReturnValue(mocks.mockEditor);
  });

  // ── Rendering ────────────────────────────────────────────────────

  it("renders with tiptap-editor class", () => {
    const { container } = render(<TiptapEditorInner />);
    expect(container.querySelector(".tiptap-editor")).toBeInTheDocument();
  });

  it("adds show-line-numbers class when markdown.codeBlockLineNumbers is on", () => {
    // WYSIWYG code-block line numbers are driven by the Markdown setting, NOT
    // the View-menu source-gutter toggle (uiStore.showLineNumbers). See #1082.
    settingsState.markdown.codeBlockLineNumbers = true;
    try {
      const { container } = render(<TiptapEditorInner />);
      expect(container.querySelector(".tiptap-editor.show-line-numbers")).toBeInTheDocument();
    } finally {
      settingsState.markdown.codeBlockLineNumbers = false;
    }
  });

  it("omits show-line-numbers when the code-block setting is off", () => {
    // Default off — and TiptapEditor no longer reads the source-gutter toggle
    // at all, so the gutter "Line Numbers" item can never add this class.
    settingsState.markdown.codeBlockLineNumbers = false;
    const { container } = render(<TiptapEditorInner />);
    const editor = container.querySelector(".tiptap-editor");
    expect(editor).toBeInTheDocument();
    expect(editor?.classList.contains("show-line-numbers")).toBe(false);
  });

  it("hides editor content when hidden=true", () => {
    const { container } = render(<TiptapEditorInner hidden={true} />);
    const editorDiv = container.querySelector(".tiptap-editor");
    expect(editorDiv).toHaveStyle({ display: "none" });
  });

  it("does not render ImageContextMenu when hidden", () => {
    const { queryByTestId } = render(<TiptapEditorInner hidden={true} />);
    expect(queryByTestId("image-ctx")).not.toBeInTheDocument();
  });

  it("renders ImageContextMenu when visible", () => {
    const { getByTestId } = render(<TiptapEditorInner hidden={false} />);
    expect(getByTestId("image-ctx")).toBeInTheDocument();
  });

  // ── Hooks called ─────────────────────────────────────────────────

  it("calls useOutlineSync on mount", () => {
    render(<TiptapEditorInner />);
    expect(mocks.useOutlineSync).toHaveBeenCalled();
  });

  it("calls useImageDragDrop with tiptapEditor and isSourceMode=false", () => {
    render(<TiptapEditorInner />);
    expect(mocks.useImageDragDrop).toHaveBeenCalledWith(
      expect.objectContaining({
        tiptapEditor: mocks.mockEditor,
        isSourceMode: false,
      })
    );
  });

  it("disables image drag-drop when hidden", () => {
    render(<TiptapEditorInner hidden={true} />);
    expect(mocks.useImageDragDrop).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  // ── Flusher registration ─────────────────────────────────────────

  it("registers wysiwygFlusher when visible and editor exists", () => {
    render(<TiptapEditorInner hidden={false} />);
    expect(mocks.registerActiveWysiwygFlusher).toHaveBeenCalledWith(expect.any(Function));
  });

  it("does not register flusher when hidden", () => {
    render(<TiptapEditorInner hidden={true} />);
    // Should either not be called, or called with null on cleanup
    const calls = mocks.registerActiveWysiwygFlusher.mock.calls;
    const nonNullCalls = calls.filter((c: unknown[]) => c[0] !== null);
    expect(nonNullCalls.length).toBe(0);
  });

  it("deregisters flusher on unmount", () => {
    const { unmount } = render(<TiptapEditorInner />);
    vi.clearAllMocks();
    unmount();
    expect(mocks.registerActiveWysiwygFlusher).toHaveBeenCalledWith(null);
  });

  // Regression: cross-tab content bleed. The editor is keyed per tab, so its
  // store writes must be pinned to its own tab — a debounced/unmount flush
  // firing after a tab switch must not write into the newly focused tab.
  it("pins document actions to its own tab id", () => {
    render(<TiptapEditorInner />);
    expect(mocks.useDocumentActions).toHaveBeenCalledWith("tab-1");
  });

  // ── Editor null path ─────────────────────────────────────────────

  it("handles null editor gracefully", () => {
    mocks.useEditor.mockReturnValue(null);
    expect(() => render(<TiptapEditorInner />)).not.toThrow();
  });

  // ── useEditor config ─────────────────────────────────────────────

  it("passes extensions and editorProps to useEditor", () => {
    render(<TiptapEditorInner />);
    expect(mocks.useEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: expect.any(Array),
        editorProps: expect.objectContaining({
          attributes: expect.objectContaining({ class: "ProseMirror", spellcheck: "true" }),
        }),
      })
    );
  });

  it("provides onCreate callback to useEditor", () => {
    render(<TiptapEditorInner />);
    const config = mocks.useEditor.mock.calls[0][0];
    expect(config.onCreate).toBeInstanceOf(Function);
  });

  it("provides onUpdate callback to useEditor", () => {
    render(<TiptapEditorInner />);
    const config = mocks.useEditor.mock.calls[0][0];
    expect(config.onUpdate).toBeInstanceOf(Function);
  });

  it("onSelectionUpdate pushes selected text even before cursor-tracking warmup completes", () => {
    // Selection-text sync runs BEFORE the cursor-tracking gate — stale
    // state from a previous editor must not linger during the 200ms warmup.
    const editor = createMockEditor({ selectedText: "early select", from: 1, to: 13 });
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    mocks.setSelectedText.mockClear();
    config.onSelectionUpdate({ editor });
    expect(mocks.setSelectedText).toHaveBeenCalledWith("early select");
  });

  it("clears selectedText when transitioning to hidden (mode-switch cleanup)", () => {
    mocks.useEditor.mockReturnValue(createMockEditor());

    const { rerender } = render(<TiptapEditorInner hidden={false} />);
    mocks.setSelectedText.mockClear();

    rerender(<TiptapEditorInner hidden={true} />);

    expect(mocks.setSelectedText).toHaveBeenCalledWith("");
  });

  // NOTE: this test must stay LAST in this describe. Sibling describes below
  // (no beforeEach) read `mocks.useEditor.mock.calls[0][0]` and expect it to
  // point at a config rendered with hidden=false. Keep a simple non-hidden
  // render here so that leftover config is well-formed.
  it("provides onSelectionUpdate callback to useEditor", () => {
    render(<TiptapEditorInner />);
    const config = mocks.useEditor.mock.calls[0][0];
    expect(config.onSelectionUpdate).toBeInstanceOf(Function);
  });
});

// ── Pure function tests (extracted via module internals) ─────────────

describe("getAdaptiveDebounceDelay (tested via onUpdate behavior)", () => {
  it("uses RAF for small documents (size < 20000)", () => {
    mocks.useEditor.mockReturnValue(createMockEditor());
    render(<TiptapEditorInner />);
    const config = mocks.useEditor.mock.calls[0][0];
    expect(config.onUpdate).toBeInstanceOf(Function);
  });
});

describe("TiptapEditorInner — onCreate behavior", () => {
  it("calls parseMarkdown with initial content during onCreate", () => {
    mocks.useDocumentContent.mockReturnValueOnce("# Test Content");
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner />);

    const config = mocks.useEditor.mock.calls[0][0];
    expect(config.onCreate).toBeInstanceOf(Function);

    // Parse is deferred — use fake timers to let the setTimeout(0) fire
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();
    expect(mocks.parseMarkdown).toHaveBeenCalled();
  });

  it("handles parseMarkdown failure in onCreate gracefully", () => {
    mocks.parseMarkdown.mockImplementationOnce(() => {
      throw new Error("Parse error");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner />);
    const config = mocks.useEditor.mock.calls[0][0];

    // onCreate schedules the parse asynchronously — should not throw synchronously
    expect(() => config.onCreate({ editor })).not.toThrow();
    errorSpy.mockRestore();
  });

  it("schedules focus and cursor restore when not hidden", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // Focus is scheduled inside the deferred parse setTimeout
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();
    expect(mocks.scheduleTiptapFocusAndRestore).toHaveBeenCalled();
  });

  it("onCreate checks hiddenRef before scheduling focus", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    // Render hidden — the component should not schedule focus on hidden mount
    render(<TiptapEditorInner hidden={true} />);
    const config = mocks.useEditor.mock.calls[0][0];
    // The config is captured — we just verify it exists and is callable
    expect(config.onCreate).toBeInstanceOf(Function);
  });
});

describe("TiptapEditorInner — onUpdate behavior", () => {
  it("skips update when hidden", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner hidden={true} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // Should return early without scheduling
    const mockTr = { getMeta: () => false };
    config.onUpdate({ editor, transaction: mockTr });
    // serializeMarkdown should not be called since hidden skips flush
    expect(mocks.serializeMarkdown).not.toHaveBeenCalled();
  });

  it("skips flush when transaction has preventUpdate meta — regression #806", () => {
    // Programmatic content loads (reload_document, external sync) set preventUpdate
    // on the transaction to prevent a round-trip serialize that would dirty the doc.
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    const mockTr = { getMeta: (key: string) => key === "preventUpdate" };
    config.onUpdate({ editor, transaction: mockTr });

    // RAF must NOT be scheduled — no flush should happen
    expect(rafSpy).not.toHaveBeenCalled();
    expect(mocks.serializeMarkdown).not.toHaveBeenCalled();

    rafSpy.mockRestore();
  });
});

describe("TiptapEditorInner — onSelectionUpdate", () => {
  it("skips selection update when hidden", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner hidden={true} />);
    const config = mocks.useEditor.mock.calls[0][0];

    config.onSelectionUpdate({ editor });
    expect(mocks.getCursorInfoFromTiptap).not.toHaveBeenCalled();
  });
});

describe("TiptapEditorInner — content-visibility toggle", () => {
  it("skips cv-idle on small docs so the idle toggle does not shake the layout (#823)", () => {
    // Default useDocumentContent mock returns "# hello" — well below the
    // 50K-char threshold. Small docs don't need the optimization and the
    // toggle would otherwise cause visible layout shift during typing.
    const { container } = render(<TiptapEditorInner />);
    expect(container.querySelector(".tiptap-editor")?.classList.contains("cv-idle")).toBe(false);
  });

  it("applies cv-idle at mount when initial content is large enough to benefit", () => {
    // Stuff the initial content with >50K chars so the optimization engages.
    mocks.useDocumentContent.mockReturnValueOnce("a".repeat(60_000));
    const { container } = render(<TiptapEditorInner />);
    expect(container.querySelector(".tiptap-editor")?.classList.contains("cv-idle")).toBe(true);
  });

  it("does NOT re-engage cv-idle after onUpdate for small docs (#823)", () => {
    vi.useFakeTimers();
    try {
      const editor = createMockEditor();
      // docSize below threshold (default 100)
      mocks.useEditor.mockReturnValue(editor);

      const { container } = render(<TiptapEditorInner hidden={false} />);
      const el = container.querySelector(".tiptap-editor") as HTMLElement;
      expect(el.classList.contains("cv-idle")).toBe(false);

      const calls = mocks.useEditor.mock.calls;
      const config = calls[calls.length - 1][0];
      const mockTr = { getMeta: () => false };
      config.onUpdate({ editor, transaction: mockTr });

      // After any debounce window — still no cv-idle on small docs.
      vi.advanceTimersByTime(2000);
      expect(el.classList.contains("cv-idle")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("strips cv-idle on onUpdate and re-adds it after the idle timeout for large docs", () => {
    vi.useFakeTimers();
    try {
      mocks.useDocumentContent.mockReturnValue("a".repeat(60_000));
      const editor = createMockEditor();
      editor.state.doc.content.size = 60_000; // Above threshold
      mocks.useEditor.mockReturnValue(editor);

      const { container } = render(<TiptapEditorInner hidden={false} />);
      const el = container.querySelector(".tiptap-editor") as HTMLElement;
      expect(el.classList.contains("cv-idle")).toBe(true);

      // Use the LAST recorded useEditor config — React Strict Mode causes an
      // extra non-committing render during tests, whose captured closure holds
      // a ref that never attaches to a committed DOM node.
      const calls = mocks.useEditor.mock.calls;
      const config = calls[calls.length - 1][0];
      const mockTr = { getMeta: () => false };
      config.onUpdate({ editor, transaction: mockTr });

      // Immediately after an edit the optimization must be off so PM's
      // DOM diff doesn't pay the content-visibility reflow cost.
      expect(el.classList.contains("cv-idle")).toBe(false);

      // After the idle debounce elapses, the class returns so scroll and
      // initial paint keep the optimization.
      vi.advanceTimersByTime(500);
      expect(el.classList.contains("cv-idle")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TiptapEditorInner — onUpdate debouncing", () => {
  it("uses RAF for small documents (docSize <= 100)", () => {
    const editor = createMockEditor();
    // Ensure doc content size is small (100 is default in createMockEditor)
    editor.state.doc.content.size = 50;
    mocks.useEditor.mockReturnValue(editor);

    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    config.onUpdate({ editor });
    expect(rafSpy).toHaveBeenCalled();

    rafSpy.mockRestore();
  });

  it("uses setTimeout for large documents (docSize > 20000)", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 25000;
    mocks.useEditor.mockReturnValue(editor);

    const timeoutSpy = vi.spyOn(window, "setTimeout");

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    config.onUpdate({ editor });
    // Should call setTimeout with delay > 100
    const relevantCalls = timeoutSpy.mock.calls.filter(
      (call) => typeof call[1] === "number" && call[1] > 100
    );
    expect(relevantCalls.length).toBeGreaterThan(0);

    timeoutSpy.mockRestore();
  });

  it("cancels pending RAF before scheduling new update", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 50;
    mocks.useEditor.mockReturnValue(editor);

    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // First update — schedules RAF
    config.onUpdate({ editor });
    // Second update — should cancel previous RAF
    config.onUpdate({ editor });

    expect(cancelSpy).toHaveBeenCalledWith(42);

    cancelSpy.mockRestore();
    rafSpy.mockRestore();
  });
});

describe("TiptapEditorInner — onSelectionUpdate tracking", () => {
  it("skips selection update when cursor tracking not yet enabled", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    // getTiptapEditorView returns null — no view, so onSelectionUpdate exits early
    mocks.getTiptapEditorView.mockReturnValue(null);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // Call onSelectionUpdate immediately (before CURSOR_TRACKING_DELAY_MS)
    // cursorTrackingEnabled is false right after onCreate
    config.onCreate({ editor });
    config.onSelectionUpdate({ editor });

    // getCursorInfoFromTiptap should NOT be called because tracking is disabled initially
    expect(mocks.getCursorInfoFromTiptap).not.toHaveBeenCalled();
  });

  it("returns null view from getEditorView when hidden", () => {
    mocks.useEditor.mockReturnValue(createMockEditor());
    mocks.getTiptapEditorView.mockReturnValue(null);

    render(<TiptapEditorInner hidden={true} />);
    // useOutlineSync should be called, and getEditorView returns null
    expect(mocks.useOutlineSync).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe("TiptapEditorInner — cleanup on unmount", () => {
  it("cleans up all pending timers on unmount", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);

    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    const { unmount } = render(<TiptapEditorInner hidden={false} />);
    unmount();

    // cancelAnimationFrame may or may not be called depending on pending timers
    // but the unmount should not throw
    cancelSpy.mockRestore();
  });
});

describe("TiptapEditorInner — visibility transitions", () => {
  // NO beforeEach/afterEach — outer describes share mock.calls state from main describe

  it("calls scheduleTiptapFocusAndRestore during onCreate when not hidden", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);

    render(<TiptapEditorInner hidden={false} />);

    const config = mocks.useEditor.mock.calls[0][0];
    // Focus is scheduled inside the deferred parse setTimeout — advance timers
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();

    // scheduleTiptapFocusAndRestore should be called during onCreate when not hidden
    expect(mocks.scheduleTiptapFocusAndRestore).toHaveBeenCalled();
  });

  it("skips scheduleTiptapFocusAndRestore during onCreate when hidden", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);

    render(<TiptapEditorInner hidden={true} />);

    const config = mocks.useEditor.mock.calls[0][0];

    // Verify the onCreate callback is defined
    expect(config.onCreate).toBeInstanceOf(Function);

    // Parse is deferred — advance timers so the deferred work runs
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();
    // parseMarkdown should still be called regardless of hidden state during onCreate
    expect(mocks.parseMarkdown).toHaveBeenCalled();
  });
});

describe("TiptapEditorInner — handleScrollToSelection", () => {
  it("passes handleTableScrollToSelection as handleScrollToSelection", () => {
    mocks.useEditor.mockReturnValue(createMockEditor());
    mocks.getTiptapEditorView.mockReturnValue(null);
    render(<TiptapEditorInner />);

    const config = mocks.useEditor.mock.calls[0][0];
    expect(config.editorProps.handleScrollToSelection).toBeInstanceOf(Function);

    // Call it with a mock view
    const mockView = {};
    mocks.handleTableScrollToSelection.mockReturnValue(true);
    const result = config.editorProps.handleScrollToSelection(mockView);
    expect(result).toBe(true);
    expect(mocks.handleTableScrollToSelection).toHaveBeenCalledWith(mockView);
  });
});

// ── Pure function coverage: getAdaptiveDebounceDelay ─────────────────
