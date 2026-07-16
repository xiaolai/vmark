import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "./Editor";
import { WindowProvider } from "@/contexts/WindowContext";
import {
  bootstrapFormats,
  __resetBootstrap,
} from "@/lib/formats";
import { __resetRegistry } from "@/lib/formats/registry";

beforeEach(() => {
  __resetRegistry();
  __resetBootstrap();
  bootstrapFormats();
});
afterEach(() => {
  __resetRegistry();
  __resetBootstrap();
  // Restore the default active tab / lookup for tests that flipped them.
  mockTabStore.activeTabId = { main: "tab-1" };
  mockTabStore.findTabById = (id: string) =>
    id === "tab-1"
      ? { kind: "document", id: "tab-1", filePath: null, title: "Untitled", isPinned: false }
      : null;
});

type Selector<T> = (state: T) => unknown;

function createZustandMock<T extends object>(state: T) {
  const store = ((selector?: Selector<T>) => {
    if (typeof selector === "function") {
      return selector(state);
    }
    return state;
  }) as unknown as {
    (selector: Selector<T>): unknown;
    getState: () => T;
    subscribe: (listener: (state: T, prev: T) => void) => () => void;
  };

  store.getState = () => state;
  store.subscribe = () => () => {};

  return store;
}

// Mock Tauri APIs
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    listen: vi.fn(() => Promise.resolve(() => {})),
    emit: vi.fn(),
  }),
}));

// Mock useUIStore (includes merged search/contentSearch/terminal slices for T09 consolidation)
vi.mock("@/stores/uiStore", () => {
  const state = {
    content: "",
    setContent: vi.fn(),
    sourceMode: false,
    focusModeEnabled: false,
    typewriterModeEnabled: false,
    // Per ADR-009: outline highlight lives in uiStore.
    setActiveHeadingLine: vi.fn(),
    // Merged slices (T09). Tests that exercise search behaviour replace
    // these in setup; this default keeps the search plugin from crashing.
    search: {
      isOpen: false,
      query: "",
      replaceText: "",
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      searchMarkdown: false,
      matchCount: 0,
      currentIndex: -1,
    },
    contentSearch: {
      isOpen: false,
      query: "",
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      markdownOnly: true,
      results: [],
      selectedIndex: 0,
      isSearching: false,
      error: null,
      totalMatches: 0,
      totalFiles: 0,
    },
    terminal: {
      sessions: [],
      activeSessionId: null,
    },
    searchSetMatches: vi.fn(),
  };

  return { useUIStore: createZustandMock(state) };
});

vi.mock("@/stores/documentStore", () => {
  const mockDoc = {
    content: "",
    savedContent: "",
    lastDiskContent: "",
    filePath: null,
    isDirty: false,
    documentId: 1,
    cursorInfo: null,
    lastAutoSave: null,
    isMissing: false,
    isDivergent: false,
    lineEnding: "unknown" as const,
    hardBreakStyle: "unknown" as const,
  };
  const mockDocumentStore = {
    documents: { "tab-1": mockDoc },
    getDocument: () => mockDoc,
    initDocument: vi.fn(),
  };

  return {
    useDocumentStore: createZustandMock(mockDocumentStore),
    useLargeFileSessionStore: createZustandMock({
      forcedSourceTabs: {} as Record<string, boolean>,
      isForcedSource: () => false,
      markTabForcedSource: vi.fn(),
      clearForcedSource: vi.fn(),
    }),
    useFileLoadStore: createZustandMock({
      active: false,
      startLoad: vi.fn(() => 0),
      finishLoad: vi.fn(),
      endLoad: vi.fn(),
    }),
    useRevisionStore: createZustandMock({
      registerEdit: vi.fn(),
      setRevision: vi.fn(),
      updateRevision: vi.fn(),
      getRevision: vi.fn(() => "rev-test"),
    }),
    generateRevisionId: () => "rev-test",
    useUnifiedHistoryStore: createZustandMock({
      documents: {} as Record<string, unknown>,
      createCheckpoint: vi.fn(),
    }),
    useLintStore: createZustandMock({
      diagnosticsByTab: {} as Record<string, unknown[]>,
      selectedIndexByTab: {} as Record<string, number>,
      clearDiagnostics: vi.fn(),
      clearAllDiagnostics: vi.fn(),
    }),
  };
});

