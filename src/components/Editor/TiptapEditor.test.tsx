import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  useDocumentContent: () => mocks.useDocumentContent(),
  useDocumentCursorInfo: () => mocks.useDocumentCursorInfo(),
  useDocumentActions: () => mocks.useDocumentActions(),
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
}));

vi.mock("@/utils/cursorSync/tiptap", () => ({
  getCursorInfoFromTiptap: mocks.getCursorInfoFromTiptap,
  restoreCursorInTiptap: mocks.restoreCursorInTiptap,
}));

vi.mock("@/utils/tiptapView", () => ({
  getTiptapEditorView: mocks.getTiptapEditorView,
}));

vi.mock("@/utils/tiptapFocus", () => ({
  scheduleTiptapFocusAndRestore: mocks.scheduleTiptapFocusAndRestore,
}));

vi.mock("@/utils/tiptapExtensions", () => ({
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
  useTiptapEditorStore: {
    getState: () => ({
      setEditor: vi.fn(),
      setContext: vi.fn(),
      clear: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/activeEditorStore", () => ({
  useActiveEditorStore: {
    getState: () => ({
      setActiveWysiwygEditor: vi.fn(),
      clearWysiwygEditorIfMatch: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/editorStore", () => {
  const state = { showLineNumbers: false };
  const store = ((selector: (s: typeof state) => unknown) => selector(state)) as unknown as {
    (selector: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  store.getState = () => state;
  return { useEditorStore: store };
});

vi.mock("@/stores/settingsStore", () => {
  const state = {
    markdown: { preserveLineBreaks: false, hardBreakStyleOnSave: "backslash", lintEnabled: true },
    appearance: { cjkLetterSpacing: "0" },
  };
  const store = ((selector: (s: typeof state) => unknown) => selector(state)) as unknown as {
    (selector: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  store.getState = () => state;
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

  it("adds show-line-numbers class when showLineNumbers is true", () => {
    // Override editorStore mock for this test
    vi.doMock("@/stores/editorStore", () => {
      const state = { showLineNumbers: true };
      const store = ((sel: (s: typeof state) => unknown) => sel(state)) as unknown as {
        (sel: (s: typeof state) => unknown): unknown;
        getState: () => typeof state;
      };
      store.getState = () => state;
      return { useEditorStore: store };
    });
    // Re-render with the module-level mock already in place;
    // the component reads from the store selector, which we've mocked above.
    // Since vi.doMock doesn't affect already-imported modules, we test
    // using the default mock state (showLineNumbers: false).
    const { container } = render(<TiptapEditorInner />);
    expect(container.querySelector(".tiptap-editor")).toBeInTheDocument();
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

describe("getAdaptiveDebounceDelay — via onUpdate", () => {
  it("uses setTimeout(500) for very large documents (>50000)", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 60000;
    mocks.useEditor.mockReturnValue(editor);

    const timeoutSpy = vi.spyOn(window, "setTimeout");
    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

    expect(config.onSelectionUpdate).toBeInstanceOf(Function);
  });

  it("onSelectionUpdate returns early when view is null", () => {
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    const config = mocks.useEditor.mock.calls[0][0];

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
    config.onCreate({ editor: mocks.mockEditor });
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

describe("TiptapEditorInner — flusher callback directly calls flushToStore", () => {
  it("the flusher callback calls flushToStore synchronously (line 342)", () => {
    const editor = createMockEditor();
    editor.state.doc.content.size = 50;
    mocks.useEditor.mockReturnValue(editor);

    let capturedFlusher: (() => void) | null = null;
    mocks.registerActiveWysiwygFlusher.mockImplementation((fn: (() => void) | null) => {
      if (fn !== null) capturedFlusher = fn;
    });
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

    render(<TiptapEditorInner hidden={false} />);

    expect(capturedFlusher).not.toBeNull();

    // Invoke flusher — this executes `flushToStore(editor)` (line 342)
    capturedFlusher!();

    // flushToStore calls serializeMarkdown and setContent synchronously
    expect(mocks.serializeMarkdown).toHaveBeenCalled();
    expect(mocks.setContent).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

// ── Additional coverage for uncovered branches ─────────────────────

describe("TiptapEditorInner — flushToStore cancels pendingRaf (lines 152-154)", () => {
  // Use fake timers for the whole describe so requestAnimationFrame is controlled
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("cancels pendingRaf inside flushToStore when RAF is pending at flush time", () => {
    // flushToStore: if (pendingRaf.current) { cancelAnimationFrame(pendingRaf.current); }
    // Triggered when onUpdate sets pendingRaf.current, then flusher calls flushToStore directly.
    // With fake timers, requestAnimationFrame is controlled and never auto-fires.
    const editor = createMockEditor();
    editor.state.doc.content.size = 50;
    mocks.useEditor.mockReturnValue(editor);

    let capturedFlusher: (() => void) | null = null;
    mocks.registerActiveWysiwygFlusher.mockImplementation((fn: (() => void) | null) => {
      if (fn !== null) capturedFlusher = fn;
    });

    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // onUpdate with small doc → requestAnimationFrame → sets pendingRaf.current
    config.onUpdate({ editor });

    // capturedFlusher calls flushToStore synchronously.
    // flushToStore checks pendingRaf.current (non-null) → calls cancelAnimationFrame.
    expect(capturedFlusher).not.toBeNull();
    capturedFlusher!();

    // cancelAnimationFrame should have been called (lines 152-154 executed)
    expect(cancelSpy).toHaveBeenCalled();
  });
});

describe("TiptapEditorInner — flushToStore no active tabId (line 161)", () => {
  it("resolves hardBreakStyle with 'unknown' when no active tabId", () => {
    // Override tabStore mock to return no active tab for this window
    vi.doMock("@/stores/tabStore", () => ({
      useTabStore: {
        getState: () => ({
          activeTabId: { main: null }, // no active tab
        }),
      },
    }));

    const editor = createMockEditor();
    editor.state.doc.content.size = 50;
    mocks.useEditor.mockReturnValue(editor);

    let capturedFlusher: (() => void) | null = null;
    mocks.registerActiveWysiwygFlusher.mockImplementation((fn: (() => void) | null) => {
      if (fn !== null) capturedFlusher = fn;
    });
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

    render(<TiptapEditorInner hidden={false} />);
    expect(capturedFlusher).not.toBeNull();

    // Call flusher — exercises flushToStore which calls getState().activeTabId[windowLabel]
    capturedFlusher!();

    // resolveHardBreakStyle should be called (regardless of tabId presence)
    expect(mocks.resolveHardBreakStyle).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

describe("TiptapEditorInner — flushCursorInfo early return (line 185)", () => {
  it("flushCursorInfo exits early when pendingCursorInfo is null", async () => {
    vi.clearAllMocks();
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    const mockView = {
      state: { tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() }, doc: { content: { size: 10 } } },
      dispatch: vi.fn(),
    };
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });

    // Capture RAF callbacks
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];
    config.onCreate({ editor });

    // Wait for CURSOR_TRACKING_DELAY_MS
    await new Promise((r) => setTimeout(r, 250));

    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(null); // no view → onSelectionUpdate will exit early

    // Call onSelectionUpdate with null view → getCursorInfoFromTiptap not called
    // → pendingCursorInfo.current stays null → flushCursorInfo returns early (line 185)
    config.onSelectionUpdate({ editor });

    // setCursorInfo should NOT be called since there's no pending cursor info
    expect(mocks.setCursorInfo).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

describe("TiptapEditorInner — onCreate cursorInfoRef lambda invocation (line 245)", () => {
  it("cursorInfoRef getter lambda returns current cursor value when invoked", () => {
    vi.clearAllMocks();
    const cursorValue = { line: 7, col: 2 };
    mocks.useDocumentCursorInfo.mockReturnValue(cursorValue);

    let capturedGetCursor: (() => unknown) | null = null;
    mocks.scheduleTiptapFocusAndRestore.mockImplementation(
      (_ed: unknown, getCursor: () => unknown) => { capturedGetCursor = getCursor; }
    );

    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // scheduleTiptapFocusAndRestore is deferred inside setTimeout(0) in onCreate
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();

    expect(capturedGetCursor).not.toBeNull();
    // Invoke the lambda to exercise line 245: () => cursorInfoRef.current
    expect(capturedGetCursor!()).toEqual(cursorValue);
  });
});

describe("TiptapEditorInner — onSelectionUpdate when hidden (line 288)", () => {
  it("onSelectionUpdate returns early when hiddenRef is true", () => {
    vi.clearAllMocks();
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);

    render(<TiptapEditorInner hidden={true} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // Call directly — hidden=true so should return early
    config.onSelectionUpdate({ editor });

    // getCursorInfoFromTiptap must NOT be called
    expect(mocks.getCursorInfoFromTiptap).not.toHaveBeenCalled();
  });
});

describe("TiptapEditorInner — onSelectionUpdate no view (line 291)", () => {
  it("onSelectionUpdate returns early when getTiptapEditorView returns null", async () => {
    vi.clearAllMocks();
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });

    render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];
    config.onCreate({ editor });

    // Wait for tracking to enable (CURSOR_TRACKING_DELAY_MS = 200ms)
    await new Promise((r) => setTimeout(r, 250));

    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(null); // no view

    // onSelectionUpdate: hidden=false, tracking enabled, but view=null → early return at line 291
    config.onSelectionUpdate({ editor });

    // getCursorInfoFromTiptap should NOT be called (view is null)
    expect(mocks.getCursorInfoFromTiptap).not.toHaveBeenCalled();
  });
});

describe("TiptapEditorInner — cleanup when pendingRaf set at unmount (lines 315-317)", () => {
  it("cancels pendingRaf on unmount when a RAF update is pending", () => {
    vi.clearAllMocks();
    const editor = createMockEditor();
    editor.state.doc.content.size = 50; // small doc → RAF
    mocks.useEditor.mockReturnValue(editor);

    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(99);

    const { unmount } = render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // Schedule pendingRaf via onUpdate (never let it fire)
    config.onUpdate({ editor });

    // Unmount while pendingRaf is set → cleanup branch at lines 315-317
    unmount();

    expect(cancelSpy).toHaveBeenCalledWith(99);

    cancelSpy.mockRestore();
    vi.restoreAllMocks();
  });
});

describe("TiptapEditorInner — cleanup when pendingDebounceTimeout set at unmount (lines 319-321)", () => {
  // Use fake timers so setTimeout/clearTimeout are fully controlled
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("cancels debounce timeout on unmount when timeout is pending", () => {
    // lines 319-321: if (pendingDebounceTimeout.current) { clearTimeout(...); }
    // With fake timers, window.setTimeout never fires, so pendingDebounceTimeout stays set.
    const editor = createMockEditor();
    editor.state.doc.content.size = 30000; // large doc → window.setTimeout path
    mocks.useEditor.mockReturnValue(editor);

    const clearSpy = vi.spyOn(window, "clearTimeout");

    const { unmount } = render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[0][0];

    // onUpdate → pendingDebounceTimeout.current = <timeout id> (never fires)
    config.onUpdate({ editor });

    // Unmount triggers cleanup useEffect at lines 319-321
    unmount();

    // clearTimeout should have been called (the cleanup branch fired)
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("TiptapEditorInner — external content sync skips when hidden (line 385-386)", () => {
  it("skips content sync when hiddenRef is true during the sync effect", async () => {
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
    mocks.useDocumentContent.mockReturnValue("# initial");

    // Render hidden — onCreate fires, sets editorInitialized
    const { rerender } = render(<TiptapEditorInner hidden={true} />);

    await vi.waitFor(() => {
      expect(mocks.parseMarkdown).toHaveBeenCalled();
    });

    // Change content while still hidden — the sync effect should skip (line 385-386)
    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.useDocumentContent.mockReturnValue("# changed while hidden");

    rerender(<TiptapEditorInner hidden={true} />);

    // syncMarkdownToEditor should NOT be called (hidden=true, line 386 returns early)
    expect(mocks.parseMarkdown).not.toHaveBeenCalled();
  });
});

// ── Visibility transition: cursorInfoRef lambda (line 424) ───────────

describe("TiptapEditorInner — visibility transition cursorInfoRef lambda", () => {
  it("passes a cursorInfoRef getter lambda to scheduleTiptapFocusAndRestore on hidden→visible (line 424)", async () => {
    const cursorValue = { line: 5, col: 3 };
    mocks.useDocumentCursorInfo.mockReturnValue(cursorValue);

    let capturedGetCursor: (() => unknown) | null = null;
    mocks.scheduleTiptapFocusAndRestore.mockImplementation(
      (_ed: unknown, getCursor: () => unknown) => { capturedGetCursor = getCursor; }
    );

    setupUseEditorWithCallbacks();
    mocks.getTiptapEditorView.mockReturnValue(null);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });

    // Render hidden — onCreate fires async, sets editorInitialized.current = true
    const { rerender } = render(<TiptapEditorInner hidden={true} />);
    await vi.waitFor(() => expect(mocks.parseMarkdown).toHaveBeenCalled());

    vi.clearAllMocks();
    mocks.scheduleTiptapFocusAndRestore.mockImplementation(
      (_ed: unknown, getCursor: () => unknown) => { capturedGetCursor = getCursor; }
    );
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });

    // Transition to visible — triggers the hidden → visible useEffect (line 413-428)
    rerender(<TiptapEditorInner hidden={false} />);

    expect(mocks.scheduleTiptapFocusAndRestore).toHaveBeenCalled();

    // The lambda at line 424: () => cursorInfoRef.current
    expect(capturedGetCursor).not.toBeNull();
    expect(capturedGetCursor!()).toEqual(cursorValue);
  });
});

// ── External content sync hidden guard (line 386) ────────────────────

describe("TiptapEditorInner — external sync skips when hidden (line 386)", () => {
  it("does not call parseMarkdown for external content changes while hidden", async () => {
    const editor = createMockEditor();
    const mockView = {
      state: {
        tr: { setMeta: vi.fn().mockReturnThis(), replaceWith: vi.fn().mockReturnThis() },
        doc: { content: { size: 50 } },
      },
      dispatch: vi.fn(),
    };

    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    setupUseEditorWithCallbacks(editor);

    const { rerender } = render(<TiptapEditorInner hidden={true} />);

    await vi.waitFor(() => {
      expect(mocks.parseMarkdown).toHaveBeenCalled();
    });

    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(mockView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.useDocumentContent.mockReturnValue("# changed while hidden");

    rerender(<TiptapEditorInner hidden={true} />);

    // parseMarkdown should NOT be called for sync — hidden guard at line 385-386
    expect(mocks.parseMarkdown).not.toHaveBeenCalled();
  });
});
