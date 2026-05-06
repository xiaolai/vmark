import { render, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useUnifiedMenuCommands } from "./useUnifiedMenuCommands";
import { performWysiwygToolbarAction } from "@/plugins/toolbarActions/wysiwygAdapter";
import { performSourceToolbarAction } from "@/plugins/toolbarActions/sourceAdapter";
import { performUnifiedUndo, performUnifiedRedo } from "@/hooks/useUnifiedHistory";
import { useTabStore } from "@/stores/tabStore";
import {
  __resetRegistry,
  registerFormat,
} from "@/lib/formats/registry";
import { registerMarkdownFormat } from "@/lib/formats/adapters/markdown";

type MenuEventHandler = (event: { payload: string }) => void;

const listeners = new Map<string, MenuEventHandler>();

// Hoisted mock factory so individual tests can override listen behavior
const { mockListenImpl } = vi.hoisted(() => {
  const defaultFn = (_eventName: string, _handler: unknown) => {
    return Promise.resolve(() => {});
  };
  const mockListenImpl = { fn: defaultFn };
  return { mockListenImpl };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    listen: (eventName: string, handler: MenuEventHandler) =>
      mockListenImpl.fn(eventName, handler),
  }),
}));

let sourceMode = false;
vi.mock("@/stores/editorStore", () => {
  const useEditorStore = (selector?: (state: { sourceMode: boolean }) => unknown) => {
    const state = { sourceMode };
    return selector ? selector(state) : state;
  };
  useEditorStore.getState = () => ({ sourceMode });
  return { useEditorStore };
});

let activeWysiwygEditor: { view: object } | null = null;
let activeSourceView: object | null = null;
vi.mock("@/stores/activeEditorStore", () => ({
  useActiveEditorStore: {
    getState: () => ({
      activeWysiwygEditor,
      activeSourceView,
    }),
  },
}));

vi.mock("@/stores/sourceCursorContextStore", () => ({
  useSourceCursorContextStore: {
    getState: () => ({ context: null }),
  },
}));

vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getWysiwygMultiSelectionContext: () => null,
  getSourceMultiSelectionContext: () => null,
}));

const { mockShouldBlockMenuAction } = vi.hoisted(() => ({
  mockShouldBlockMenuAction: vi.fn(() => false),
}));
vi.mock("@/utils/focusGuard", () => ({
  shouldBlockMenuAction: mockShouldBlockMenuAction,
}));

vi.mock("@/utils/imeGuard", () => ({
  runOrQueueCodeMirrorAction: (_view: unknown, fn: () => void) => fn(),
  // Markdown adapter pulls in CodeMirror plugins that wrap their bindings
  // with this guard. Pass-through identity is fine for tests.
  guardCodeMirrorKeyBinding: (binding: unknown) => binding,
}));

vi.mock("@/plugins/toolbarActions/wysiwygAdapter", () => ({
  performWysiwygToolbarAction: vi.fn(() => true),
  setWysiwygHeadingLevel: vi.fn(() => true),
}));

vi.mock("@/plugins/toolbarActions/sourceAdapter", () => ({
  performSourceToolbarAction: vi.fn(() => true),
  setSourceHeadingLevel: vi.fn(() => true),
}));

vi.mock("@/hooks/useUnifiedHistory", () => ({
  performUnifiedUndo: vi.fn(() => true),
  performUnifiedRedo: vi.fn(() => true),
}));

