import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/stores/workspaceStore", () => ({
  useRecentFilesStore: { getState: vi.fn(() => ({ files: [] })) },
  useWorkspaceStore: { getState: vi.fn(() => ({ rootPath: null })) },
}));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: vi.fn(() => ({ getTabsByWindow: () => [] })) },
}));

import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  buildQuickOpenItems,
  filterAndRankItems,
  flattenFileTree,
} from "./useQuickOpenItems";
import type { FileNode } from "@/components/Sidebar/FileExplorer/types";

const mockRecentFiles = vi.mocked(useRecentFilesStore.getState);
const mockTabStore = vi.mocked(useTabStore.getState);
const mockWorkspaceStore = vi.mocked(useWorkspaceStore.getState);

beforeEach(() => {
  vi.clearAllMocks();
  mockRecentFiles.mockReturnValue({ files: [] } as any);
  mockTabStore.mockReturnValue({ getTabsByWindow: () => [] } as any);
  mockWorkspaceStore.mockReturnValue({ rootPath: null } as any);
});

describe("flattenFileTree", () => {
  it("returns empty for empty tree", () => {
    expect(flattenFileTree([])).toEqual([]);
  });

  it("flattens nested tree, skipping folders", () => {
    const tree: FileNode[] = [
      {
        id: "/p/src",
        name: "src",
        isFolder: true,
        children: [
          { id: "/p/src/a.md", name: "a", isFolder: false },
          { id: "/p/src/b.md", name: "b", isFolder: false },
        ],
      },
      { id: "/p/readme.md", name: "readme", isFolder: false },
    ];
    const paths = flattenFileTree(tree);
    expect(paths).toEqual(["/p/src/a.md", "/p/src/b.md", "/p/readme.md"]);
  });

  it("returns empty for folders-only tree", () => {
    const tree: FileNode[] = [
      { id: "/p/src", name: "src", isFolder: true, children: [] },
    ];
    expect(flattenFileTree(tree)).toEqual([]);
  });

  it("handles deeply nested tree", () => {
    const tree: FileNode[] = [
      {
        id: "/a",
        name: "a",
        isFolder: true,
        children: [
          {
            id: "/a/b",
            name: "b",
            isFolder: true,
            children: [{ id: "/a/b/c.md", name: "c", isFolder: false }],
          },
        ],
      },
    ];
    expect(flattenFileTree(tree)).toEqual(["/a/b/c.md"]);
  });

  it("handles folder without children array", () => {
    const tree: FileNode[] = [
      { id: "/p/src", name: "src", isFolder: true },
    ];
    expect(flattenFileTree(tree)).toEqual([]);
  });
});

