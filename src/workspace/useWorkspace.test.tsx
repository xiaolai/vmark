/**
 * useWorkspace tests — ADR-008.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspace } from "./useWorkspace";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { WindowContext } from "@/contexts/WindowContext";

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <WindowContext.Provider value={{ windowLabel: "main", isDocumentWindow: true }}>
      {children}
    </WindowContext.Provider>
  );
}

describe("useWorkspace", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: {}, activeTabId: {} });
    useRecentFilesStore.setState({ files: [] });
    useWorkspaceStore.setState({ config: null });
  });

  it("returns empty workspace by default", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.config).toBeNull();
    expect(result.current.openTabs).toEqual([]);
    expect(result.current.activeTab).toBeNull();
    expect(result.current.recentFiles).toEqual([]);
  });

  it("exposes recent files from the store", () => {
    const sample = { path: "/tmp/a.md", name: "a.md", timestamp: 1 };
    act(() => {
      useRecentFilesStore.setState({ files: [sample] });
    });
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.recentFiles).toEqual([sample]);
  });
});
