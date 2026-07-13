/**
 * useHotExitCapture — capture-payload tests (WI-1A.13, audit-fix HIGH-2).
 *
 * The hook itself is event-driven (listens for Rust capture-request
 * events) and hard to test in isolation. The actual payload-building
 * logic lives in `captureWindowState`, which is exported for this
 * purpose. These tests verify the new multi-format fields (`format_id`,
 * `editing_enabled`, `active_schema_id`) are correctly populated from
 * the in-memory Tab into the persisted TabState.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// --- Mock the dependent stores BEFORE importing the SUT. ---
// react-i18next is pulled in by useHotExitCapture's transitive deps;
// jsdom + vitest setup already provides a working i18n. Document store
// and history store can use minimal stubs since this test only exercises
// the *tab-shape* portion of the capture path.

interface StubDocumentTab {
  kind: "document";
  id: string;
  filePath: string | null;
  title: string;
  isPinned: boolean;
  formatId: string;
  editingEnabled?: boolean;
  activeSchemaId?: string | null;
}

interface StubBrowserTab {
  kind: "browser";
  id: string;
  url: string;
  title: string;
  isPinned: boolean;
}

type StubTab = StubDocumentTab | StubBrowserTab;

const tabsForWindow: Record<string, StubTab[]> = {};
let activeTabId: string | null = null;
/** Tab ids whose document entry is absent from the document store. */
const tabsWithoutDocument = new Set<string>();
/** When set, the tab store read throws — forces a capture-time exception. */
let forceCaptureThrow = false;

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      getTabsByWindow: (windowLabel: string) => {
        if (forceCaptureThrow) throw new Error("capture boom");
        return tabsForWindow[windowLabel] ?? [];
      },
      getActiveTab: (windowLabel: string) =>
        (tabsForWindow[windowLabel] ?? []).find((t) => t.id === activeTabId) ??
        null,
    }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: (tabId: string) =>
        tabsWithoutDocument.has(tabId)
          ? undefined
          : {
              content: "",
              savedContent: "",
              isDirty: false,
              isMissing: false,
              isDivergent: false,
              isReadOnly: false,
              lineEnding: "lf",
              cursorInfo: null,
              lastModifiedTimestamp: null,
              isUntitled: true,
              untitledNumber: 1,
            },
    }),
  },
  useUnifiedHistoryStore: {
    getState: () => ({
      documents: {},
    }),
  },
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      sidebarVisible: true,
      sidebarWidth: 260,
      sidebarViewMode: "files",
      statusBarVisible: true,
      terminalVisible: false,
      terminalHeight: 250,
    }),
  },
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      sourceMode: false,
      focusModeEnabled: false,
      typewriterModeEnabled: false,
    }),
  },
}));

const { mockHotExitError, mockListen, mockEmit } = vi.hoisted(() => ({
  mockHotExitError: vi.fn(),
  mockListen: vi.fn(),
  mockEmit: vi.fn(),
}));

vi.mock("@/utils/debug", () => ({
  hotExitWarn: vi.fn(),
  hotExitError: mockHotExitError,
}));

// `listen` and `webviewWindow` are consumed by the hook (not by
// captureWindowState directly), but the SUT module imports them at the
// top — so they need to mock cleanly.
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", emit: mockEmit }),
}));

import { renderHook } from "@testing-library/react";
import { captureWindowState, useHotExitCapture } from "./_hotExitCapture";
import { captureWindowGeometry } from "./windowGeometry";

function setTabs(windowLabel: string, tabs: StubTab[]) {
  tabsForWindow[windowLabel] = tabs;
}

beforeEach(() => {
  for (const k of Object.keys(tabsForWindow)) delete tabsForWindow[k];
  activeTabId = null;
  tabsWithoutDocument.clear();
  forceCaptureThrow = false;
  mockHotExitError.mockClear();
  mockEmit.mockReset().mockResolvedValue(undefined);
  mockListen.mockReset().mockResolvedValue(vi.fn());
});