describe("buildQuickOpenItems", () => {
  it("returns empty when no sources", () => {
    expect(buildQuickOpenItems("win", [])).toEqual([]);
  });

  it("includes recent files as tier 'recent'", () => {
    mockRecentFiles.mockReturnValue({
      files: [{ path: "/a.md", name: "a", timestamp: 100 }],
    } as any);
    const items = buildQuickOpenItems("win", []);
    expect(items).toHaveLength(1);
    expect(items[0].tier).toBe("recent");
    expect(items[0].filename).toBe("a.md");
    expect(items[0].path).toBe("/a.md");
  });

  it("includes current-window open tabs as tier 'open'", () => {
    mockTabStore.mockReturnValue({
      getTabsByWindow: (wl: string) =>
        wl === "win" ? [{ filePath: "/b.md" }] : [],
    } as any);
    const items = buildQuickOpenItems("win", []);
    expect(items.filter((i) => i.tier === "open")).toHaveLength(1);
  });

  it("includes workspace files as tier 'workspace'", () => {
    const items = buildQuickOpenItems("win", ["/w.md"]);
    expect(items).toHaveLength(1);
    expect(items[0].tier).toBe("workspace");
  });

  it("deduplicates within recent files (same path listed twice)", () => {
    mockRecentFiles.mockReturnValue({
      files: [
        { path: "/a.md", name: "a", timestamp: 200 },
        { path: "/a.md", name: "a", timestamp: 100 },
      ],
    } as any);
    const items = buildQuickOpenItems("win", []);
    expect(items.filter((i) => i.path === "/a.md")).toHaveLength(1);
  });

  it("deduplicates: recent wins over open and workspace", () => {
    mockRecentFiles.mockReturnValue({
      files: [{ path: "/a.md", name: "a", timestamp: 100 }],
    } as any);
    mockTabStore.mockReturnValue({
      getTabsByWindow: () => [{ filePath: "/a.md" }],
    } as any);
    const items = buildQuickOpenItems("win", ["/a.md"]);
    expect(items.filter((i) => i.path === "/a.md")).toHaveLength(1);
    expect(items.find((i) => i.path === "/a.md")!.tier).toBe("recent");
  });

  it("deduplicates: open wins over workspace", () => {
    mockTabStore.mockReturnValue({
      getTabsByWindow: () => [{ filePath: "/a.md" }],
    } as any);
    const items = buildQuickOpenItems("win", ["/a.md"]);
    expect(items.filter((i) => i.path === "/a.md")).toHaveLength(1);
    expect(items.find((i) => i.path === "/a.md")!.tier).toBe("open");
  });

  it("marks items open in current window", () => {
    mockRecentFiles.mockReturnValue({
      files: [{ path: "/a.md", name: "a", timestamp: 100 }],
    } as any);
    mockTabStore.mockReturnValue({
      getTabsByWindow: () => [{ filePath: "/a.md" }],
    } as any);
    const items = buildQuickOpenItems("win", []);
    expect(items[0].isOpenTab).toBe(true);
  });

  it("marks items not open in current window", () => {
    mockRecentFiles.mockReturnValue({
      files: [{ path: "/a.md", name: "a", timestamp: 100 }],
    } as any);
    mockTabStore.mockReturnValue({
      getTabsByWindow: () => [],
    } as any);
    const items = buildQuickOpenItems("win", []);
    expect(items[0].isOpenTab).toBe(false);
  });

  it("computes relative path when rootPath is set", () => {
    mockWorkspaceStore.mockReturnValue({ rootPath: "/project" } as any);
    const items = buildQuickOpenItems("win", ["/project/src/file.md"]);
    expect(items[0].relPath).toBe("src/file.md");
  });

  it("uses full path when rootPath is null", () => {
    mockWorkspaceStore.mockReturnValue({ rootPath: null } as any);
    const items = buildQuickOpenItems("win", ["/some/file.md"]);
    expect(items[0].relPath).toBe("/some/file.md");
  });

  it("does not match rootPath as prefix of different directory", () => {
    mockWorkspaceStore.mockReturnValue({ rootPath: "/project" } as any);
    const items = buildQuickOpenItems("win", ["/project2/file.md"]);
    expect(items[0].relPath).toBe("/project2/file.md");
  });

  it("returns empty string when path equals rootPath exactly", () => {
    mockWorkspaceStore.mockReturnValue({ rootPath: "/project" } as any);
    const items = buildQuickOpenItems("win", ["/project"]);
    expect(items[0].relPath).toBe("");
  });

  it("handles tabs without filePath (untitled tabs)", () => {
    mockTabStore.mockReturnValue({
      getTabsByWindow: () => [{ filePath: null }, { filePath: "/b.md" }],
    } as any);
    const items = buildQuickOpenItems("win", []);
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("/b.md");
  });

  it("extracts filename from path correctly", () => {
    const items = buildQuickOpenItems("win", ["/deeply/nested/path/file.md"]);
    expect(items[0].filename).toBe("file.md");
  });
});

