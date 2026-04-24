/**
 * Tests for useSourceEditorSync hooks
 *
 * Tests syncing of external state changes into CodeMirror editor:
 * content, word wrap, BR visibility, auto-pair, and line numbers.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock compartments
const mockLineWrapReconfigure = vi.fn(() => "line-wrap-effect");
const mockBrVisibilityReconfigure = vi.fn(() => "br-visibility-effect");
const mockAutoPairReconfigure = vi.fn(() => "auto-pair-effect");
const mockLineNumbersReconfigure = vi.fn(() => "line-numbers-effect");

vi.mock("@/utils/sourceEditorExtensions", () => ({
  lineWrapCompartment: { reconfigure: (...args: unknown[]) => mockLineWrapReconfigure(...args) },
  brVisibilityCompartment: { reconfigure: (...args: unknown[]) => mockBrVisibilityReconfigure(...args) },
  autoPairCompartment: { reconfigure: (...args: unknown[]) => mockAutoPairReconfigure(...args) },
  lineNumbersCompartment: { reconfigure: (...args: unknown[]) => mockLineNumbersReconfigure(...args) },
}));

// Mock imeGuard — run actions immediately
vi.mock("@/utils/imeGuard", () => ({
  runOrQueueCodeMirrorAction: vi.fn((_view: unknown, action: () => void) => action()),
}));

// Mock CodeMirror modules
vi.mock("@codemirror/view", () => ({
  EditorView: { lineWrapping: "lineWrapping-extension" },
  lineNumbers: vi.fn(() => "lineNumbers-extension"),
}));

vi.mock("@codemirror/autocomplete", () => ({
  closeBrackets: vi.fn(() => "closeBrackets-extension"),
}));

vi.mock("@/plugins/codemirror", () => ({
  createBrHidingPlugin: vi.fn((hide: boolean) => `brHiding-${hide}`),
}));

import { renderHook } from "@testing-library/react";
import {
  useSourceEditorContentSync,
  useSourceEditorWordWrapSync,
  useSourceEditorBrVisibilitySync,
  useSourceEditorAutoPairSync,
  useSourceEditorLineNumbersSync,
  useSourceEditorSync,
} from "./useSourceEditorSync";

// Helper to create a mock EditorView
function createMockView(docText = "") {
  return {
    state: {
      doc: {
        toString: () => docText,
        length: docText.length,
      },
      length: docText.length,
    },
    dispatch: vi.fn(),
  } as unknown;
}

describe("useSourceEditorContentSync", () => {
  let viewRef: { current: ReturnType<typeof createMockView> | null };
  let isInternalChange: { current: boolean };

  beforeEach(() => {
    viewRef = { current: null };
    isInternalChange = { current: false };
  });

  it("does nothing when view is null", () => {
    viewRef.current = null;

    renderHook(() =>
      useSourceEditorContentSync(viewRef as never, isInternalChange, "new content")
    );

    // No dispatch since view is null — no error expected
  });

  it("dispatches content change when content differs from editor", () => {
    const mockView = createMockView("old content");
    viewRef.current = mockView;

    renderHook(() =>
      useSourceEditorContentSync(viewRef as never, isInternalChange, "new content")
    );

    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          from: 0,
          insert: "new content",
        }),
      })
    );
  });

  it("skips dispatch when content matches editor content", () => {
    const mockView = createMockView("same content");
    viewRef.current = mockView;

    renderHook(() =>
      useSourceEditorContentSync(viewRef as never, isInternalChange, "same content")
    );

    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();
  });

  it("stores pending content when internal change is in progress", () => {
    const mockView = createMockView("old");
    viewRef.current = mockView;
    isInternalChange.current = true;

    renderHook(() =>
      useSourceEditorContentSync(viewRef as never, isInternalChange, "new content")
    );

    // Should not dispatch while internal change is in progress
    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();
  });

  it("skips content sync when hidden", () => {
    const mockView = createMockView("old");
    viewRef.current = mockView;
    const hiddenRef = { current: true };

    renderHook(() =>
      useSourceEditorContentSync(
        viewRef as never,
        isInternalChange,
        "new content",
        undefined,
        hiddenRef
      )
    );

    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();
  });

  it("sets cursor to start on fresh document load with no saved cursor", () => {
    const mockView = createMockView(""); // empty = fresh
    viewRef.current = mockView;
    const getCursorInfo = vi.fn(() => null); // no saved cursor

    renderHook(() =>
      useSourceEditorContentSync(
        viewRef as never,
        isInternalChange,
        "# Hello World",
        getCursorInfo
      )
    );

    const dispatch = (mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch;
    // First call: content change, second call: cursor reset
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selection: { anchor: 0 },
        scrollIntoView: true,
      })
    );
  });

  it("does not reset cursor on fresh load when cursor info exists", () => {
    const mockView = createMockView("");
    viewRef.current = mockView;
    const getCursorInfo = vi.fn(() => ({ line: 5, ch: 3 }));

    renderHook(() =>
      useSourceEditorContentSync(
        viewRef as never,
        isInternalChange,
        "# Hello World",
        getCursorInfo
      )
    );

    const dispatch = (mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch;
    // Only the content dispatch, no cursor reset
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("skips view.state.doc.toString() when re-applying the same content reference", () => {
    // After first apply, lastAppliedContentRef caches the string. A second
    // render with the same reference must short-circuit without paying for
    // the O(N) view.state.doc.toString() — the hot path during WYSIWYG typing.
    const mockView = createMockView("hello");
    viewRef.current = mockView;
    const toStringSpy = vi.fn(() => "hello");
    (mockView as { state: { doc: { toString: () => string } } }).state.doc.toString = toStringSpy;

    const { rerender } = renderHook(
      ({ content }: { content: string }) =>
        useSourceEditorContentSync(viewRef as never, isInternalChange, content),
      { initialProps: { content: "hello" } },
    );

    // First render: toString is called once to compare against currentContent.
    expect(toStringSpy).toHaveBeenCalledTimes(1);

    // Second render with the SAME string reference: must short-circuit before toString.
    rerender({ content: "hello" });
    expect(toStringSpy).toHaveBeenCalledTimes(1);

    // Third render with a NEW string (still equal value): falls through to toString
    // because reference differs — but since values match, no dispatch fires.
    rerender({ content: "hello".repeat(1) }); // new string instance via concat-like op
    // toString may or may not be called depending on JS string interning; the key
    // contract is no extra dispatch.
    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();
  });

  it("re-applies when content reference changes to a different value", () => {
    const mockView = createMockView("hello");
    viewRef.current = mockView;
    const toStringSpy = vi.fn(() => "hello");
    (mockView as { state: { doc: { toString: () => string } } }).state.doc.toString = toStringSpy;

    const { rerender } = renderHook(
      ({ content }: { content: string }) =>
        useSourceEditorContentSync(viewRef as never, isInternalChange, content),
      { initialProps: { content: "hello" } },
    );

    // First render: equal, no dispatch
    const dispatch = (mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch;
    expect(dispatch).not.toHaveBeenCalled();

    // Update to different content — must dispatch
    toStringSpy.mockReturnValue("hello"); // doc still says "hello" until dispatch is applied
    rerender({ content: "world" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ insert: "world" }),
      }),
    );
  });

  it("re-checks the doc when an out-of-band edit replaces view.state.doc", () => {
    // Real out-of-band scenario: a plugin transaction or unrelated dispatch
    // mutates the doc. The hook's effect re-runs whenever ANY dep changes —
    // most commonly via a fresh `getCursorInfo` closure on parent re-render.
    // When that happens with the same content prop, the optimization MUST
    // notice the doc identity changed and re-sync; checking only the content
    // cache would silently skip and leave the editor out of sync.
    const mockView = createMockView("hello");
    viewRef.current = mockView;

    const cursor1 = vi.fn(() => null);
    const cursor2 = vi.fn(() => null);

    const { rerender } = renderHook(
      ({ content, getCursorInfo }: { content: string; getCursorInfo: () => null }) =>
        useSourceEditorContentSync(
          viewRef as never,
          isInternalChange,
          content,
          getCursorInfo,
        ),
      { initialProps: { content: "hello", getCursorInfo: cursor1 } },
    );

    const dispatch = (mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch;
    expect(dispatch).not.toHaveBeenCalled();

    // Out-of-band: doc identity flipped, contents differ.
    (mockView as { state: { doc: { toString: () => string; length: number } } }).state.doc = {
      toString: () => "OUT-OF-BAND",
      length: "OUT-OF-BAND".length,
    };

    // Trigger effect re-run via the cursor dep while keeping content the same.
    rerender({ content: "hello", getCursorInfo: cursor2 });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ insert: "hello" }),
      }),
    );
  });
});

describe("useSourceEditorWordWrapSync", () => {
  beforeEach(() => {
    mockLineWrapReconfigure.mockClear();
    mockBrVisibilityReconfigure.mockClear();
    mockAutoPairReconfigure.mockClear();
    mockLineNumbersReconfigure.mockClear();
  });

  it("dispatches lineWrapping reconfigure when wordWrap is true", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorWordWrapSync(viewRef as never, true)
    );

    expect(mockLineWrapReconfigure).toHaveBeenCalledWith("lineWrapping-extension");
    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ effects: "line-wrap-effect" })
    );
  });

  it("dispatches empty reconfigure when wordWrap is false", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorWordWrapSync(viewRef as never, false)
    );

    expect(mockLineWrapReconfigure).toHaveBeenCalledWith([]);
  });

  it("does nothing when view is null", () => {
    const viewRef = { current: null };

    renderHook(() =>
      useSourceEditorWordWrapSync(viewRef as never, true)
    );

    expect(mockLineWrapReconfigure).not.toHaveBeenCalled();
  });
});

describe("useSourceEditorBrVisibilitySync", () => {
  beforeEach(() => {
    mockLineWrapReconfigure.mockClear();
    mockBrVisibilityReconfigure.mockClear();
    mockAutoPairReconfigure.mockClear();
    mockLineNumbersReconfigure.mockClear();
  });

  it("dispatches BR hiding plugin when showBrTags is false", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorBrVisibilitySync(viewRef as never, false)
    );

    // showBrTags=false means hideBr=true
    expect(mockBrVisibilityReconfigure).toHaveBeenCalledWith("brHiding-true");
  });

  it("dispatches BR showing plugin when showBrTags is true", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorBrVisibilitySync(viewRef as never, true)
    );

    // showBrTags=true means hideBr=false
    expect(mockBrVisibilityReconfigure).toHaveBeenCalledWith("brHiding-false");
  });

  it("does nothing when view is null", () => {
    const viewRef = { current: null };

    renderHook(() =>
      useSourceEditorBrVisibilitySync(viewRef as never, true)
    );

    expect(mockBrVisibilityReconfigure).not.toHaveBeenCalled();
  });
});

describe("useSourceEditorAutoPairSync", () => {
  beforeEach(() => {
    mockLineWrapReconfigure.mockClear();
    mockBrVisibilityReconfigure.mockClear();
    mockAutoPairReconfigure.mockClear();
    mockLineNumbersReconfigure.mockClear();
  });

  it("dispatches closeBrackets when autoPairEnabled is true", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorAutoPairSync(viewRef as never, true)
    );

    expect(mockAutoPairReconfigure).toHaveBeenCalledWith("closeBrackets-extension");
  });

  it("dispatches empty when autoPairEnabled is false", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorAutoPairSync(viewRef as never, false)
    );

    expect(mockAutoPairReconfigure).toHaveBeenCalledWith([]);
  });

  it("dispatches empty when autoPairEnabled is undefined", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorAutoPairSync(viewRef as never, undefined)
    );

    expect(mockAutoPairReconfigure).toHaveBeenCalledWith([]);
  });

  it("does nothing when view is null", () => {
    const viewRef = { current: null };

    renderHook(() =>
      useSourceEditorAutoPairSync(viewRef as never, true)
    );

    expect(mockAutoPairReconfigure).not.toHaveBeenCalled();
  });
});

describe("useSourceEditorLineNumbersSync", () => {
  beforeEach(() => {
    mockLineWrapReconfigure.mockClear();
    mockBrVisibilityReconfigure.mockClear();
    mockAutoPairReconfigure.mockClear();
    mockLineNumbersReconfigure.mockClear();
  });

  it("dispatches lineNumbers when showLineNumbers is true", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorLineNumbersSync(viewRef as never, true)
    );

    expect(mockLineNumbersReconfigure).toHaveBeenCalledWith("lineNumbers-extension");
  });

  it("dispatches empty when showLineNumbers is false", () => {
    const mockView = createMockView("text");
    const viewRef = { current: mockView };

    renderHook(() =>
      useSourceEditorLineNumbersSync(viewRef as never, false)
    );

    expect(mockLineNumbersReconfigure).toHaveBeenCalledWith([]);
  });

  it("does nothing when view is null", () => {
    const viewRef = { current: null };

    renderHook(() =>
      useSourceEditorLineNumbersSync(viewRef as never, true)
    );

    expect(mockLineNumbersReconfigure).not.toHaveBeenCalled();
  });
});

describe("useSourceEditorContentSync — pending content and rerender", () => {
  let viewRef: { current: ReturnType<typeof createMockView> | null };
  let isInternalChange: { current: boolean };

  beforeEach(() => {
    vi.useFakeTimers();
    viewRef = { current: null };
    isInternalChange = { current: false };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polling fires but does nothing when no pending content (line 110 guard — all conditions false)", () => {
    // viewRef valid, isInternalChange=false, but pendingContentRef=null (content already matches)
    const mockView = createMockView("same content");
    viewRef.current = mockView;

    renderHook(() =>
      useSourceEditorContentSync(viewRef as never, isInternalChange, "same content")
    );

    // Advance timer — checkPendingContent fires but pendingContentRef is null → returns early
    vi.advanceTimersByTime(150);

    // No dispatch because pendingContentRef was null when interval fired
    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();
  });

  it("applies pending content after internal change completes via polling", () => {
    const mockView = createMockView("old");
    viewRef.current = mockView;
    isInternalChange.current = true;

    const { rerender } = renderHook(
      ({ content }) =>
        useSourceEditorContentSync(viewRef as never, isInternalChange, content),
      { initialProps: { content: "pending content" } }
    );

    // Should not dispatch while internal change is in progress
    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();

    // Internal change completes
    isInternalChange.current = false;

    // Advance past the polling interval (100ms)
    vi.advanceTimersByTime(150);

    // Pending content should have been applied by the polling interval
    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).toHaveBeenCalled();

    rerender({ content: "pending content" });
  });

  it("skips dispatch when content matches last applied content", () => {
    const mockView = createMockView("old content");
    viewRef.current = mockView;

    const { rerender } = renderHook(
      ({ content }) =>
        useSourceEditorContentSync(viewRef as never, isInternalChange, content),
      { initialProps: { content: "new content" } }
    );

    const dispatch = (mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch;
    const firstCallCount = dispatch.mock.calls.length;

    // Rerender with same content — should not dispatch again
    rerender({ content: "new content" });

    expect(dispatch.mock.calls.length).toBe(firstCallCount);
  });

  it("does not apply pending content when hidden ref is true during polling", () => {
    const mockView = createMockView("old");
    viewRef.current = mockView;
    isInternalChange.current = true;
    const hiddenRef = { current: false };

    renderHook(() =>
      useSourceEditorContentSync(
        viewRef as never,
        isInternalChange,
        "pending",
        undefined,
        hiddenRef
      )
    );

    // Internal change done, but now hidden
    isInternalChange.current = false;
    hiddenRef.current = true;

    vi.advanceTimersByTime(150);

    // Should not dispatch because hidden
    expect((mockView as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();
  });
});

describe("useSourceEditorSync (combined)", () => {
  beforeEach(() => {
    mockLineWrapReconfigure.mockClear();
    mockBrVisibilityReconfigure.mockClear();
    mockAutoPairReconfigure.mockClear();
    mockLineNumbersReconfigure.mockClear();
  });

  it("calls all sync hooks with the provided config", () => {
    const mockView = createMockView("existing content");
    const viewRef = { current: mockView };
    const isInternalChange = { current: false };

    renderHook(() =>
      useSourceEditorSync({
        viewRef: viewRef as never,
        isInternalChange,
        content: "existing content",
        wordWrap: true,
        showBrTags: false,
        autoPairEnabled: true,
        showLineNumbers: true,
      })
    );

    // Word wrap should be enabled
    expect(mockLineWrapReconfigure).toHaveBeenCalledWith("lineWrapping-extension");
    // BR should be hidden (showBrTags=false → hide=true)
    expect(mockBrVisibilityReconfigure).toHaveBeenCalledWith("brHiding-true");
    // Auto pair should be enabled
    expect(mockAutoPairReconfigure).toHaveBeenCalledWith("closeBrackets-extension");
    // Line numbers should be enabled
    expect(mockLineNumbersReconfigure).toHaveBeenCalledWith("lineNumbers-extension");
  });
});