describe("useHotExitCapture", () => {
  it("answers a capture request with the window state, correlated by capture_id", async () => {
    setTabs("main", [
      { kind: "document", id: "t1", filePath: "/a.md", title: "a.md", isPinned: false, formatId: "markdown" },
    ]);
    activeTabId = "t1";

    renderHook(() => useHotExitCapture());
    const handler = mockListen.mock.calls[0][1] as (event: {
      payload: { capture_id: string };
    }) => Promise<void>;
    await handler({ payload: { capture_id: "cap-1" } });

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const [, response] = mockEmit.mock.calls[0];
    expect(response).toMatchObject({
      capture_id: "cap-1",
      window_label: "main",
      state: { active_tab_id: "t1" },
    });
  });

  it("emits NO response when capture throws, so Rust keeps the previous snapshot", async () => {
    // A fabricated empty-success response would make the Rust coordinator count
    // this window as "captured with zero tabs" and overwrite the previous
    // recoverable snapshot. Emitting nothing lets the coordinator time out and
    // merge_partial_capture resurrect the previous window state (or abort the
    // write entirely for a single window) — either way, no data loss.
    setTabs("main", [
      { kind: "document", id: "t1", filePath: "/a.md", title: "a.md", isPinned: false, formatId: "markdown" },
    ]);
    forceCaptureThrow = true;

    renderHook(() => useHotExitCapture());
    const handler = mockListen.mock.calls[0][1] as (event: {
      payload: { capture_id: string };
    }) => Promise<void>;
    await handler({ payload: { capture_id: "cap-err" } });

    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockHotExitError).toHaveBeenCalled();
  });

  it("logs a listener-registration failure instead of rejecting unhandled", async () => {
    mockListen.mockRejectedValue(new Error("event bridge down"));

    const { unmount } = renderHook(() => useHotExitCapture());
    await Promise.resolve();
    await Promise.resolve();

    // A rejected registration silently disables hot-exit capture for this
    // window; it must be surfaced, and unmount must not throw on the rejection.
    expect(mockHotExitError).toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });
});

describe("captureWindowState — active tab id (R1: browser tabs are not captured)", () => {
  it("does not point active_tab_id at a tab that is absent from the payload", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: "/a.md",
        title: "a.md",
        isPinned: false,
        formatId: "markdown",
      },
      { kind: "browser", id: "b1", url: "https://example.com", title: "Example", isPinned: false },
    ]);
    activeTabId = "b1";

    const state = captureWindowState("main", true);

    expect(state.tabs.map((t) => t.id)).toEqual(["t1"]);
    // A browser tab is filtered out of `tabs`; keeping its id as active_tab_id
    // makes restore repair it to an arbitrary document.
    expect(state.active_tab_id).toBeNull();
  });

  it("keeps active_tab_id when the active tab is a captured document tab", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: "/a.md",
        title: "a.md",
        isPinned: false,
        formatId: "markdown",
      },
      { kind: "browser", id: "b1", url: "https://example.com", title: "Example", isPinned: false },
    ]);
    activeTabId = "t1";

    expect(captureWindowState("main", true).active_tab_id).toBe("t1");
  });
});

