import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadTextFile = vi.fn();
const mockFindExistingTabForPath = vi.fn();
const mockCreateTab = vi.fn();
const mockInitDocument = vi.fn();
const mockSetLineMetadata = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: (...a: unknown[]) => mockReadTextFile(...a) }));
vi.mock("@/services/tabs/findExistingTabForPath", () => ({
  findExistingTabForPath: (...a: unknown[]) => mockFindExistingTabForPath(...a),
}));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ createTab: mockCreateTab }) },
}));
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({ initDocument: mockInitDocument, setLineMetadata: mockSetLineMetadata }),
  },
}));

import { restoreWorkspaceTabs } from "./restoreWorkspaceTabs";

beforeEach(() => {
  [mockReadTextFile, mockFindExistingTabForPath, mockCreateTab, mockInitDocument, mockSetLineMetadata]
    .forEach((m) => m.mockReset());
  mockFindExistingTabForPath.mockReturnValue(null);
  mockReadTextFile.mockResolvedValue("content");
  mockCreateTab.mockImplementation((_w: string, p: string) => `tab-${p}`);
});

afterEach(() => vi.restoreAllMocks());

describe("restoreWorkspaceTabs", () => {
  it("returns 0 for null/empty input without touching the filesystem", async () => {
    expect(await restoreWorkspaceTabs("main", null)).toBe(0);
    expect(await restoreWorkspaceTabs("main", [])).toBe(0);
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("creates and initializes a tab per restorable path", async () => {
    const created = await restoreWorkspaceTabs("main", ["/a.md", "/b.md"]);
    expect(created).toBe(2);
    expect(mockCreateTab).toHaveBeenCalledTimes(2);
    expect(mockInitDocument).toHaveBeenCalledWith("tab-/a.md", "content", "/a.md");
    expect(mockSetLineMetadata).toHaveBeenCalledTimes(2);
  });

  it("skips paths that already have an open tab (dedup guard)", async () => {
    mockFindExistingTabForPath.mockImplementation((_w: string, p: string) => (p === "/a.md" ? "existing" : null));
    const created = await restoreWorkspaceTabs("main", ["/a.md", "/b.md"]);
    expect(created).toBe(1);
    expect(mockCreateTab).toHaveBeenCalledTimes(1);
    expect(mockCreateTab).toHaveBeenCalledWith("main", "/b.md");
  });

  it("skips unreadable paths without throwing", async () => {
    mockReadTextFile.mockImplementation((p: string) => (p === "/a.md" ? Promise.reject(new Error("gone")) : Promise.resolve("content")));
    const created = await restoreWorkspaceTabs("main", ["/a.md", "/b.md"]);
    expect(created).toBe(1);
  });
});
