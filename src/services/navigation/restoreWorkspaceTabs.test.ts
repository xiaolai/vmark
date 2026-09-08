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
    // `activeTabId` is a real store key that production reads directly
    // (WI-TNAV2.5's `collapseMruToActive`); a double that omits it makes a
    // dropped key a silent no-op rather than a crash.
    getState: () => ({
      createTab: mockCreateTab,
      closeTab: mockCloseTab,
      tabs: { main: mockTabs },
      activeTabId: {},
    }),
  },
  tabFilePath: (t: { filePath: string | null }) => t.filePath,
}));
const mockTryOpenMediaFile = vi.fn<(windowLabel: string, path: string) => boolean>(() => false);
vi.mock("@/services/navigation/openMediaFile", () => ({
  tryOpenMediaFile: (windowLabel: string, path: string) =>
    mockTryOpenMediaFile(windowLabel, path),
}));
vi.mock("@/services/tabs/replaceableTab", () => ({
  getReplaceableTab: (...a: unknown[]) => mockGetReplaceableTab(...a),
}));
// Only `workspaceWarn` is replaced; the rest of the debug surface stays real.
const workspaceWarn = vi.fn();
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/debug")>()),
  workspaceWarn: (...args: unknown[]) => workspaceWarn(...args),
}));
const mockApplyFileOwnershipAfterOpen = vi.fn();
vi.mock("@/services/workspaces/fileOwnership", () => ({
  applyFileOwnershipAfterOpen: (...a: unknown[]) => mockApplyFileOwnershipAfterOpen(...a),
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
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";

beforeEach(() => {
  [mockReadTextFile, mockFindExistingTabForPath, mockCreateTab, mockIngestExternalContent,
   mockSetLineMetadata, mockCloseTab, mockGetReplaceableTab, mockTryOpenMediaFile,
   mockApplyFileOwnershipAfterOpen, workspaceWarn]
    .forEach((m) => m.mockReset());
  useClosedTabScopesStore.getState().resetClosedScopes();
  mockTryOpenMediaFile.mockReturnValue(false);
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

/**
 * A workspace's persisted tabs are document paths, and a media tab IS a
 * document tab with a path — so an image or video in `lastOpenTabs` reached
 * `readTextFile` and was decoded as UTF-8. The shared open pipeline has always
 * refused that (`tryOpenMediaFile` runs before any read); this loop, which
 * hand-rolls its own read/create/ingest, never consulted it.
 */
describe("#1313 audit — media files are not read as text on restore", () => {
  it("routes a binary media path to the media opener instead of readTextFile", async () => {
    mockTryOpenMediaFile.mockReturnValue(true);
    const created = await restoreWorkspaceTabs("main", ["/w/clip.mp4"]);
    expect(mockTryOpenMediaFile).toHaveBeenCalledWith("main", "/w/clip.mp4");
    expect(mockReadTextFile).not.toHaveBeenCalled();
    expect(created).toBe(1);
  });

  it("leaves text files on the text path", async () => {
    mockTryOpenMediaFile.mockReturnValue(false);
    await restoreWorkspaceTabs("main", ["/w/a.md"]);
    expect(mockReadTextFile).toHaveBeenCalledWith("/w/a.md");
  });
});

// Audit 20260907 (#480): every other open path — fileOpen, Finder, media,
// replace-tab — runs applyFileOwnershipAfterOpen after ingest, which claims the
// tab for its workspace instance and marks a copy that is already writable in
// another window read-only. Restored text tabs skipped it, so a workspace
// reopened in a second window could hold a second WRITABLE copy of a file.
describe("#480 — restored text tabs get file ownership like every other open", () => {
  it("applies ownership after a successful ingest, for the created tab and path", async () => {
    await restoreWorkspaceTabs("main", ["/a.md"]);
    expect(mockApplyFileOwnershipAfterOpen).toHaveBeenCalledWith("tab-/a.md", "/a.md");
    const ingestOrder = mockIngestExternalContent.mock.invocationCallOrder[0];
    const ownershipOrder = mockApplyFileOwnershipAfterOpen.mock.invocationCallOrder[0];
    expect(ownershipOrder).toBeGreaterThan(ingestOrder);
  });

  it("does not claim ownership for a path that could not be read", async () => {
    mockReadTextFile.mockRejectedValue(new Error("ENOENT"));
    await restoreWorkspaceTabs("main", ["/gone.md"]);
    expect(mockApplyFileOwnershipAfterOpen).not.toHaveBeenCalled();
  });

  it("rolls the tab back when the ownership step throws, like an ingest failure", async () => {
    mockApplyFileOwnershipAfterOpen.mockImplementation(() => {
      throw new Error("claim failed");
    });
    const created = await restoreWorkspaceTabs("main", ["/a.md"]);
    expect(created).toBe(0);
    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-/a.md");
  });
});

// Audit #979/#980 — the two dedup rules are DIFFERENT rules.
// `findExistingTabForPath` matches on the DOCUMENT's filePath, `createTab` on
// the TAB's, so a tab another opener created but has not ingested yet is
// invisible to the first check and deduplicated by the second: `createTab`
// hands back THEIR tab id, and this loop then overwrote its contents — or, on
// an ingest failure, CLOSED it, complete with a false "recently closed" entry.
describe("restoreWorkspaceTabs — createTab deduplication (audit #979/#980)", () => {
  it("does not ingest into, or count, a tab createTab deduplicated onto", async () => {
    mockTabs = [{ id: "theirs", kind: "document", filePath: "/a.md" }];
    // The document has not been created yet, so the path-level check is blind…
    mockFindExistingTabForPath.mockReturnValue(null);
    // …and createTab returns the EXISTING tab id.
    mockCreateTab.mockReturnValue("theirs");

    const created = await restoreWorkspaceTabs("main", ["/a.md"]);

    expect(created).toBe(0);
    expect(mockIngestExternalContent).not.toHaveBeenCalled();
    expect(mockApplyFileOwnershipAfterOpen).not.toHaveBeenCalled();
  });

  it("never closes a pre-existing tab when initialisation fails", async () => {
    mockTabs = [{ id: "theirs", kind: "document", filePath: "/a.md" }];
    mockFindExistingTabForPath.mockReturnValue(null);
    mockCreateTab.mockReturnValue("theirs");
    mockIngestExternalContent.mockImplementation(() => {
      throw new Error("ingest blew up");
    });

    await restoreWorkspaceTabs("main", ["/a.md"]);

    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("still rolls back a tab it really did create", async () => {
    mockTabs = [];
    mockCreateTab.mockReturnValue("mine");
    mockIngestExternalContent.mockImplementation(() => {
      throw new Error("ingest blew up");
    });

    const created = await restoreWorkspaceTabs("main", ["/a.md"]);

    expect(created).toBe(0);
    expect(mockCloseTab).toHaveBeenCalledWith("main", "mine");
  });
});

// Audit #976 — media routing ran outside either catch, so a throw from it
// rejected restoreOnePath and, through it, the whole loop: every sibling path
// after the bad one was abandoned.
describe("a media file that cannot be opened costs one tab, not the session", () => {
  it("restores the siblings after a throwing media open", async () => {
    mockTryOpenMediaFile.mockImplementation((_windowLabel, path) => {
      if (path === "/broken.png") throw new Error("media surface unavailable");
      return false;
    });

    const created = await restoreWorkspaceTabs("main", ["/broken.png", "/a.md", "/b.md"]);

    expect(created).toBe(2);
    expect(mockCreateTab).toHaveBeenCalledTimes(2);
  });

  it("reports the cause instead of failing silently", async () => {
    const cause = new Error("media surface unavailable");
    mockTryOpenMediaFile.mockImplementation(() => {
      throw cause;
    });

    await restoreWorkspaceTabs("main", ["/broken.png"]);

    expect(workspaceWarn).toHaveBeenCalledWith(expect.stringContaining("/broken.png"), cause);
  });
});

// Audit #978 — permission, encoding and filesystem failures all land in the
// read catch, and the message alone said "could not restore" with the cause
// discarded, so none of them could be told apart from a moved file.
describe("a read failure carries its cause", () => {
  it("passes the error to the warning", async () => {
    const cause = new Error("EACCES: permission denied");
    mockReadTextFile.mockRejectedValue(cause);

    const created = await restoreWorkspaceTabs("main", ["/locked.md"]);

    expect(created).toBe(0);
    expect(workspaceWarn).toHaveBeenCalledWith(expect.stringContaining("/locked.md"), cause);
  });
});

// Audit #983 — the startup blank is removed through the USER's close, which
// files it under "recently closed". As the newest entry it then shadowed the
// file the user actually closed last, and Reopen Closed Tab handed back a
// blank Untitled instead.
describe("the startup blank does not enter the reopen history", () => {
  const BLANK = { id: "blank-1", kind: "document" as const, filePath: null, title: "Untitled" };

  it("takes the cleanup's entry back out", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "blank-1" });
    // What closeTab's own bus listener records; closeTab is a mock here, so the
    // entry is seeded through the store that would have received it.
    useClosedTabScopesStore.getState().recordClosedTab("main", BLANK as never);

    await restoreWorkspaceTabs("main", ["/a.md"]);

    expect(mockCloseTab).toHaveBeenCalledWith("main", "blank-1");
    const scopes = useClosedTabScopesStore.getState().scopesByWindow["main"] ?? {};
    const ids = Object.values(scopes).flat().map((entry) => entry.tab.id);
    expect(ids).not.toContain("blank-1");
  });

  it("leaves the user's own closed tabs alone", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "blank-1" });
    useClosedTabScopesStore.getState().recordClosedTab("main", {
      id: "real-1", kind: "document", filePath: "/notes.md", title: "notes.md",
    } as never);
    useClosedTabScopesStore.getState().recordClosedTab("main", BLANK as never);

    await restoreWorkspaceTabs("main", ["/a.md"]);

    const scopes = useClosedTabScopesStore.getState().scopesByWindow["main"] ?? {};
    const ids = Object.values(scopes).flat().map((entry) => entry.tab.id);
    expect(ids).toEqual(["real-1"]);
  });
});
