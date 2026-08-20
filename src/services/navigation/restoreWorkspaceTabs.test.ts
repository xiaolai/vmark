// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadTextFile = vi.fn();
const mockFindExistingTabForPath = vi.fn();
const mockCreateTab = vi.fn();
const mockIngestExternalContent = vi.fn();
const mockSetLineMetadata = vi.fn();
const mockCloseTab = vi.fn();
const mockGetReplaceableTab = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: (...a: unknown[]) => mockReadTextFile(...a) }));
vi.mock("@/services/tabs/findExistingTabForPath", () => ({
  findExistingTabForPath: (...a: unknown[]) => mockFindExistingTabForPath(...a),
}));
let mockTabs: Array<{ id: string; kind: string; filePath: string | null }> = [];
let mockDocs: Record<string, { isDirty: boolean }> = {};
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({ createTab: mockCreateTab, closeTab: mockCloseTab, tabs: { main: mockTabs } }),
  },
  tabFilePath: (t: { filePath: string | null }) => t.filePath,
}));
vi.mock("@/services/tabs/replaceableTab", () => ({
  getReplaceableTab: (...a: unknown[]) => mockGetReplaceableTab(...a),
}));
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      ingestExternalContent: mockIngestExternalContent,
      setLineMetadata: mockSetLineMetadata,
      documents: mockDocs,
    }),
  },
}));

import { restoreWorkspaceTabs } from "./restoreWorkspaceTabs";

beforeEach(() => {
  [mockReadTextFile, mockFindExistingTabForPath, mockCreateTab, mockIngestExternalContent,
   mockSetLineMetadata, mockCloseTab, mockGetReplaceableTab]
    .forEach((m) => m.mockReset());
  mockGetReplaceableTab.mockReturnValue(null);
  mockTabs = [{ id: "blank-1", kind: "document", filePath: null }];
  mockDocs = { "blank-1": { isDirty: false } };
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

/**
 * #1313 — the blank Untitled tab is left orphaned beside a restored workspace.
 *
 * `findExistingTabForPath` dedups by PATH, and the startup tab's path is null,
 * so it can never match and the tab survives alongside the workspace's files.
 *
 * The predicate for "safe to close" already exists and is already honoured by
 * every file-open path (`fileOpen`, Finder open, drag-drop, recent files):
 * `getReplaceableTab` — the only tab, untitled, and clean. This loop is the one
 * seam that bypassed it, so the fix is to apply the existing policy rather than
 * to invent a second definition of "blank tab" that could drift from it.
 */
describe("#1313 — orphaned blank tab", () => {
  it("closes a clean untitled tab when workspace files are restored", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "blank-1" });
    const created = await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(created).toBe(1);
    expect(mockCloseTab).toHaveBeenCalledWith("main", "blank-1");
  });

  it("reads the replaceable tab BEFORE creating any, or it is no longer 'the only tab'", async () => {
    const order: string[] = [];
    mockGetReplaceableTab.mockImplementation(() => {
      order.push("probe");
      return { tabId: "blank-1" };
    });
    mockCreateTab.mockImplementation((_w: string, p: string) => {
      order.push("create");
      return `tab-${p}`;
    });
    await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(order[0]).toBe("probe");
  });

  it("keeps the tab when nothing could be restored — no gratuitous closing", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "blank-1" });
    mockReadTextFile.mockRejectedValue(new Error("gone"));
    expect(await restoreWorkspaceTabs("main", ["/w/missing.md"])).toBe(0);
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("does nothing when there is no replaceable tab (dirty or file-backed)", async () => {
    mockGetReplaceableTab.mockReturnValue(null);
    await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(mockCloseTab).not.toHaveBeenCalled();
  });
});

/**
 * The close is deferred past `await readTextFile`, so the tab's state at probe
 * time is not its state at close time. Between them the event loop runs and the
 * user can type — and `getReplaceableTab`'s cleanliness check was made against
 * the OLD state. Closing on that stale verdict discards their work.
 *
 * Found by an independent audit of this change, not by the change's own tests.
 */
describe("#1313 — the tab is re-checked at close time, not trusted from probe time", () => {
  it("does not close a tab the user dirtied while files were being read", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "blank-1" });
    mockReadTextFile.mockImplementation(async () => {
      mockDocs["blank-1"].isDirty = true; // user types during the read
      return "content";
    });
    expect(await restoreWorkspaceTabs("main", ["/w/a.md"])).toBe(1);
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("does not close a tab that gained a file path while files were being read", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "blank-1" });
    mockReadTextFile.mockImplementation(async () => {
      mockTabs[0].filePath = "/w/saved-meanwhile.md";
      return "content";
    });
    await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("does not close a tab that is already gone", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "blank-1" });
    mockReadTextFile.mockImplementation(async () => {
      mockTabs = [];
      return "content";
    });
    await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("still closes a tab that stayed clean and untitled", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "blank-1" });
    await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(mockCloseTab).toHaveBeenCalledWith("main", "blank-1");
  });
});

/**
 * Class A, instance 2 — the dedup verdict is also stale across the read.
 *
 * `findExistingTabForPath` runs BEFORE `await readTextFile`, and `createTab`
 * runs after. A concurrent opener (hot-exit restore, Finder open, the user)
 * can create a tab for the same path in that window. `createTab` then dedups
 * and returns the EXISTING tab's id — and the next line ingests into it,
 * overwriting whatever the user had there, while `created` counts a tab that
 * was never created.
 */
describe("#1313 audit — dedup is re-checked after the read, not before", () => {
  it("does not overwrite a tab another opener created during the read", async () => {
    mockFindExistingTabForPath.mockImplementation(() => null);
    mockReadTextFile.mockImplementation(async () => {
      // someone else opened this same file while we were reading it
      mockFindExistingTabForPath.mockReturnValue("other-tab");
      return "content";
    });
    const created = await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(mockIngestExternalContent).not.toHaveBeenCalled();
    expect(created).toBe(0);
  });

  it("still restores when nothing else touched the path", async () => {
    mockFindExistingTabForPath.mockReturnValue(null);
    expect(await restoreWorkspaceTabs("main", ["/w/a.md"])).toBe(1);
    expect(mockIngestExternalContent).toHaveBeenCalled();
  });
});

/**
 * One `catch` around read + create + ingest cannot tell a missing file from a
 * failure after the tab exists. It reported both as "could not restore" and
 * left the second case holding an orphan tab with no document.
 */
describe("#1313 audit — read failure and post-create failure are different", () => {
  it("rolls the tab back when ingest fails after the tab exists", async () => {
    mockIngestExternalContent.mockImplementation(() => {
      throw new Error("ingest blew up");
    });
    const created = await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(created).toBe(0);
    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-/w/a.md");
  });

  it("creates nothing to roll back when the file is unreadable", async () => {
    mockReadTextFile.mockRejectedValue(new Error("ENOENT"));
    expect(await restoreWorkspaceTabs("main", ["/w/gone.md"])).toBe(0);
    expect(mockCreateTab).not.toHaveBeenCalled();
    expect(mockCloseTab).not.toHaveBeenCalled();
  });
});