// Hoisted so individual tests can flip activeTabId (e.g. to null for the
// empty-workspace / Welcome-screen seam) and reset it afterwards.
const { mockTabStore } = vi.hoisted(() => ({
  mockTabStore: {
    tabs: { main: [{ kind: "document", id: "tab-1", filePath: null, title: "Untitled", isPinned: false }] },
    activeTabId: { main: "tab-1" as string | null },
    getTabsByWindow: () => [{ kind: "document", id: "tab-1", filePath: null, title: "Untitled", isPinned: false }],
    createTab: vi.fn(() => "tab-1"),
    findTabById: (id: string) =>
      id === "tab-1"
        ? { kind: "document", id: "tab-1", filePath: null, title: "Untitled", isPinned: false }
        : null,
  },
}));

vi.mock("@/stores/tabStore", () => ({ useTabStore: createZustandMock(mockTabStore) }));

// Stub the media surface so the dispatch test asserts routing, not rendering.
vi.mock("./MediaViewer/MediaViewer", () => ({
  MediaViewer: ({ tabId }: { tabId: string }) => (
    <div data-testid="media-viewer">{tabId}</div>
  ),
}));

// Stub the generic split-pane + browser surfaces for the same reason: these
// tests assert which surface the dispatcher picks and what it hands it, not
// how those surfaces render (CodeMirror / native webview).
vi.mock("./SplitPaneEditor/SplitPaneEditor", () => ({
  SplitPaneEditor: ({
    tabId,
    formatConfig,
  }: {
    tabId: string;
    formatConfig: { id: string; kind: string };
  }) => (
    <div
      data-testid="split-pane-editor"
      data-tab-id={tabId}
      data-format-id={formatConfig.id}
      data-format-kind={formatConfig.kind}
    />
  ),
}));

vi.mock("@/components/Browser/BrowserWorkspaceSurface", () => ({
  BrowserWorkspaceSurface: () => <div data-testid="browser-workspace-surface" />,
}));

vi.mock("@/stores/settingsStore", () => {
  const state = {
    appearance: {
      cjkLetterSpacing: "0",
    },
    markdown: {
      mediaBorderStyle: "none",
      mediaAlignment: "center",
      headingAlignment: "left",
      blockFontSize: "1",
      htmlRenderingMode: "sanitized",
    },
    advanced: {
      keepBothEditorsAlive: false,
    },
  };

  const shortcutsState = {
    customBindings: {},
    getAllShortcuts: () => ({}),
    getShortcut: () => "",
  };
  const shortcutsMock = Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) =>
      sel ? sel(shortcutsState) : shortcutsState,
    {
      getState: () => shortcutsState,
      subscribe: () => () => {},
    },
  );
  return {
    useSettingsStore: createZustandMock(state),
    useShortcutsStore: shortcutsMock,
    prosemirrorToTauri: (key: string) => key,
    DEFAULT_SHORTCUTS: [],
  };
});

function renderWithProvider(ui: React.ReactElement) {
  return render(<WindowProvider>{ui}</WindowProvider>);
}

