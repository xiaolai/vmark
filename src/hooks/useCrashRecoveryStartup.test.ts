/**
 * Tests for useCrashRecoveryStartup — crash recovery focus preservation.
 *
 * Covers:
 *   - Recovery tabs don't steal focus from active tab
 *   - Active tab is preserved after creating recovery tabs
 *   - No focus change when no snapshots found
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const {
  mockWaitForRestoreComplete,
  mockDeleteStaleRecoveryFiles,
  mockReadRecoverySnapshots,
  mockDeleteRecoverySnapshot,
  mockUseWindowLabel,
} = vi.hoisted(() => ({
  mockWaitForRestoreComplete: vi.fn(() => Promise.resolve(true)),
  mockDeleteStaleRecoveryFiles: vi.fn(() => Promise.resolve()),
  mockReadRecoverySnapshots: vi.fn(() => Promise.resolve([])),
  mockDeleteRecoverySnapshot: vi.fn(() => Promise.resolve()),
  mockUseWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/utils/hotExit/hotExitCoordination", () => ({
  waitForRestoreComplete: () => mockWaitForRestoreComplete(),
}));

vi.mock("@/utils/crashRecovery", () => ({
  readRecoverySnapshots: () => mockReadRecoverySnapshots(),
  deleteStaleRecoveryFiles: (...args: unknown[]) =>
    mockDeleteStaleRecoveryFiles(...args),
  deleteRecoverySnapshot: (...args: unknown[]) =>
    mockDeleteRecoverySnapshot(...args),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => mockUseWindowLabel(),
}));

vi.mock("@/utils/debug", () => ({
  crashRecoveryLog: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

const mockSetActiveTab = vi.fn();
const mockCreateTab = vi.fn(() => "recovery-tab");
const mockUpdateTabPath = vi.fn();
const mockGetTabsByWindow = vi.fn(() => [{ id: "existing-tab" }]);
let mockActiveTabId: Record<string, string> = { main: "existing-tab" };

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      get activeTabId() { return mockActiveTabId; },
      setActiveTab: mockSetActiveTab,
      createTab: mockCreateTab,
      updateTabPath: mockUpdateTabPath,
      getTabsByWindow: mockGetTabsByWindow,
    }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      initDocument: vi.fn(),
    }),
  },
}));

import { useCrashRecoveryStartup } from "./useCrashRecoveryStartup";

describe("useCrashRecoveryStartup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWindowLabel.mockReturnValue("main");
    mockWaitForRestoreComplete.mockResolvedValue(true);
    mockReadRecoverySnapshots.mockResolvedValue([]);
    mockActiveTabId = { main: "existing-tab" };
  });

  it("does not change active tab when no snapshots found", async () => {
    mockReadRecoverySnapshots.mockResolvedValue([]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockReadRecoverySnapshots).toHaveBeenCalled();
    });

    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  it("restores previous active tab after creating recovery tabs", async () => {
    mockReadRecoverySnapshots.mockResolvedValue([
      {
        version: 1,
        tabId: "crashed-tab",
        windowLabel: "main",
        content: "recovered content",
        filePath: "/recovered/file.md",
        title: "file.md",
        timestamp: Date.now(),
      },
    ]);

    // After creating recovery tabs, getTabsByWindow should include the
    // previous active tab so setActiveTab can restore it
    mockGetTabsByWindow.mockReturnValue([
      { id: "existing-tab" },
      { id: "recovery-tab" },
    ]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      // Recovery tab was created
      expect(mockCreateTab).toHaveBeenCalledWith("main", null);
    });

    await vi.waitFor(() => {
      // Previous active tab was restored — recovery tab did NOT steal focus
      expect(mockSetActiveTab).toHaveBeenCalledWith("main", "existing-tab");
    });
  });

  it("does not call setActiveTab when there was no previous active tab", async () => {
    // Simulate no active tab for this window (e.g., tabs were just cleared)
    mockActiveTabId = {};

    mockReadRecoverySnapshots.mockResolvedValue([
      {
        version: 1,
        tabId: "crashed-tab",
        windowLabel: "main",
        content: "recovered content",
        filePath: "/recovered/file.md",
        title: "file.md",
        timestamp: Date.now(),
      },
    ]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledWith("main", null);
    });

    // With no previous active tab, setActiveTab must NOT be called —
    // the recovery tab's auto-activation is the only sensible default.
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });
});
