import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadTextFile = vi.fn();
const mockFindExistingTabForPath = vi.fn();
const mockCreateTab = vi.fn();
const mockIngestExternalContent = vi.fn();
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
    getState: () => ({
      ingestExternalContent: mockIngestExternalContent,
      setLineMetadata: mockSetLineMetadata,
    }),
  },
}));

import { restoreWorkspaceTabs } from "./restoreWorkspaceTabs";

beforeEach(() => {
  [mockReadTextFile, mockFindExistingTabForPath, mockCreateTab, mockIngestExternalContent, mockSetLineMetadata]
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
    // Content enters through the disk-open door, which derives line metadata.
    expect(mockIngestExternalContent).toHaveBeenCalledWith(
      "tab-/a.md", "content", "disk-open", { filePath: "/a.md" },
    );
    expect(mockIngestExternalContent).toHaveBeenCalledTimes(2);
    // Line metadata derives inside the disk-open door now — no separate call.
    expect(mockSetLineMetadata).not.toHaveBeenCalled();
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

  // WI-3 — the persisted path list is untrusted input: a corrupt workspace
  // config can hold numbers, nulls, objects, or empty strings. Junk entries
  // are skipped at the schema boundary; valid siblings are still restored.
  it("salvages valid paths and skips wrong-typed entries without throwing (WI-3)", async () => {
    const created = await restoreWorkspaceTabs(
      "main",
      [42, null, { path: "/x.md" }, "", "/ok.md"] as unknown[],
    );
    expect(created).toBe(1);
    expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    expect(mockReadTextFile).toHaveBeenCalledWith("/ok.md");
    expect(mockCreateTab).toHaveBeenCalledWith("main", "/ok.md");
  });

  it("treats a non-array payload as nothing to restore (WI-3)", async () => {
    expect(await restoreWorkspaceTabs("main", "junk" as unknown as string[])).toBe(0);
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("restores CJK paths and content byte-identically (WI-3, matrix case 7)", async () => {
    const cjkContent = "# 标题\n\n中文内容。\n";
    mockReadTextFile.mockResolvedValue(cjkContent);
    const created = await restoreWorkspaceTabs("main", ["路径/未命名.md"]);
    expect(created).toBe(1);
    expect(mockCreateTab).toHaveBeenCalledWith("main", "路径/未命名.md");
    expect(mockIngestExternalContent).toHaveBeenCalledWith(
      "tab-路径/未命名.md", cjkContent, "disk-open", { filePath: "路径/未命名.md" },
    );
  });
});