describe("Editor", () => {
  it("renders the editor container", () => {
    renderWithProvider(<Editor />);

    const container = document.querySelector(".editor-container");
    expect(container).toBeInTheDocument();
  });

  it("renders the editor content area", () => {
    renderWithProvider(<Editor />);

    const content = document.querySelector(".editor-content");
    expect(content).toBeInTheDocument();
  });

  it("renders the Welcome screen when activeTabId points at a tab that no longer exists", () => {
    // A stale activeTabId (tab transfer, hot-exit restore, workspace switch) used
    // to fall through to resolveFormat(null) -> untitled markdown, mounting a FULL
    // EDITOR over a document that does not exist: a phantom buffer the user can
    // type into. Fail closed to the Welcome screen instead.
    mockTabStore.activeTabId = { main: "tab-gone" };
    mockTabStore.findTabById = () => undefined;

    renderWithProvider(<Editor />);

    expect(screen.getByRole("button", { name: "New File" })).toBeInTheDocument();
    expect(document.querySelector(".editor-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-pane-editor")).not.toBeInTheDocument();
  });

  it("renders the Welcome screen (no editor) when no tab is active", () => {
    // Empty-workspace window: the last tab was closed, the window stays open.
    mockTabStore.activeTabId = { main: null };

    renderWithProvider(<Editor />);

    // Welcome quick-actions are present...
    expect(screen.getByRole("button", { name: "New File" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Folder" })).toBeInTheDocument();
    // ...and no editor surface is mounted.
    expect(document.querySelector(".editor-content")).not.toBeInTheDocument();
  });

  describe("WI-1A.5 — dispatch by FormatConfig.kind", () => {
    it("dispatchEditor maps a .txt path to a non-wysiwyg format", async () => {
      // The Editor.tsx dispatcher mounts SplitPaneEditor when
      // dispatchEditor returns kind !== "wysiwyg". This focused test
      // verifies the registry contract end-to-end (the integration
      // path that drives Editor.tsx). UI-level dispatch is exercised
      // by SplitPaneEditor's own test suite plus the overall
      // bootstrap test in src/lib/formats/index.test.ts.
      const { dispatchEditor } = await import("@/lib/formats/registry");
      const cfg = dispatchEditor("/x/notes.txt");
      expect(cfg.id).toBe("txt");
      expect(cfg.kind).not.toBe("wysiwyg");
    });

    it("mounts MediaViewer (not SplitPaneEditor) for a kind:'media' tab", () => {
      // The active tab points at an image file → dispatchEditor resolves the
      // media format, and Editor.tsx must route it to MediaViewer so no
      // CodeMirror source pane mounts.
      mockTabStore.findTabById = (id: string) =>
        id === "tab-1"
          ? { kind: "document", id: "tab-1", filePath: "/pics/hero.png", title: "hero.png", isPinned: false }
          : null;

      renderWithProvider(<Editor />);

      expect(screen.getByTestId("media-viewer")).toHaveTextContent("tab-1");
      expect(screen.queryByTestId("split-pane-editor")).not.toBeInTheDocument();
    });

    it("mounts SplitPaneEditor with the resolved format for a .txt tab", () => {
      // The generic split-pane route, asserted at the dispatcher boundary:
      // the tabId and the FormatConfig must both reach SplitPaneEditor.
      mockTabStore.findTabById = (id: string) =>
        id === "tab-1"
          ? { kind: "document", id: "tab-1", filePath: "/x/notes.txt", title: "notes.txt", isPinned: false, formatId: "txt" }
          : null;

      renderWithProvider(<Editor />);

      const surface = screen.getByTestId("split-pane-editor");
      expect(surface).toHaveAttribute("data-tab-id", "tab-1");
      expect(surface).toHaveAttribute("data-format-id", "txt");
      expect(surface.getAttribute("data-format-kind")).not.toBe("wysiwyg");
      expect(document.querySelector(".editor-content")).not.toBeInTheDocument();
    });

    it("mounts the browser workspace surface (and no document surface) for a kind:'browser' tab", () => {
      // R1: a browser tab has no filePath. Without the kind branch it would
      // resolve as an untitled markdown document and mount the editor.
      mockTabStore.findTabById = (id: string) =>
        id === "tab-1"
          ? { kind: "browser", id: "tab-1", url: "https://example.com", title: "Example", isPinned: false }
          : null;

      renderWithProvider(<Editor />);

      expect(screen.getByTestId("browser-workspace-surface")).toBeInTheDocument();
      expect(screen.queryByTestId("split-pane-editor")).not.toBeInTheDocument();
      expect(screen.queryByTestId("media-viewer")).not.toBeInTheDocument();
      expect(document.querySelector(".editor-content")).not.toBeInTheDocument();
    });

    it("honors an UNTITLED tab's formatId instead of falling back to markdown", () => {
      // Regression: createUntitledTab("main", "json") and hot-exit restore both
      // record a non-markdown formatId on a tab with filePath === null.
      // dispatchEditor(null) can only answer "markdown", so resolving from the
      // path alone mounted the markdown WYSIWYG for an untitled JSON document.
      mockTabStore.findTabById = (id: string) =>
        id === "tab-1"
          ? { kind: "document", id: "tab-1", filePath: null, title: "Untitled-1", isPinned: false, formatId: "json" }
          : null;

      renderWithProvider(<Editor />);

      expect(screen.getByTestId("split-pane-editor")).toHaveAttribute("data-format-id", "json");
      expect(document.querySelector(".editor-content")).not.toBeInTheDocument();
    });

    it("falls back to markdown when an untitled tab's formatId is not registered", () => {
      mockTabStore.findTabById = (id: string) =>
        id === "tab-1"
          ? { kind: "document", id: "tab-1", filePath: null, title: "Untitled-1", isPinned: false, formatId: "no-such-format" }
          : null;

      renderWithProvider(<Editor />);

      expect(document.querySelector(".editor-content")).toBeInTheDocument();
      expect(screen.queryByTestId("split-pane-editor")).not.toBeInTheDocument();
    });
  });
});
