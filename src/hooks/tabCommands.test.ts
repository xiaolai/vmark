// WI-3.3 — tab commands (migrated from useTabShortcuts): behavior re-coverage.
import { describe, it, expect, vi, beforeEach } from "vitest";

const closeTabWithDirtyCheck = vi.fn(async () => {});
vi.mock("@/hooks/useTabOperations", () => ({ closeTabWithDirtyCheck: (...a: unknown[]) => closeTabWithDirtyCheck(...a) }));

const createTab = vi.fn(() => "tab-new");
const initDocument = vi.fn();
const setActiveTab = vi.fn();
let tabState = { tabs: {} as Record<string, { id: string }[]>, activeTabId: {} as Record<string, string> };
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({ ...tabState, createTab, setActiveTab }),
  },
}));
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ initDocument }) },
}));
let statusBarVisible = false;
const setStatusBarVisible = vi.fn((v: boolean) => (statusBarVisible = v));
const searchClose = vi.fn();
const setUniversalToolbarVisible = vi.fn();
vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      get statusBarVisible() { return statusBarVisible; },
      setStatusBarVisible,
      searchClose,
      setUniversalToolbarVisible,
    }),
  },
}));

import { registerTabCommands } from "./tabCommands";
import { executeCommand, getCommand, _resetCommandBus } from "@/services/commands/CommandBus";

beforeEach(() => {
  _resetCommandBus();
  vi.clearAllMocks();
  tabState = { tabs: {}, activeTabId: {} };
  statusBarVisible = false;
  registerTabCommands();
});

describe("registerTabCommands", () => {
  it("registers all 5 commands (idempotent)", () => {
    for (const id of ["tab.new", "tab.next", "tab.prev", "tab.close", "view.toggleStatusBar"]) {
      expect(getCommand(id)).toBeDefined();
    }
    expect(() => registerTabCommands()).not.toThrow(); // hasCommand guard
  });

  it("tab.new creates a tab and inits an empty document", async () => {
    await executeCommand("tab.new", null, { windowLabel: "main" });
    expect(createTab).toHaveBeenCalledWith("main", null);
    expect(initDocument).toHaveBeenCalledWith("tab-new", "", null);
  });

  it("tab.next / tab.prev cycle the active tab", async () => {
    tabState = { tabs: { main: [{ id: "a" }, { id: "b" }, { id: "c" }] }, activeTabId: { main: "a" } };
    await executeCommand("tab.next", null, { windowLabel: "main" });
    expect(setActiveTab).toHaveBeenCalledWith("main", "b");
    setActiveTab.mockClear();
    await executeCommand("tab.prev", null, { windowLabel: "main" });
    expect(setActiveTab).toHaveBeenCalledWith("main", "c"); // wraps
  });

  it("tab.close runs the dirty-check close for the active tab (data-loss-safe path preserved)", async () => {
    tabState = { tabs: {}, activeTabId: { main: "a" } };
    await executeCommand("tab.close", null, { windowLabel: "main" });
    expect(closeTabWithDirtyCheck).toHaveBeenCalledWith("main", "a");
  });

  it("tab.close is a no-op with no active tab", async () => {
    tabState = { tabs: {}, activeTabId: {} };
    await executeCommand("tab.close", null, { windowLabel: "main" });
    expect(closeTabWithDirtyCheck).not.toHaveBeenCalled();
  });

  it("view.toggleStatusBar shows it (closing other bars) then hides it", async () => {
    await executeCommand("view.toggleStatusBar");
    expect(searchClose).toHaveBeenCalled();
    expect(setUniversalToolbarVisible).toHaveBeenCalledWith(false);
    expect(setStatusBarVisible).toHaveBeenCalledWith(true);

    setStatusBarVisible.mockClear();
    searchClose.mockClear();
    await executeCommand("view.toggleStatusBar"); // now visible → hide, no bar-close
    expect(searchClose).not.toHaveBeenCalled();
    expect(setStatusBarVisible).toHaveBeenCalledWith(false);
  });
});
