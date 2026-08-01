/**
 * The three Finder-open defects that came from copying the navigation flows
 * into a hook closure and letting the copies drift.
 *
 * 1. MEDIA. `loadFileIntoTab` always called `readTextFile`, so a `.png`
 *    double-clicked in Finder was read as UTF-8 and errored. The identical
 *    file opened via Cmd+O worked, because that path routes through
 *    `tryOpenMediaFile` first.
 * 2. DEDUP. `createTab` deduplicates by path. When it returned a tab that
 *    already existed — created by a concurrent open whose own read was still
 *    in flight — the branch loaded into it anyway, overwriting content that
 *    could be dirty, and on failure detached a tab it never created.
 * 3. SIZE GATE ON MEDIA. A 4 GB video was routed through the large-file
 *    confirmation even though media tabs are path-only and never read a byte.
 *
 * @coordinates-with services/navigation/finderOpenBranches.ts
 * @module services/navigation/finderOpenBranches.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCreateTab,
  mockFindTabByPath,
  mockSetActiveTab,
  mockDetachTab,
  mockUpdateTabPath,
  mockOpenMediaFileInNewTab,
  mockReplaceTabWithMediaFile,
  mockRouteOpenBySize,
  mockOpenWorkspaceWithConfig,
  mockStartLoad,
  mockEndLoad,
  mockMarkLargeSource,
} = vi.hoisted(() => ({
  mockCreateTab: vi.fn(() => "new-tab"),
  mockFindTabByPath: vi.fn(() => null as { id: string } | null),
  mockSetActiveTab: vi.fn(),
  mockDetachTab: vi.fn(),
  mockUpdateTabPath: vi.fn(),
  mockOpenMediaFileInNewTab: vi.fn(),
  mockReplaceTabWithMediaFile: vi.fn(),
  mockRouteOpenBySize: vi.fn(),
  mockOpenWorkspaceWithConfig: vi.fn(),
  mockStartLoad: vi.fn(() => 1),
  mockEndLoad: vi.fn(),
  mockMarkLargeSource: vi.fn(),
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      createTab: mockCreateTab,
      findTabByPath: mockFindTabByPath,
      setActiveTab: mockSetActiveTab,
      detachTab: mockDetachTab,
      updateTabPath: mockUpdateTabPath,
      getTabsByWindow: () => [],
    }),
  },
}));
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ documents: {} }) },
  useFileLoadStore: {
    getState: () => ({ startLoad: mockStartLoad, endLoad: mockEndLoad }),
  },
}));
vi.mock("@/services/navigation/openMediaFile", async () => {
  const actual = await vi.importActual<typeof import("./openMediaFile")>("./openMediaFile");
  return {
    isBinaryMediaPath: actual.isBinaryMediaPath, // the real classifier
    openMediaFileInNewTab: mockOpenMediaFileInNewTab,
    replaceTabWithMediaFile: mockReplaceTabWithMediaFile,
  };
});
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));
vi.mock("@/services/workspaces/fileOwnership", () => ({
  applyFileOwnershipAfterOpen: vi.fn(),
}));
vi.mock("@/services/navigation/largeFileRouting", () => ({
  routeOpenBySize: (...a: unknown[]) => mockRouteOpenBySize(...a),
}));
vi.mock("@/lib/formats/markdownLargeFile", () => ({
  maybeMarkLargeMarkdownAsSource: (...a: unknown[]) => mockMarkLargeSource(...a),
}));
vi.mock("@/utils/debug", () => ({ finderFileOpenError: vi.fn() }));

import {
  createNewTabForFile,
  replaceTabWithFile,
  withSizeGateAndIndicator,
  type FinderBranchContext,
} from "./finderOpenBranches";

const mockLoadFileIntoTab = vi.fn(async () => {});
const ctx: FinderBranchContext = {
  windowLabel: "main",
  isCancelled: () => false,
  onOpenFailure: vi.fn(),
  loadFileIntoTab: (...a) => mockLoadFileIntoTab(...(a as [])),
};

const MD = "/w/doc.md";
const PNG = "/w/photo.png";

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateTab.mockReturnValue("new-tab");
  mockFindTabByPath.mockReturnValue(null);
  mockLoadFileIntoTab.mockResolvedValue(undefined);
  mockRouteOpenBySize.mockResolvedValue({ proceed: true, sizeBytes: 100, forceSourceMode: false });
});

describe("media never reaches readTextFile", () => {
  it("create branch: a .png opens as a media tab, not a text read", async () => {
    await createNewTabForFile(ctx, PNG, null, false);

    expect(mockOpenMediaFileInNewTab).toHaveBeenCalledWith("main", PNG);
    expect(mockLoadFileIntoTab).not.toHaveBeenCalled();
    expect(mockCreateTab).not.toHaveBeenCalled();
  });

  it("replace branch: a .mp4 replaces the clean tab as media", async () => {
    const result = await replaceTabWithFile(ctx, { tabId: "t1" } as never, "/w/clip.mp4", null);

    expect(mockReplaceTabWithMediaFile).toHaveBeenCalledWith("t1", "/w/clip.mp4");
    expect(mockLoadFileIntoTab).not.toHaveBeenCalled();
    expect(result).toBe("t1");
  });

  it("markdown still goes through the text read", async () => {
    await createNewTabForFile(ctx, MD, null, false);

    expect(mockLoadFileIntoTab).toHaveBeenCalledWith("new-tab", MD);
    expect(mockOpenMediaFileInNewTab).not.toHaveBeenCalled();
  });

  it(".svg is text, not media — it is a registered split-pane format", async () => {
    await createNewTabForFile(ctx, "/w/icon.svg", null, false);

    expect(mockLoadFileIntoTab).toHaveBeenCalled();
    expect(mockOpenMediaFileInNewTab).not.toHaveBeenCalled();
  });
});

describe("media skips the size gate", () => {
  it("a huge video is never routed for large-file confirmation", async () => {
    // Path-only tabs read no bytes, so there is nothing to refuse or confirm.
    await withSizeGateAndIndicator(ctx, PNG, async () => null);
    expect(mockRouteOpenBySize).not.toHaveBeenCalled();
  });

  it("a text file still is", async () => {
    await withSizeGateAndIndicator(ctx, MD, async () => "t");
    expect(mockRouteOpenBySize).toHaveBeenCalledWith(MD);
  });

  it("a refused text file does not run its branch", async () => {
    mockRouteOpenBySize.mockResolvedValue({ proceed: false, sizeBytes: 0, forceSourceMode: false });
    const run = vi.fn(async () => "t");

    await withSizeGateAndIndicator(ctx, MD, run);

    expect(run).not.toHaveBeenCalled();
  });
});

describe("createTab deduplication race", () => {
  it("activates the existing tab instead of overwriting it", async () => {
    // A concurrent open created the tab; its own read is still in flight, so
    // the branch resolver's document-based check could not see it.
    mockFindTabByPath.mockReturnValue({ id: "concurrent-tab" });

    const result = await createNewTabForFile(ctx, MD, null, false);

    expect(mockLoadFileIntoTab).not.toHaveBeenCalled();
    expect(mockSetActiveTab).toHaveBeenCalledWith("main", "concurrent-tab");
    expect(result).toBeNull();
  });

  it("never detaches a tab it did not create", async () => {
    mockFindTabByPath.mockReturnValue({ id: "someone-elses-tab" });

    await createNewTabForFile(ctx, MD, null, false);

    expect(mockDetachTab).not.toHaveBeenCalled();
  });

  it("creates normally when no tab holds that path", async () => {
    const result = await createNewTabForFile(ctx, MD, null, false);

    expect(mockCreateTab).toHaveBeenCalledWith("main", MD);
    expect(result).toBe("new-tab");
  });

  it("detaches its OWN orphan when the read fails", async () => {
    mockLoadFileIntoTab.mockRejectedValue(new Error("EACCES"));

    const result = await createNewTabForFile(ctx, MD, null, false);

    expect(mockDetachTab).toHaveBeenCalledWith("main", "new-tab");
    expect(ctx.onOpenFailure).toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe("cancellation", () => {
  it("stops before creating a tab when the hook already unmounted", async () => {
    const cancelled: FinderBranchContext = { ...ctx, isCancelled: () => true };

    const result = await createNewTabForFile(cancelled, MD, null, false);

    expect(mockCreateTab).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("stops the replace branch after the workspace open", async () => {
    const cancelled: FinderBranchContext = { ...ctx, isCancelled: () => true };

    const result = await replaceTabWithFile(cancelled, { tabId: "t1" } as never, MD, "/w");

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalled();
    expect(mockLoadFileIntoTab).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe("the progress indicator is never left spinning", () => {
  const BIG = { proceed: true, sizeBytes: 50_000_000, forceSourceMode: false };

  it("clears the indicator when the branch lands nothing", async () => {
    // A read failure, a detached orphan, or a dedup all return null. Without
    // this the spinner outlives the operation that started it.
    mockRouteOpenBySize.mockResolvedValue(BIG);

    await withSizeGateAndIndicator(ctx, MD, async () => null);

    expect(mockStartLoad).toHaveBeenCalled();
    expect(mockEndLoad).toHaveBeenCalledWith(1);
  });

  it("does not clear it when content landed — the loader owns its own end", async () => {
    mockRouteOpenBySize.mockResolvedValue(BIG);

    await withSizeGateAndIndicator(ctx, MD, async () => "tab-1");

    expect(mockEndLoad).not.toHaveBeenCalled();
    expect(mockMarkLargeSource).toHaveBeenCalledWith("tab-1", MD, false);
  });

  it("shows no indicator for a small file, and clears nothing", async () => {
    mockRouteOpenBySize.mockResolvedValue({ proceed: true, sizeBytes: 10, forceSourceMode: false });

    await withSizeGateAndIndicator(ctx, MD, async () => null);

    expect(mockStartLoad).not.toHaveBeenCalled();
    expect(mockEndLoad).not.toHaveBeenCalled();
  });

  it("shows no indicator when the route forces Source mode", async () => {
    // Forced-source means the file is huge; the Source surface renders it
    // without the load the indicator would be reporting on.
    mockRouteOpenBySize.mockResolvedValue({ ...BIG, forceSourceMode: true });

    await withSizeGateAndIndicator(ctx, MD, async () => "tab-1");

    expect(mockStartLoad).not.toHaveBeenCalled();
    expect(mockMarkLargeSource).toHaveBeenCalledWith("tab-1", MD, true);
  });

  it("stops after the size route when the hook unmounted mid-check", async () => {
    mockRouteOpenBySize.mockResolvedValue(BIG);
    const run = vi.fn(async () => "t");

    await withSizeGateAndIndicator({ ...ctx, isCancelled: () => true }, MD, run);

    expect(run).not.toHaveBeenCalled();
  });
});
