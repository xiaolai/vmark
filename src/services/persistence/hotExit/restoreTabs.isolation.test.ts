// @vitest-environment node
/**
 * One bad tab must cost that tab, not the session.
 *
 * `restoreTabs` calls `clearExistingWindowTabs` BEFORE rebuilding — the
 * window's fallback state is destroyed first, by design, so the rebuild has a
 * clean slate. But the rebuild loop had no per-tab guard: any throw from
 * `restoreTabMetadata` or `restoreDocumentState` propagated out with the
 * fallback already gone and only some tabs rebuilt. The user opened the app to
 * a partially restored window and no indication anything was missing. No test
 * covered a mid-loop failure.
 *
 * @coordinates-with services/persistence/hotExit/restoreHelpers.ts — restoreTabs
 * @module services/persistence/hotExit/restoreTabs.isolation.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCreateTab,
  mockDetachTab,
  mockRestoreTabMetadata,
  mockRestoreDocumentState,
  mockClearExisting,
  mockHotExitWarn,
} = vi.hoisted(() => ({
  mockCreateTab: vi.fn(),
  mockDetachTab: vi.fn(),
  mockRestoreTabMetadata: vi.fn(),
  mockRestoreDocumentState: vi.fn(),
  mockClearExisting: vi.fn(),
  mockHotExitWarn: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({ tabs: {}, activeTabId: {}, createTab: mockCreateTab, detachTab: mockDetachTab }),
  },
}));
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({}) },
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({}) },
  TERMINAL_MAX_RATIO: 0.5,
  SIDEBAR_MIN_WIDTH: 180,
  SIDEBAR_MAX_WIDTH: 480,
  SIDEBAR_DEFAULT_WIDTH: 260,
}));
vi.mock("./restoreDocumentState", () => ({
  restoreDocumentState: (...a: unknown[]) => mockRestoreDocumentState(...a),
}));
vi.mock("./restoreTabsHelpers", () => ({
  clearExistingWindowTabs: (...a: unknown[]) => mockClearExisting(...a),
  deduplicateTabs: (tabs: unknown[]) => ({ kept: tabs, duplicateToRetained: new Map() }),
  filterMeaningfulTabs: (tabs: unknown[]) => tabs,
  restoreActiveTab: vi.fn(),
  restoreTabMetadata: (...a: unknown[]) => mockRestoreTabMetadata(...a),
}));
vi.mock("@/utils/debug", () => ({
  hotExitLog: vi.fn(),
  hotExitWarn: (...a: unknown[]) => mockHotExitWarn(...a),
}));

import { restoreTabs } from "./restoreHelpers";

const tab = (id: string, path: string | null) =>
  ({ id, file_path: path, document: { saved_content: "", content: "" } }) as never;

const windowState = (tabs: unknown[]) =>
  ({ tabs, ui_state: {}, active_tab_id: null }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  mockCreateTab.mockImplementation(() => `new-${++n}`);
  mockRestoreDocumentState.mockResolvedValue(undefined);
});

describe("a tab that fails to restore", () => {
  it("does not abort the tabs after it", async () => {
    mockRestoreDocumentState.mockImplementation(async (tabId: string) => {
      if (tabId === "new-2") throw new Error("corrupt document payload");
    });

    const map = await restoreTabs(
      "main",
      windowState([tab("a", "/a.md"), tab("b", "/b.md"), tab("c", "/c.md")])
    );

    // a and c survived; only b was lost.
    expect([...map.keys()]).toEqual(["a", "c"]);
  });

  it("is left out of the id map, so nothing later points at a broken tab", async () => {
    mockRestoreDocumentState.mockRejectedValueOnce(new Error("boom"));

    const map = await restoreTabs("main", windowState([tab("a", "/a.md")]));

    expect(map.has("a")).toBe(false);
  });

  it("is detached, not left as an empty tab claiming a real file path", async () => {
    // An empty document showing "/a.md" invites the user to save over the file
    // whose content failed to load.
    mockRestoreDocumentState.mockRejectedValueOnce(new Error("boom"));

    await restoreTabs("main", windowState([tab("a", "/a.md")]));

    expect(mockDetachTab).toHaveBeenCalledWith("main", "new-1");
  });

  it("reports the shortfall rather than restoring silently", async () => {
    mockRestoreDocumentState.mockRejectedValueOnce(new Error("boom"));

    await restoreTabs("main", windowState([tab("a", "/a.md"), tab("b", "/b.md")]));

    expect(mockHotExitWarn).toHaveBeenCalledWith(
      expect.stringContaining("1/2"),
    );
  });

  it("survives a throw from tab METADATA restoration too, not just the document", async () => {
    mockRestoreTabMetadata.mockImplementationOnce(() => {
      throw new Error("bad metadata");
    });

    const map = await restoreTabs(
      "main",
      windowState([tab("a", "/a.md"), tab("b", "/b.md")])
    );

    expect([...map.keys()]).toEqual(["b"]);
  });
});

describe("the happy path is unchanged", () => {
  it("maps every session tab id to its new tab id", async () => {
    const map = await restoreTabs(
      "main",
      windowState([tab("a", "/a.md"), tab("b", null)])
    );

    expect(map.get("a")).toBe("new-1");
    expect(map.get("b")).toBe("new-2");
    expect(mockDetachTab).not.toHaveBeenCalled();
    expect(mockHotExitWarn).not.toHaveBeenCalled();
  });

  it("still clears the window first — the rebuild needs a clean slate", async () => {
    await restoreTabs("main", windowState([tab("a", "/a.md")]));
    expect(mockClearExisting).toHaveBeenCalledWith("main");
  });
});
