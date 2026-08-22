// @vitest-environment node
// WI-TNAV2.4 — MRU-ordered open tier, and the tier inversion that makes it
// reachable at all.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/stores/workspaceStore", () => ({
  useRecentFilesStore: { getState: vi.fn(() => ({ files: [] })) },
}));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    // Complete enough to stand in for the real store: production code reads
    // `tabs` and `activeTabId` directly, and a double missing them turns a
    // genuinely-dropped key into a silent no-op instead of a loud failure.
    getState: vi.fn(() => ({ tabs: {}, activeTabId: {}, getTabsByWindow: () => [] })),
  },
  tabFilePath: (t: { kind?: string; filePath?: string | null }) =>
    t?.kind === "document" ? (t.filePath ?? null) : null,
}));
vi.mock("@/services/workspaces/activeWorkspaceScope", () => ({
  getActiveWorkspaceScope: vi.fn(() => ({ rootPath: null })),
}));

import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import {
  buildQuickOpenItems,
  filterAndRankItems,
  flattenFileTree,
} from "./useQuickOpenItems";
import type { FileNode } from "@/components/Sidebar/FileExplorer/types";

const mockRecentFiles = vi.mocked(useRecentFilesStore.getState);
const mockTabStore = vi.mocked(useTabStore.getState);
const mockActiveScope = vi.mocked(getActiveWorkspaceScope);