describe("captureWindowState — tabs with no document entry", () => {
  it("omits a file-backed tab whose document is missing instead of capturing it empty", () => {
    // Restoring `content: ""` / `saved_content: ""` for a real file path
    // resurrects the tab as an EMPTY clean document — a later save would then
    // truncate the file on disk. There is nothing to recover, so drop the tab.
    setTabs("main", [
      {
        kind: "document",
        id: "ghost",
        filePath: "/real/file.md",
        title: "file.md",
        isPinned: false,
        formatId: "markdown",
      },
      {
        kind: "document",
        id: "t1",
        filePath: "/a.md",
        title: "a.md",
        isPinned: false,
        formatId: "markdown",
      },
    ]);
    tabsWithoutDocument.add("ghost");
    activeTabId = "ghost";

    const state = captureWindowState("main", true);

    expect(state.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(state.active_tab_id).toBeNull();
  });
});

describe("captureWindowState — multi-format fields (WI-1A.13)", () => {
  it("captures format_id from the live Tab", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: "/data/payload.json",
        title: "payload.json",
        isPinned: false,
        formatId: "json",
      },
    ]);
    activeTabId = "t1";

    const state = captureWindowState("main", true);

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].format_id).toBe("json");
  });

  it("defaults editing_enabled to true when the Tab does not override it", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: "/notes/draft.md",
        title: "draft.md",
        isPinned: false,
        formatId: "markdown",
        // editingEnabled deliberately omitted
      },
    ]);
    activeTabId = "t1";

    const state = captureWindowState("main", true);

    expect(state.tabs[0].editing_enabled).toBe(true);
  });

  it("captures editing_enabled=false override (e.g. code viewer)", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: "/src/lib.rs",
        title: "lib.rs",
        isPinned: false,
        formatId: "code",
        editingEnabled: false,
      },
    ]);
    activeTabId = "t1";

    const state = captureWindowState("main", true);

    expect(state.tabs[0].editing_enabled).toBe(false);
  });

  it("defaults active_schema_id to null when the Tab does not set one", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: "/x.yml",
        title: "x.yml",
        isPinned: false,
        formatId: "yaml",
      },
    ]);
    activeTabId = "t1";

    const state = captureWindowState("main", true);

    expect(state.tabs[0].active_schema_id).toBeNull();
  });

  it("captures active_schema_id when set (e.g. yaml-gha-workflow)", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: "/.github/workflows/ci.yml",
        title: "ci.yml",
        isPinned: false,
        formatId: "yaml",
        activeSchemaId: "yaml-gha-workflow",
      },
    ]);
    activeTabId = "t1";

    const state = captureWindowState("main", true);

    expect(state.tabs[0].active_schema_id).toBe("yaml-gha-workflow");
  });

  it("captures untitled non-markdown tabs (formatId preserved even with file_path=null)", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: null,
        title: "Untitled-1.json",
        isPinned: false,
        formatId: "json",
      },
    ]);
    activeTabId = "t1";

    const state = captureWindowState("main", true);

    expect(state.tabs[0].file_path).toBeNull();
    expect(state.tabs[0].format_id).toBe("json");
  });

  it("captures multiple tabs with mixed format states", () => {
    setTabs("main", [
      {
        kind: "document",
        id: "t1",
        filePath: "/a.md",
        title: "a.md",
        isPinned: false,
        formatId: "markdown",
      },
      {
        kind: "document",
        id: "t2",
        filePath: "/b.rs",
        title: "b.rs",
        isPinned: false,
        formatId: "code",
        editingEnabled: false,
      },
      {
        kind: "document",
        id: "t3",
        filePath: "/c.yml",
        title: "c.yml",
        isPinned: false,
        formatId: "yaml",
        activeSchemaId: "yaml-gha-workflow",
      },
    ]);
    activeTabId = "t2";

    const state = captureWindowState("main", true);

    expect(state.tabs).toHaveLength(3);
    expect(state.tabs[0].format_id).toBe("markdown");
    expect(state.tabs[0].editing_enabled).toBe(true);
    expect(state.tabs[1].editing_enabled).toBe(false);
    expect(state.tabs[2].active_schema_id).toBe("yaml-gha-workflow");
    expect(state.active_tab_id).toBe("t2");
  });
});

describe("captureWindowGeometry", () => {
  const originals = {
    screenX: window.screenX,
    screenY: window.screenY,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
  };

  function setGeometry(values: Partial<typeof originals>) {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(window, key, { value, configurable: true });
    }
  }

  afterEach(() => {
    setGeometry(originals);
  });

  it("captures position and outer dimensions from window globals", () => {
    setGeometry({ screenX: 120, screenY: 80, outerWidth: 1024, outerHeight: 768 });
    expect(captureWindowGeometry()).toEqual({ x: 120, y: 80, width: 1024, height: 768 });
  });

  it("returns null for non-positive dimensions", () => {
    setGeometry({ screenX: 0, screenY: 0, outerWidth: 0, outerHeight: 768 });
    expect(captureWindowGeometry()).toBeNull();
  });

  it("returns null for non-finite values", () => {
    setGeometry({ screenX: NaN, screenY: 0, outerWidth: 1024, outerHeight: 768 });
    expect(captureWindowGeometry()).toBeNull();
  });

  it("captureWindowState includes the captured geometry", () => {
    setGeometry({ screenX: 5, screenY: 6, outerWidth: 800, outerHeight: 600 });
    const state = captureWindowState("main", true);
    expect(state.geometry).toEqual({ x: 5, y: 6, width: 800, height: 600 });
  });
});
