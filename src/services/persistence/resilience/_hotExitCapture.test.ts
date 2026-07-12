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

interface StubTab {
  kind: "document";
  id: string;
  filePath: string | null;
  title: string;
  isPinned: boolean;
  formatId: string;
  editingEnabled?: boolean;
  activeSchemaId?: string | null;
}

const tabsForWindow: Record<string, StubTab[]> = {};
let activeTabId: string | null = null;

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      getTabsByWindow: (windowLabel: string) => tabsForWindow[windowLabel] ?? [],
      getActiveTab: (windowLabel: string) =>
        (tabsForWindow[windowLabel] ?? []).find((t) => t.id === activeTabId) ??
        null,
    }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: () => ({
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
      }),
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

vi.mock("@/utils/debug", () => ({
  hotExitWarn: vi.fn(),
  hotExitError: vi.fn(),
}));

// `listen` and `webviewWindow` are only consumed by the hook (not by
// captureWindowState directly), but the SUT module imports them at the
// top — so they need to mock cleanly.
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", emit: vi.fn() }),
}));

import { captureWindowState } from "./_hotExitCapture";
import { captureWindowGeometry } from "./windowGeometry";

function setTabs(windowLabel: string, tabs: StubTab[]) {
  tabsForWindow[windowLabel] = tabs;
}

beforeEach(() => {
  for (const k of Object.keys(tabsForWindow)) delete tabsForWindow[k];
  activeTabId = null;
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