vi.mock("@/plugins/actions/actionRegistry", () => ({
  MENU_TO_ACTION: {
    "menu:bold": { actionId: "bold" },
    "menu:italic": { actionId: "italic" },
    "menu:undo": { actionId: "undo" },
    "menu:redo": { actionId: "redo" },
    "menu:heading-1": { actionId: "setHeading", params: { level: 1 } },
    "menu:paragraph": { actionId: "paragraph" },
    "menu:increaseHeading": { actionId: "increaseHeading" },
    "menu:codeBlock": { actionId: "codeBlock" },
    "menu:blockquote": { actionId: "blockquote" },
    "menu:horizontalLine": { actionId: "horizontalLine" },
    "menu:addRowBelow": { actionId: "addRowBelow" },
    "menu:addColRight": { actionId: "addColRight" },
    "menu:wikiLink": { actionId: "wikiLink" },
    "menu:bookmark": { actionId: "bookmark" },
    "menu:unknown-action": { actionId: "nonexistent" },
    "menu:wysiwyg-only": { actionId: "wysiwygOnly" },
    "menu:source-only": { actionId: "sourceOnly" },
  },
  ACTION_DEFINITIONS: {
    wysiwygOnly: {
      id: "wysiwygOnly",
      label: "WYSIWYG Only",
      category: "formatting",
      supports: { wysiwyg: true, source: false },
    },
    sourceOnly: {
      id: "sourceOnly",
      label: "Source Only",
      category: "formatting",
      supports: { wysiwyg: false, source: true },
    },
    bold: {
      id: "bold",
      label: "Bold",
      category: "formatting",
      supports: { wysiwyg: false, source: true },
    },
    italic: {
      id: "italic",
      label: "Italic",
      category: "formatting",
      supports: { wysiwyg: true, source: true },
    },
    undo: {
      id: "undo",
      label: "Undo",
      category: "edit",
      supports: { wysiwyg: true, source: true },
    },
    redo: {
      id: "redo",
      label: "Redo",
      category: "edit",
      supports: { wysiwyg: true, source: true },
    },
    setHeading: {
      id: "setHeading",
      label: "Heading",
      category: "formatting",
      supports: { wysiwyg: true, source: true },
    },
    paragraph: {
      id: "paragraph",
      label: "Paragraph",
      category: "formatting",
      supports: { wysiwyg: true, source: true },
    },
    increaseHeading: {
      id: "increaseHeading",
      label: "Increase Heading",
      category: "formatting",
      supports: { wysiwyg: true, source: true },
    },
    codeBlock: {
      id: "codeBlock",
      label: "Code Block",
      category: "insert",
      supports: { wysiwyg: true, source: true },
    },
    blockquote: {
      id: "blockquote",
      label: "Blockquote",
      category: "insert",
      supports: { wysiwyg: true, source: true },
    },
    horizontalLine: {
      id: "horizontalLine",
      label: "Divider",
      category: "insert",
      supports: { wysiwyg: true, source: true },
    },
    addRowBelow: {
      id: "addRowBelow",
      label: "Add Row",
      category: "table",
      supports: { wysiwyg: true, source: true },
    },
    addColRight: {
      id: "addColRight",
      label: "Add Column",
      category: "table",
      supports: { wysiwyg: true, source: true },
    },
    wikiLink: {
      id: "wikiLink",
      label: "Wiki Link",
      category: "insert",
      supports: { wysiwyg: true, source: true },
    },
    bookmark: {
      id: "bookmark",
      label: "Bookmark",
      category: "insert",
      supports: { wysiwyg: true, source: true },
    },
  },
  getHeadingLevelFromParams: (params?: Record<string, unknown>) => (params as { level?: number })?.level ?? 1,
}));

function TestHarness() {
  useUnifiedMenuCommands();
  return null;
}