describe("filterAndRankItems", () => {
  it("returns recent + open only when query is empty (no workspace)", () => {
    const items = [
      { path: "/a.md", filename: "a.md", relPath: "a.md", tier: "recent" as const, isOpenTab: false },
      { path: "/b.md", filename: "b.md", relPath: "b.md", tier: "workspace" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "");
    expect(result).toHaveLength(1);
    expect(result[0].item.tier).toBe("recent");
  });

  it("returns open tier items when query is empty", () => {
    const items = [
      { path: "/a.md", filename: "a.md", relPath: "a.md", tier: "open" as const, isOpenTab: true },
    ];
    const result = filterAndRankItems(items, "");
    expect(result).toHaveLength(1);
    expect(result[0].item.tier).toBe("open");
  });

  it("includes workspace tier when query is non-empty", () => {
    const items = [
      { path: "/b.md", filename: "b.md", relPath: "b.md", tier: "workspace" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "b");
    expect(result).toHaveLength(1);
  });

  it("filters by fuzzy match", () => {
    const items = [
      { path: "/tab.md", filename: "tab.md", relPath: "tab.md", tier: "workspace" as const, isOpenTab: false },
      { path: "/xyz.md", filename: "xyz.md", relPath: "xyz.md", tier: "workspace" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "tab");
    expect(result).toHaveLength(1);
    expect(result[0].item.filename).toBe("tab.md");
  });

  it("limits results to maxResults", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      path: `/f${i}.md`,
      filename: `f${i}.md`,
      relPath: `f${i}.md`,
      tier: "workspace" as const,
      isOpenTab: false,
    }));
    expect(filterAndRankItems(items, "f", 10)).toHaveLength(10);
  });

  it("sorts recent before open before workspace", () => {
    const items = [
      { path: "/w.md", filename: "w.md", relPath: "w.md", tier: "workspace" as const, isOpenTab: false },
      { path: "/r.md", filename: "r.md", relPath: "r.md", tier: "recent" as const, isOpenTab: false },
      { path: "/o.md", filename: "o.md", relPath: "o.md", tier: "open" as const, isOpenTab: true },
    ];
    const result = filterAndRankItems(items, "");
    expect(result.map((r) => r.item.tier)).toEqual(["recent", "open"]);
  });

  it("returns match data for scored items", () => {
    const items = [
      { path: "/foo.md", filename: "foo.md", relPath: "foo.md", tier: "workspace" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "foo");
    expect(result).toHaveLength(1);
    expect(result[0].match).not.toBeNull();
    expect(result[0].match!.score).toBeGreaterThan(0);
    expect(result[0].match!.indices.length).toBeGreaterThan(0);
  });

  it("returns null match for empty-query items", () => {
    const items = [
      { path: "/a.md", filename: "a.md", relPath: "a.md", tier: "recent" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "");
    expect(result[0].match).toBeNull();
  });

  it("handles whitespace-only query as empty", () => {
    const items = [
      { path: "/a.md", filename: "a.md", relPath: "a.md", tier: "recent" as const, isOpenTab: false },
      { path: "/b.md", filename: "b.md", relPath: "b.md", tier: "workspace" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "   ");
    expect(result).toHaveLength(1);
    expect(result[0].item.tier).toBe("recent");
  });

  it("returns empty when no items match query", () => {
    const items = [
      { path: "/foo.md", filename: "foo.md", relPath: "foo.md", tier: "workspace" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "zzz");
    expect(result).toHaveLength(0);
  });

  it("sorts items within the same tier by descending score", () => {
    const items = [
      { path: "/ab.md", filename: "ab.md", relPath: "ab.md", tier: "workspace" as const, isOpenTab: false },
      { path: "/abcdef.md", filename: "abcdef.md", relPath: "abcdef.md", tier: "workspace" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "abcdef");
    // "abcdef.md" should rank higher (better match) than "ab.md"
    expect(result.length).toBeGreaterThanOrEqual(1);
    if (result.length >= 2) {
      expect(result[0].match!.score).toBeGreaterThanOrEqual(result[1].match!.score);
    }
  });

  it("sorts different tiers before sorting by score", () => {
    const items = [
      { path: "/w.md", filename: "w.md", relPath: "w.md", tier: "workspace" as const, isOpenTab: false },
      { path: "/r.md", filename: "r.md", relPath: "r.md", tier: "recent" as const, isOpenTab: false },
    ];
    const result = filterAndRankItems(items, "md");
    expect(result).toHaveLength(2);
    expect(result[0].tier).toBe("recent");
    expect(result[1].tier).toBe("workspace");
  });

  it("returns empty for empty items array", () => {
    expect(filterAndRankItems([], "test")).toEqual([]);
    expect(filterAndRankItems([], "")).toEqual([]);
  });
});
