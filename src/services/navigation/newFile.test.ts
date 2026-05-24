/**
 * Tests for newFile utility
 *
 * @module utils/newFile.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUntitledTab } from "./newFile";

// Mock the stores
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(),
    setState: vi.fn(),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(),
  },
}));

// WI-1B.10 — formatId override path consults the registry to verify
// the requested format is registered before overriding.
vi.mock("@/lib/formats/registry", () => ({
  getFormatById: vi.fn((id: string) =>
    id === "txt" ? { id: "txt" } : undefined,
  ),
}));

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

describe("createUntitledTab", () => {
  const mockCreateTab = vi.fn();
  const mockInitDocument = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTabStore.getState).mockReturnValue({
      createTab: mockCreateTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      initDocument: mockInitDocument,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);
  });

  it("creates a new tab with no file path", () => {
    mockCreateTab.mockReturnValue("tab-123");

    const tabId = createUntitledTab("main");

    expect(mockCreateTab).toHaveBeenCalledWith("main", null);
    expect(tabId).toBe("tab-123");
  });

  it("initializes document with empty content and no file path", () => {
    mockCreateTab.mockReturnValue("tab-456");

    createUntitledTab("doc-1");

    expect(mockInitDocument).toHaveBeenCalledWith("tab-456", "", null);
  });

  it("returns the created tab id", () => {
    mockCreateTab.mockReturnValue("new-tab-id");

    const result = createUntitledTab("main");

    expect(result).toBe("new-tab-id");
  });

  it("works with different window labels", () => {
    mockCreateTab.mockReturnValue("tab-789");

    createUntitledTab("doc-window-2");

    expect(mockCreateTab).toHaveBeenCalledWith("doc-window-2", null);
  });

  it("does not override formatId when caller passes 'markdown'", () => {
    mockCreateTab.mockReturnValue("tab-md");
    createUntitledTab("main", "markdown");
    expect(useTabStore.setState).not.toHaveBeenCalled();
  });

  it("overrides formatId via setState when caller passes a registered non-markdown id", () => {
    mockCreateTab.mockReturnValue("tab-txt");
    createUntitledTab("main", "txt");
    expect(useTabStore.setState).toHaveBeenCalledOnce();
  });

  it("does not override when caller passes an unregistered formatId", () => {
    mockCreateTab.mockReturnValue("tab-fake");
    createUntitledTab("main", "no-such-format");
    expect(useTabStore.setState).not.toHaveBeenCalled();
  });
});