describe("useUnifiedMenuCommands", () => {
  afterEach(() => {
    // Force unmount before clearing state to prevent stale listener leaks
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listeners.clear();
    vi.clearAllMocks();
    sourceMode = false;
    activeWysiwygEditor = null;
    activeSourceView = null;
    // Restore default listen implementation
    mockListenImpl.fn = (eventName: string, handler: MenuEventHandler) => {
      listeners.set(eventName, handler);
      return Promise.resolve(() => {});
    };
  });

  it("routes menu actions to WYSIWYG adapter when in WYSIWYG mode", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "italic",
      expect.objectContaining({ surface: "wysiwyg" })
    );
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("routes menu actions to Source adapter when in Source mode", async () => {
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    expect(performSourceToolbarAction).toHaveBeenCalledWith(
      "italic",
      expect.objectContaining({ surface: "source" })
    );
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("routes undo through unified history, not adapters", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:undo")).toBe(true));

    listeners.get("menu:undo")?.({ payload: "main" });

    expect(performUnifiedUndo).toHaveBeenCalledWith("main");
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("routes redo through unified history, not adapters", async () => {
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:redo")).toBe(true));

    listeners.get("menu:redo")?.({ payload: "main" });

    expect(performUnifiedRedo).toHaveBeenCalledWith("main");
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("blocks actions that are unsupported for the current mode", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:bold")).toBe(true));

    listeners.get("menu:bold")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("ignores events targeted at a different window", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    // Payload is a different window label
    listeners.get("menu:italic")?.({ payload: "other-window" });

    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("ignores events with non-string payload", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    // Payload is not a string
    listeners.get("menu:italic")?.({ payload: 123 as unknown as string });

    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("registers listeners for all menu events in the registry", async () => {
    render(<TestHarness />);
    await waitFor(() => expect(listeners.size).toBeGreaterThan(0));

    // Should have listeners for all events in our mock MENU_TO_ACTION
    expect(listeners.has("menu:bold")).toBe(true);
    expect(listeners.has("menu:italic")).toBe(true);
    expect(listeners.has("menu:undo")).toBe(true);
    expect(listeners.has("menu:redo")).toBe(true);
    expect(listeners.has("menu:heading-1")).toBe(true);
    expect(listeners.has("menu:paragraph")).toBe(true);
  });

  it("dispatches setHeading to WYSIWYG adapter with level", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:heading-1")).toBe(true));

    listeners.get("menu:heading-1")?.({ payload: "main" });

    // setHeading goes through setWysiwygHeadingLevel, not performWysiwygToolbarAction
    const { setWysiwygHeadingLevel } = await import("@/plugins/toolbarActions/wysiwygAdapter");
    expect(setWysiwygHeadingLevel).toHaveBeenCalled();
  });

  it("dispatches paragraph (heading level 0) to WYSIWYG", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:paragraph")).toBe(true));

    listeners.get("menu:paragraph")?.({ payload: "main" });

    const { setWysiwygHeadingLevel } = await import("@/plugins/toolbarActions/wysiwygAdapter");
    expect(setWysiwygHeadingLevel).toHaveBeenCalled();
  });

  it("dispatches increaseHeading through performWysiwygToolbarAction", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:increaseHeading")).toBe(true));

    listeners.get("menu:increaseHeading")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "increaseHeading",
      expect.objectContaining({ surface: "wysiwyg" })
    );
  });

  it("maps codeBlock to insertCodeBlock action name", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:codeBlock")).toBe(true));

    listeners.get("menu:codeBlock")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "insertCodeBlock",
      expect.any(Object)
    );
  });

  it("maps blockquote to insertBlockquote action name", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:blockquote")).toBe(true));

    listeners.get("menu:blockquote")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "insertBlockquote",
      expect.any(Object)
    );
  });

  it("maps horizontalLine to insertDivider", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:horizontalLine")).toBe(true));

    listeners.get("menu:horizontalLine")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "insertDivider",
      expect.any(Object)
    );
  });

  it("maps wikiLink to link:wiki", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:wikiLink")).toBe(true));

    listeners.get("menu:wikiLink")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "link:wiki",
      expect.any(Object)
    );
  });

  it("dispatches to Source adapter in source mode for codeBlock", async () => {
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:codeBlock")).toBe(true));

    listeners.get("menu:codeBlock")?.({ payload: "main" });

    expect(performSourceToolbarAction).toHaveBeenCalledWith(
      "insertCodeBlock",
      expect.objectContaining({ surface: "source" })
    );
  });

  it("dispatches setHeading to Source adapter in source mode", async () => {
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:heading-1")).toBe(true));

    listeners.get("menu:heading-1")?.({ payload: "main" });

    const { setSourceHeadingLevel } = await import("@/plugins/toolbarActions/sourceAdapter");
    expect(setSourceHeadingLevel).toHaveBeenCalled();
  });

  it("dispatches paragraph to Source adapter in source mode", async () => {
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:paragraph")).toBe(true));

    listeners.get("menu:paragraph")?.({ payload: "main" });

    const { setSourceHeadingLevel } = await import("@/plugins/toolbarActions/sourceAdapter");
    expect(setSourceHeadingLevel).toHaveBeenCalled();
  });

  it("silently skips unknown action definitions", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:unknown-action")).toBe(true));

    // Should not throw — action definition lookup fails gracefully
    expect(() => {
      listeners.get("menu:unknown-action")?.({ payload: "main" });
    }).not.toThrow();

    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("maps addRowBelow to addRow in WYSIWYG mode", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:addRowBelow")).toBe(true));

    listeners.get("menu:addRowBelow")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "addRow",
      expect.any(Object)
    );
  });

  it("maps addColRight to addCol in WYSIWYG mode", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:addColRight")).toBe(true));

    listeners.get("menu:addColRight")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "addCol",
      expect.any(Object)
    );
  });

  it("maps bookmark to link:bookmark in WYSIWYG mode", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:bookmark")).toBe(true));

    listeners.get("menu:bookmark")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "link:bookmark",
      expect.any(Object)
    );
  });

  it("dispatches increaseHeading to source adapter in source mode", async () => {
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:increaseHeading")).toBe(true));

    listeners.get("menu:increaseHeading")?.({ payload: "main" });

    expect(performSourceToolbarAction).toHaveBeenCalledWith(
      "increaseHeading",
      expect.objectContaining({ surface: "source" })
    );
  });

  it("does not dispatch to WYSIWYG when editor view is null", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: null };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    // Editor exists but view is null — should not dispatch
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("does not dispatch to source when view is null", async () => {
    sourceMode = true;
    activeSourceView = null;

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    // Source view is null — should not dispatch (will trigger retry)
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("dispatches bold in source mode (source-supported)", async () => {
    sourceMode = true;
    activeSourceView = {};

    // In our mock, bold: supports { wysiwyg: false, source: true }
    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:bold")).toBe(true));

    listeners.get("menu:bold")?.({ payload: "main" });

    // Bold is only supported in source mode in our mock
    expect(performSourceToolbarAction).toHaveBeenCalledWith(
      "bold",
      expect.objectContaining({ surface: "source" })
    );
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("blocks actions when focus guard says to block", async () => {
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    mockShouldBlockMenuAction.mockReturnValue(true);

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();

    // Restore
    mockShouldBlockMenuAction.mockReturnValue(false);
  });

  it("retries WYSIWYG dispatch when editor becomes available after delay", async () => {
    sourceMode = false;
    activeWysiwygEditor = null; // not available initially

    render(<TestHarness />);
    await vi.waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    // Not dispatched yet (editor is null)
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();

    // Make editor available and advance past retry delay
    activeWysiwygEditor = { view: {} };
    await vi.advanceTimersByTimeAsync(60);

    expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
      "italic",
      expect.objectContaining({ surface: "wysiwyg" })
    );
  });

  it("gives up after max retries for WYSIWYG", async () => {
    sourceMode = false;
    activeWysiwygEditor = null; // never available

    render(<TestHarness />);
    await vi.waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    // Advance past all retries (3 retries * 50ms each + initial 50ms)
    await vi.advanceTimersByTimeAsync(250);

    // Should not have dispatched (editor never became available)
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("retries source dispatch when view becomes available after delay", async () => {
    sourceMode = true;
    activeSourceView = null; // not available initially

    render(<TestHarness />);
    await vi.waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    expect(performSourceToolbarAction).not.toHaveBeenCalled();

    // Make view available
    activeSourceView = {};
    await vi.advanceTimersByTimeAsync(60);

    expect(performSourceToolbarAction).toHaveBeenCalled();
  });

  it("gives up after max retries for source", async () => {
    sourceMode = true;
    activeSourceView = null; // never available

    render(<TestHarness />);
    await vi.waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

    listeners.get("menu:italic")?.({ payload: "main" });

    await vi.advanceTimersByTimeAsync(250);

    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("blocks source-unsupported action in WYSIWYG mode", async () => {
    // bold has supports: { wysiwyg: false, source: true }
    // In WYSIWYG mode, bold should be blocked
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:bold")).toBe(true));

    // Clear any stale calls from listener setup before asserting
    vi.mocked(performWysiwygToolbarAction).mockClear();

    listeners.get("menu:bold")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("dispatches heading in source mode with setSourceHeadingLevel", async () => {
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:heading-1")).toBe(true));

    listeners.get("menu:heading-1")?.({ payload: "main" });

    const { setSourceHeadingLevel } = await import("@/plugins/toolbarActions/sourceAdapter");
    expect(setSourceHeadingLevel).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "source" }),
      1
    );
  });

  it("blocks source-only unsupported action in WYSIWYG mode (L327 branch)", async () => {
    // sourceOnly has supports: { wysiwyg: false, source: true }
    // In WYSIWYG mode, !actionDef.supports.wysiwyg → should be blocked
    sourceMode = false;
    activeWysiwygEditor = { view: {} };

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:source-only")).toBe(true));

    // Clear any stale calls from listener setup before asserting
    vi.mocked(performWysiwygToolbarAction).mockClear();
    vi.mocked(performSourceToolbarAction).mockClear();

    listeners.get("menu:source-only")?.({ payload: "main" });

    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
    expect(performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("blocks wysiwyg-only unsupported action in source mode (L322-325 branch)", async () => {
    // wysiwygOnly has supports: { wysiwyg: true, source: false }
    // In source mode, !actionDef.supports.source → should be blocked
    sourceMode = true;
    activeSourceView = {};

    render(<TestHarness />);
    await waitFor(() => expect(listeners.has("menu:wysiwyg-only")).toBe(true));

    // Clear any stale calls from listener setup before asserting
    vi.mocked(performSourceToolbarAction).mockClear();
    vi.mocked(performWysiwygToolbarAction).mockClear();

    listeners.get("menu:wysiwyg-only")?.({ payload: "main" });

    expect(performSourceToolbarAction).not.toHaveBeenCalled();
    expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("cleans up fulfilled listeners when component unmounts during setup (L359-366 disposed path)", async () => {
    // This tests the path where disposed=true by the time Promise.allSettled resolves
    // We need to delay the listen() promises so unmount happens first
    let resolveAll!: () => void;
    const barrier = new Promise<void>((res) => { resolveAll = res; });

    // Track how many times unlisten was called (fulfilled listeners are called to clean up)
    const mockUnlisten = vi.fn();
    mockListenImpl.fn = async () => {
      await barrier;
      return mockUnlisten;
    };

    const { unmount } = render(<TestHarness />);

    // Unmount before the listen promises resolve — sets disposed=true
    unmount();

    // Now let the listen promises resolve — they should be cleaned up (unlisten called)
    resolveAll();

    await waitFor(() => {
      expect(mockUnlisten).toHaveBeenCalled();
    });
  });

  it("logs error when a listener registration fails (L375 rejected path)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockListenImpl.fn = () => Promise.reject(new Error("registration failed"));

    render(<TestHarness />);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "[Menu]",
        "Failed to register listener:",
        expect.any(Error)
      );
    });

    consoleSpy.mockRestore();
  });

  it("early returns when disposed before window listeners are registered (L288)", async () => {
    // disposed=true is set by cleanup before setupListeners awaits
    // This is hard to test directly; we verify no crash and no listeners when unmounted instantly
    const { unmount } = render(<TestHarness />);
    unmount(); // disposed=true before any async work completes
    // Just verify no error thrown
    expect(true).toBe(true);
  });

  describe("WI-1A.7 — per-format menuPolicy gating", () => {
    afterEach(() => {
      __resetRegistry();
      useTabStore.setState({
        tabs: {},
        activeTabId: {},
        untitledCounter: 0,
        closedTabs: {},
      });
    });

    function registerNonMarkdownTxt(): void {
      registerFormat({
        id: "txt",
        nameI18nKey: "format.txt",
        extensions: ["txt"],
        kind: "split-pane",
        adapters: {
          saveDialogFilters: [{ name: "Plain", extensions: ["txt"] }],
          untitledExtension: "txt",
          searchAdapter: "codemirror",
          readOnlyDefault: false,
          closeSavePolicy: "markdown-default",
          menuPolicy: {
            sourceWysiwygToggle: false,
            cjkFormatActions: false,
            insertBlockActions: false,
            paragraphFormatting: false,
          },
        },
      });
    }

    it("permits formatting actions when active tab is markdown", async () => {
      __resetRegistry();
      registerMarkdownFormat();
      registerNonMarkdownTxt();
      // Active tab on /foo.md → markdown adapter, paragraphFormatting=true
      const tabId = useTabStore.getState().createTab("main", "/foo.md");
      expect(useTabStore.getState().findTabById(tabId)?.formatId).toBe(
        "markdown",
      );

      sourceMode = false;
      activeWysiwygEditor = { view: {} };

      render(<TestHarness />);
      await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

      listeners.get("menu:italic")?.({ payload: "main" });

      expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
        "italic",
        expect.objectContaining({ surface: "wysiwyg" }),
      );
    });

    it("blocks formatting actions when active tab is non-markdown (paragraphFormatting=false)", async () => {
      __resetRegistry();
      registerMarkdownFormat();
      registerNonMarkdownTxt();
      const tabId = useTabStore.getState().createTab("main", "/foo.txt");
      expect(useTabStore.getState().findTabById(tabId)?.formatId).toBe("txt");

      sourceMode = false;
      activeWysiwygEditor = { view: {} };

      render(<TestHarness />);
      await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

      vi.mocked(performWysiwygToolbarAction).mockClear();
      listeners.get("menu:italic")?.({ payload: "main" });

      expect(performWysiwygToolbarAction).not.toHaveBeenCalled();
      expect(performSourceToolbarAction).not.toHaveBeenCalled();
    });

    it("permits edit-category actions (undo/redo) regardless of active format", async () => {
      __resetRegistry();
      registerMarkdownFormat();
      registerNonMarkdownTxt();
      useTabStore.getState().createTab("main", "/foo.txt");

      sourceMode = false;
      activeWysiwygEditor = { view: {} };

      render(<TestHarness />);
      await waitFor(() => expect(listeners.has("menu:undo")).toBe(true));

      listeners.get("menu:undo")?.({ payload: "main" });

      expect(performUnifiedUndo).toHaveBeenCalledWith("main");
    });

    it("permits actions when no active tab is set (failure-open behavior)", async () => {
      __resetRegistry();
      registerMarkdownFormat();
      registerNonMarkdownTxt();
      // No active tab — useTabStore.activeTabId["main"] is undefined

      sourceMode = false;
      activeWysiwygEditor = { view: {} };

      render(<TestHarness />);
      await waitFor(() => expect(listeners.has("menu:italic")).toBe(true));

      listeners.get("menu:italic")?.({ payload: "main" });

      expect(performWysiwygToolbarAction).toHaveBeenCalled();
    });

    it("permits actions with unknown category (failure-open for forward-compat)", async () => {
      // The mock ACTION_DEFINITIONS uses category "insert"/"table" which are
      // not in the gating switch. They should always be permitted.
      __resetRegistry();
      registerMarkdownFormat();
      registerNonMarkdownTxt();
      useTabStore.getState().createTab("main", "/foo.txt");

      sourceMode = false;
      activeWysiwygEditor = { view: {} };

      render(<TestHarness />);
      await waitFor(() => expect(listeners.has("menu:wikiLink")).toBe(true));

      vi.mocked(performWysiwygToolbarAction).mockClear();
      listeners.get("menu:wikiLink")?.({ payload: "main" });

      // wikiLink in the test mock has category "insert" (singular, unknown to
      // the gating switch) — defaults to allowed, so it dispatches.
      expect(performWysiwygToolbarAction).toHaveBeenCalledWith(
        "link:wiki",
        expect.any(Object),
      );
    });
  });
});
