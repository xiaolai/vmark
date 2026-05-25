/**
 * Tests for useReplaceableTab — replaceable tab detection and existing tab lookup
 *
 * @module hooks/useReplaceableTab.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindReplaceableTab } = vi.hoisted(() => ({
  mockFindReplaceableTab: vi.fn(() => null),
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/utils/openPolicy", () => ({
  findReplaceableTab: mockFindReplaceableTab,
}));

// Match the real normalizePath signature: convert backslashes to forward
// slashes, lowercase only the Windows drive letter (NOT the whole path),
// strip trailing slash. The earlier full-lowercase mock diverged from
// production behavior — case-different paths actually stay distinct on
// case-sensitive filesystems.
vi.mock("@/utils/paths", () => ({
  normalizePath: vi.fn((path: string) => {
    if (!path) return "";
    let normalized = path.replace(/\\/g, "/");
    if (/^[a-zA-Z]:/.test(normalized)) {
      normalized = normalized[0].toLowerCase() + normalized.slice(1);
    }
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }),
}));

import { getReplaceableTab, findExistingTabForPath } from "./useReplaceableTab";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

describe("getReplaceableTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no tabs exist for window", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {},
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: {},
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockFindReplaceableTab.mockReturnValue(null);

    const result = getReplaceableTab("main");

    expect(result).toBeNull();
    expect(mockFindReplaceableTab).toHaveBeenCalledWith([]);
  });

  it("passes correctly mapped tab info to findReplaceableTab", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {
        main: [
          { id: "tab-1", filePath: null },
          { id: "tab-2", filePath: "/path/to/file.md" },
        ],
      },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: {
        "tab-1": { isDirty: false },
        "tab-2": { isDirty: true },
      },
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockFindReplaceableTab.mockReturnValue(null);

    getReplaceableTab("main");

    expect(mockFindReplaceableTab).toHaveBeenCalledWith([
      { id: "tab-1", filePath: null, isDirty: false },
      { id: "tab-2", filePath: "/path/to/file.md", isDirty: true },
    ]);
  });

  it("returns replaceable tab info when found", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {
        main: [{ id: "tab-1", filePath: null }],
      },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: {
        "tab-1": { isDirty: false },
      },
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockFindReplaceableTab.mockReturnValue({ tabId: "tab-1" });

    const result = getReplaceableTab("main");

    expect(result).toEqual({ tabId: "tab-1" });
  });

  it("handles missing document for a tab gracefully", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {
        main: [{ id: "tab-1", filePath: null }],
      },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: {}, // No document for tab-1
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockFindReplaceableTab.mockReturnValue(null);

    getReplaceableTab("main");

    // isDirty defaults to false when document not found
    expect(mockFindReplaceableTab).toHaveBeenCalledWith([
      { id: "tab-1", filePath: null, isDirty: false },
    ]);
  });

  it("uses empty array for undefined window tabs", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { "doc-1": [{ id: "tab-1" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: {},
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockFindReplaceableTab.mockReturnValue(null);

    getReplaceableTab("main"); // "main" doesn't exist in tabs

    expect(mockFindReplaceableTab).toHaveBeenCalledWith([]);
  });
});

describe("findExistingTabForPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tab ID when file is already open", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      getTabsByWindow: vi.fn(() => [
        { id: "tab-1" },
        { id: "tab-2" },
      ]),
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn((id: string) => {
        if (id === "tab-1") return { filePath: "/path/to/file.md" };
        if (id === "tab-2") return { filePath: "/path/to/other.md" };
        return null;
      }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    const result = findExistingTabForPath("main", "/path/to/file.md");

    expect(result).toBe("tab-1");
  });

  it("returns null when file is not open in any tab", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      getTabsByWindow: vi.fn(() => [{ id: "tab-1" }]),
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({ filePath: "/different/file.md" })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    const result = findExistingTabForPath("main", "/path/to/file.md");

    expect(result).toBeNull();
  });

  it("returns null when window has no tabs", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      getTabsByWindow: vi.fn(() => []),
    } as unknown as ReturnType<typeof useTabStore.getState>);

    const result = findExistingTabForPath("main", "/path/to/file.md");

    expect(result).toBeNull();
  });

  it("skips tabs with null filePath (untitled)", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      getTabsByWindow: vi.fn(() => [
        { id: "tab-1" },
        { id: "tab-2" },
      ]),
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn((id: string) => {
        if (id === "tab-1") return { filePath: null };
        if (id === "tab-2") return { filePath: "/path/to/file.md" };
        return null;
      }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    const result = findExistingTabForPath("main", "/path/to/file.md");

    expect(result).toBe("tab-2");
  });

  it("skips tabs with no document", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      getTabsByWindow: vi.fn(() => [{ id: "tab-1" }]),
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => null),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    const result = findExistingTabForPath("main", "/path/to/file.md");

    expect(result).toBeNull();
  });

  it("treats case-different paths as distinct (no case folding by normalizePath)", () => {
    // Real normalizePath only lowercases the Windows drive letter, not the
    // full path. On case-sensitive filesystems (Linux, opt-in APFS), distinct
    // files must be treated as distinct. On case-insensitive filesystems the
    // same physical file opened twice via different case will produce two
    // tabs — acceptable trade-off vs. data loss.
    vi.mocked(useTabStore.getState).mockReturnValue({
      getTabsByWindow: vi.fn(() => [{ id: "tab-1" }]),
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({ filePath: "/Path/To/File.md" })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    const result = findExistingTabForPath("main", "/path/to/file.md");

    expect(result).toBeNull();
  });

  it("normalizes backslashes and the Windows drive letter", () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      getTabsByWindow: vi.fn(() => [{ id: "tab-1" }]),
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      // Drive letter "C", segments "Users/test/file.md"
      getDocument: vi.fn(() => ({ filePath: "C:\\Users\\test\\file.md" })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    // Drive letter case differs but the rest matches exactly.
    const result = findExistingTabForPath("main", "c:/Users/test/file.md");

    expect(result).toBe("tab-1");
  });
});