beforeEach(() => {
  vi.clearAllMocks();
  mockRecentFiles.mockReturnValue({ files: [] } as any);
  mockTabStore.mockReturnValue({
      tabs: {},
      activeTabId: {}, getTabsByWindow: () => [] } as any);
  mockActiveScope.mockReturnValue({ rootPath: null } as any);
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
      activeTabId: {},
      tabs: { win: [{ kind: "document", filePath: "/b.md" }] },
      getTabsByWindow: (wl: string) =>
        wl === "win" ? [{ kind: "document", filePath: "/b.md" }] : [],
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

  // WI-TNAV2.4 inverted this deliberately. Recents used to be emitted first and
  // win dedup, while ordinary file opening ADDS the path to recents
  // (`loadFileIntoTab.ts:20`) — so almost every open file was labelled `recent`
  // and the open tier was nearly empty. Ordering that tier by MRU would have
  // been a no-op. `open` now claims a path first.
  it("deduplicates: OPEN wins over recent and workspace", () => {
    mockRecentFiles.mockReturnValue({
      files: [{ path: "/a.md", name: "a", timestamp: 100 }],
    } as any);
    mockTabStore.mockReturnValue({
      activeTabId: {},
      tabs: { win: [{ kind: "document", filePath: "/a.md" }] },
      getTabsByWindow: () => [{ kind: "document", filePath: "/a.md" }],
    } as any);
    const items = buildQuickOpenItems("win", ["/a.md"]);
    expect(items.filter((i) => i.path === "/a.md")).toHaveLength(1);
    expect(items.find((i) => i.path === "/a.md")!.tier).toBe("open");
  });

  it("deduplicates: open wins over workspace", () => {
    mockTabStore.mockReturnValue({
      activeTabId: {},
      tabs: { win: [{ kind: "document", filePath: "/a.md" }] },
      getTabsByWindow: () => [{ kind: "document", filePath: "/a.md" }],
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
      activeTabId: {},
      tabs: { win: [{ kind: "document", filePath: "/a.md" }] },
      getTabsByWindow: () => [{ kind: "document", filePath: "/a.md" }],
    } as any);
    const items = buildQuickOpenItems("win", []);
    expect(items[0].isOpenTab).toBe(true);
  });

  it("marks items not open in current window", () => {
    mockRecentFiles.mockReturnValue({
      files: [{ path: "/a.md", name: "a", timestamp: 100 }],
    } as any);
    mockTabStore.mockReturnValue({
      tabs: {},
      activeTabId: {},
      getTabsByWindow: () => [],
    } as any);
    const items = buildQuickOpenItems("win", []);
    expect(items[0].isOpenTab).toBe(false);
  });

  it("computes relative path when rootPath is set", () => {
    mockActiveScope.mockReturnValue({ rootPath: "/project" } as any);
    const items = buildQuickOpenItems("win", ["/project/src/file.md"]);
    expect(items[0].relPath).toBe("src/file.md");
  });

  it("uses full path when rootPath is null", () => {
    mockActiveScope.mockReturnValue({ rootPath: null } as any);
    const items = buildQuickOpenItems("win", ["/some/file.md"]);
    expect(items[0].relPath).toBe("/some/file.md");
  });

  it("does not match rootPath as prefix of different directory", () => {
    mockActiveScope.mockReturnValue({ rootPath: "/project" } as any);
    const items = buildQuickOpenItems("win", ["/project2/file.md"]);
    expect(items[0].relPath).toBe("/project2/file.md");
  });

  it("computes relative path with Windows backslash separators", () => {
    mockActiveScope.mockReturnValue({ rootPath: "C:\\project" } as any);
    const items = buildQuickOpenItems("win", ["C:\\project\\src\\file.md"]);
    expect(items[0].relPath).toBe("src/file.md");
  });

  it("matches Windows rootPath with mixed separators", () => {
    mockActiveScope.mockReturnValue({ rootPath: "C:/project" } as any);
    const items = buildQuickOpenItems("win", ["C:\\project\\file.md"]);
    expect(items[0].relPath).toBe("file.md");
  });

  it("returns empty string when path equals rootPath exactly", () => {
    mockActiveScope.mockReturnValue({ rootPath: "/project" } as any);
    const items = buildQuickOpenItems("win", ["/project"]);
    expect(items[0].relPath).toBe("");
  });

  it("handles tabs without filePath (untitled tabs)", () => {
    mockTabStore.mockReturnValue({
      activeTabId: {},
      tabs: {
        win: [
          { kind: "document", filePath: null },
          { kind: "document", filePath: "/b.md" },
        ],
      },
      getTabsByWindow: () => [
        { kind: "document", filePath: null },
        { kind: "document", filePath: "/b.md" },
      ],
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

  it("sorts open before recent before workspace", () => {
    const items = [
      { path: "/w.md", filename: "w.md", relPath: "w.md", tier: "workspace" as const, isOpenTab: false },
      { path: "/r.md", filename: "r.md", relPath: "r.md", tier: "recent" as const, isOpenTab: false },
      { path: "/o.md", filename: "o.md", relPath: "o.md", tier: "open" as const, isOpenTab: true },
    ];
    const result = filterAndRankItems(items, "");
    expect(result.map((r) => r.item.tier)).toEqual(["open", "recent"]);
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

  it("matches a query with surrounding whitespace", () => {
    // A trailing space (typed or pasted) used to be handed to fuzzyMatch as a
    // character to find, so a query like " notes " matched nothing.
    const items = [
      { path: "/notes.md", filename: "notes.md", relPath: "notes.md", tier: "workspace" as const, isOpenTab: false },
    ];
    const padded = filterAndRankItems(items, "  notes  ");
    expect(padded).toHaveLength(1);
    expect(padded[0].item.path).toBe("/notes.md");
    expect(padded[0].match!.score).toBe(filterAndRankItems(items, "notes")[0].match!.score);
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

// ---------------------------------------------------------------------------
// WI-TNAV2.4 — MRU ordering, and the dedup bug that made it a no-op.
// ---------------------------------------------------------------------------
import { useTabMruStore } from "@/stores/tabMruStore";

const openTabs = (paths: string[]) =>
  paths.map((filePath, i) => ({ id: `t${i}`, kind: "document", filePath }));

function seedTabs(paths: string[]) {
  const tabs = openTabs(paths);
  mockTabStore.mockReturnValue({
      activeTabId: {},
    tabs: { win: tabs },
    getTabsByWindow: (wl: string) => (wl === "win" ? tabs : []),
  } as any);
  return tabs;
}

/** Seed the MRU by tab id, in the order given. */
function seedMru(tabs: { id: string; filePath: string }[], paths: string[]) {
  const idFor = (p: string) => tabs.find((t) => t.filePath === p)!.id;
  useTabMruStore.setState({ lists: { win: paths.map(idFor) } });
}

describe("QuickOpen — MRU ordering (WI-TNAV2.4)", () => {
  beforeEach(() => {
    useTabMruStore.getState().reset();
  });

  it("puts /r.md LAST at BOTH MRU populations — the cold-start trap (Gap 7)", () => {
    // One fixture, two populations, because the defect is a BRANCH not a value:
    // D4 leaves the MRU empty at every cold start, so an
    // `if (mru.length === 0) return legacyBuild(...)` fallback would preserve
    // the recents-win dedup that is this work item's entire subject.
    const run = (mru: string[]) => {
      const tabs = seedTabs(["/a.md", "/b.md"]);
      mockRecentFiles.mockReturnValue({ files: [{ path: "/r.md" }] } as any);
      if (mru.length) seedMru(tabs as never, mru);
      else useTabMruStore.getState().reset();
      return filterAndRankItems(buildQuickOpenItems("win", []), "").map((r) => r.item.path);
    };

    expect(run([])).toEqual(["/a.md", "/b.md", "/r.md"]);
    expect(run(["/b.md", "/a.md"])).toEqual(["/b.md", "/a.md", "/r.md"]);
  });

  it("ranks an open file above a more-recent one (the plan's named case)", () => {
    // RED before the tier swap: recents were emitted first and won dedup, so
    // both paths were labelled `recent` and the MRU could not reorder them.
    const tabs = seedTabs(["/a.md", "/b.md"]);
    mockRecentFiles.mockReturnValue({ files: [{ path: "/b.md" }, { path: "/a.md" }] } as any);
    seedMru(tabs as never, ["/a.md", "/b.md"]);
    expect(filterAndRankItems(buildQuickOpenItems("win", []), "")[0].item.path).toBe("/a.md");
  });

  it("does not hide the rest when the MRU is partial", () => {
    const tabs = seedTabs(["/a.md", "/b.md", "/c.md"]);
    seedMru(tabs as never, ["/c.md"]);
    const paths = filterAndRankItems(buildQuickOpenItems("win", []), "").map((r) => r.item.path);
    expect(paths[0]).toBe("/c.md");
    expect(new Set(paths)).toEqual(new Set(["/a.md", "/b.md", "/c.md"]));
  });

  it("conserves the path set: nothing lost, nothing duplicated", () => {
    const tabs = seedTabs(["/a.md", "/b.md"]);
    mockRecentFiles.mockReturnValue({ files: [{ path: "/b.md" }, { path: "/r.md" }] } as any);
    seedMru(tabs as never, ["/b.md", "/a.md"]);
    const items = buildQuickOpenItems("win", ["/a.md", "/w.md"]);
    const paths = items.map((i) => i.path);
    expect(new Set(paths)).toEqual(new Set(["/a.md", "/b.md", "/r.md", "/w.md"]));
    expect(paths.length).toBe(new Set(paths).size);
  });

  it("ignores an MRU entry whose tab is not open", () => {
    seedTabs(["/a.md"]);
    useTabMruStore.setState({ lists: { win: ["t99", "t0"] } });
    const paths = buildQuickOpenItems("win", []).map((i) => i.path);
    expect(paths).toEqual(["/a.md"]);
  });
});
