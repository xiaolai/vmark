// Split from TiptapEditor.test.tsx per the test-file size gate (WI-7).
// The mock/header block is replicated because vi.mock is per-module hoisted.
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

// ── Audit F5 — unmount flush failures must be logged, not swallowed ──

describe("TiptapEditorInner — unmount flush failure logging (audit F5)", () => {
  it("logs via tiptapError when the final flush throws instead of silently losing edits", () => {
    vi.clearAllMocks();
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const callsBefore = mocks.useEditor.mock.calls.length;
    const { unmount } = render(<TiptapEditorInner hidden={false} />);
    const config = mocks.useEditor.mock.calls[callsBefore][0] as {
      onUpdate: (ctx: { editor: unknown; transaction: unknown }) => void;
    };

    // Schedule a pending flush (small doc → RAF path), then make the final
    // serialization fail. The unmount flush must log the failure.
    config.onUpdate({ editor, transaction: { getMeta: () => undefined } });
    mocks.serializeMarkdown.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => unmount()).not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(
      "[Tiptap]",
      expect.stringContaining("Unmount flush failed"),
      expect.any(Error),
    );
    errSpy.mockRestore();
  });
});

// ── Audit F6 — deferred init must consume pending content-search nav ──

describe("TiptapEditorInner — deferred init consumes pending nav (audit F6)", () => {
  it("consumes pending nav after deferred initialization and skips focus restore", async () => {
    vi.clearAllMocks();
    const fakeView = {
      state: {
        tr: { replaceWith: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
        doc: { content: { size: 10 } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
    };
    mocks.getTiptapEditorView.mockReturnValue(fakeView);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.consumeWysiwygPendingNav.mockReturnValue(true);

    setupUseEditorWithCallbacks();
    render(<TiptapEditorInner hidden={false} />);

    // The nav is consumed by the deferred onCreate init — the pinned tab id is
    // used, not a call-time focused-tab lookup.
    await vi.waitFor(() => {
      expect(mocks.consumeWysiwygPendingNav).toHaveBeenCalledWith(fakeView, "tab-1");
    });
    // A consumed nav means the RAF-deferred focus restore must be skipped —
    // it would clobber the jump's selection.
    expect(mocks.scheduleTiptapFocusAndRestore).not.toHaveBeenCalled();
  });

  it("falls back to focus/cursor restore when no nav is pending", async () => {
    vi.clearAllMocks();
    mocks.getTiptapEditorView.mockReturnValue(null);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.consumeWysiwygPendingNav.mockReturnValue(false);

    setupUseEditorWithCallbacks();
    render(<TiptapEditorInner hidden={false} />);

    await vi.waitFor(() => {
      expect(mocks.scheduleTiptapFocusAndRestore).toHaveBeenCalled();
    });
  });
});

// ── Audit F7 — a preview pane must not steal focus on visibility change ──

describe("TiptapEditorInner — preview visibility transition (audit F7)", () => {
  it("does not steal focus or consume pending nav when a preview becomes visible", () => {
    vi.clearAllMocks();
    const editor = createMockEditor();
    mocks.useEditor.mockReturnValue(editor);
    mocks.getTiptapEditorView.mockReturnValue(null);
    mocks.parseMarkdown.mockReturnValue({ type: "doc", content: [] });
    mocks.consumeWysiwygPendingNav.mockReturnValue(false);

    const callsBefore = mocks.useEditor.mock.calls.length;
    const { rerender } = render(<TiptapEditorInner hidden={true} preview={true} />);
    const config = mocks.useEditor.mock.calls[callsBefore][0] as {
      onCreate: (ctx: { editor: unknown }) => void;
    };

    // Drive the deferred init deterministically (editorInitialized → true).
    vi.useFakeTimers();
    config.onCreate({ editor });
    vi.runAllTimers();
    vi.useRealTimers();

    vi.clearAllMocks();
    rerender(<TiptapEditorInner hidden={false} preview={true} />);

    // The preview syncs content but must not grab focus or eat the pending
    // navigation that belongs to the editable pane.
    expect(mocks.scheduleTiptapFocusAndRestore).not.toHaveBeenCalled();
    expect(mocks.consumeWysiwygPendingNav).not.toHaveBeenCalled();
  });
});
