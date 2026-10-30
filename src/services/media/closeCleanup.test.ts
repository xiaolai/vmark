// @vitest-environment node
/**
 * Tests for close-time orphan-image cleanup.
 *
 * The directory scanner, the file read, the cross-window reference query and
 * the workspace reference check are the I/O boundaries and are mocked; the
 * decisions this module makes — which content represents a closing document,
 * scanning once per directory, the two-scan intersection, never rejecting —
 * run against the real document and settings stores.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrphanCleanupResult, OrphanedImage } from "./orphanAssetCleanup";

vi.mock("./orphanAssetCleanup", () => ({
  findOrphanedImages: vi.fn(),
  deleteOrphanedImages: vi.fn(),
}));
vi.mock("@/services/files/readDocumentText", () => ({
  readDocumentText: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn(async (p: string) => p.slice(0, p.lastIndexOf("/"))),
}));
vi.mock("./crossWindowRefs", () => ({
  collectRemoteLiveRefs: vi.fn(async () => ({ complete: true, keys: [] })),
}));
vi.mock("./workspaceReferenceCheck", () => ({
  withoutWorkspaceReferenced: vi.fn(async (images: OrphanedImage[]) => images),
}));

import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { readDocumentText } from "@/services/files/readDocumentText";
import { deleteOrphanedImages, findOrphanedImages } from "./orphanAssetCleanup";
import { withoutWorkspaceReferenced } from "./workspaceReferenceCheck";
import { cleanupOrphansForClosingTabs } from "./closeCleanup";

const image = (filename: string, dir = "/doc"): OrphanedImage => ({
  filename,
  fullPath: `${dir}/assets/images/${filename}`,
});

function scan(orphanedImages: OrphanedImage[]): OrphanCleanupResult {
  return {
    orphanedImages,
    referencedCount: 0,
    sharedCount: 0,
    totalInFolder: orphanedImages.length,
    scanComplete: true,
  };
}

function setCleanupOnClose(on: boolean): void {
  const s = useSettingsStore.getState();
  useSettingsStore.setState({ image: { ...s.image, cleanupOrphansOnClose: on } });
}

/** Open a document in a tab of the main window. */
function open(tabId: string, content: string, filePath: string | null): void {
  useTabStore.setState((state) => ({
    tabs: {
      ...state.tabs,
      main: [
        ...(state.tabs.main ?? []),
        { kind: "document", id: tabId, filePath, title: tabId, isPinned: false, formatId: "markdown" },
      ],
    },
  }));
  useDocumentStore.getState().initDocument(tabId, content, filePath);
}

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  setCleanupOnClose(true);
  vi.mocked(findOrphanedImages).mockResolvedValue(scan([]));
  vi.mocked(deleteOrphanedImages).mockResolvedValue({ deleted: 0, failed: [] });
});

describe("cleanupOrphansForClosingTabs", () => {
  it("does nothing when the setting is off", async () => {
    setCleanupOnClose(false);
    open("t1", "text", "/doc/a.md");

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(findOrphanedImages).not.toHaveBeenCalled();
  });

  it("skips untitled documents: they have no assets folder", async () => {
    open("t1", "text", null);

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(findOrphanedImages).not.toHaveBeenCalled();
  });

  it("scans a clean document's buffer without re-reading the file", async () => {
    open("t1", "clean buffer", "/doc/a.md");

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(readDocumentText).not.toHaveBeenCalled();
    expect(findOrphanedImages).toHaveBeenCalledWith("/doc/a.md", "clean buffer", expect.any(Object));
  });

  it("scans the FILE for a dirty document, since its edits are being discarded", async () => {
    open("t1", "saved", "/doc/a.md");
    useDocumentStore.getState().setEditorContent("t1", "unsaved edit");
    vi.mocked(readDocumentText).mockResolvedValue("on disk");

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(readDocumentText).toHaveBeenCalledWith("/doc/a.md");
    expect(findOrphanedImages).toHaveBeenCalledWith("/doc/a.md", "on disk", expect.any(Object));
  });

  it("scans the FILE for a divergent document", async () => {
    open("t1", "buffer", "/doc/a.md");
    useDocumentStore.getState().markDivergent("t1");
    vi.mocked(readDocumentText).mockResolvedValue("on disk");

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(findOrphanedImages).toHaveBeenCalledWith("/doc/a.md", "on disk", expect.any(Object));
  });

  it("skips the scan when the file cannot be re-read", async () => {
    open("t1", "saved", "/doc/a.md");
    useDocumentStore.getState().setEditorContent("t1", "unsaved edit");
    vi.mocked(readDocumentText).mockRejectedValue(new Error("EACCES"));

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(findOrphanedImages).not.toHaveBeenCalled();
    expect(deleteOrphanedImages).not.toHaveBeenCalled();
  });

  it("scans each assets directory once, however many closing tabs share it", async () => {
    open("t1", "a", "/doc/a.md");
    open("t2", "b", "/doc/b.md");
    open("t3", "c", "/other/c.md");

    await cleanupOrphansForClosingTabs(["t1", "t2", "t3"]);

    const scannedPaths = vi.mocked(findOrphanedImages).mock.calls.map((c) => c[0]);
    expect(scannedPaths).toEqual(["/doc/a.md", "/other/c.md"]);
  });

  it("passes a sibling tab's live buffer as reference evidence", async () => {
    open("closing", "a", "/doc/a.md");
    open("sibling", "saved", "/doc/b.md");
    useDocumentStore.getState().setEditorContent("sibling", "![](./assets/images/new.png)");

    await cleanupOrphansForClosingTabs(["closing"]);

    const options = vi.mocked(findOrphanedImages).mock.calls[0][2];
    expect(options?.knownContents?.get("/doc/b.md")).toBe("![](./assets/images/new.png)");
  });

  it("deletes only images both scans agree are orphaned", async () => {
    open("t1", "a", "/doc/a.md");
    vi.mocked(findOrphanedImages)
      .mockResolvedValueOnce(scan([image("x.png"), image("y.png")]))
      .mockResolvedValueOnce(scan([image("y.png"), image("z.png")]));

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(deleteOrphanedImages).toHaveBeenCalledTimes(1);
    expect(deleteOrphanedImages).toHaveBeenCalledWith([image("y.png")]);
  });

  it("does not run the second scan when the first finds nothing", async () => {
    open("t1", "a", "/doc/a.md");

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(findOrphanedImages).toHaveBeenCalledTimes(1);
    expect(deleteOrphanedImages).not.toHaveBeenCalled();
  });

  it("keeps an image another workspace document references", async () => {
    open("t1", "a", "/doc/a.md");
    vi.mocked(findOrphanedImages).mockResolvedValue(scan([image("x.png")]));
    vi.mocked(withoutWorkspaceReferenced).mockResolvedValueOnce([]);

    await cleanupOrphansForClosingTabs(["t1"]);

    expect(deleteOrphanedImages).not.toHaveBeenCalled();
  });

  it("never rejects, so a cleanup failure cannot strand a closing window", async () => {
    open("t1", "a", "/doc/a.md");
    open("t2", "b", "/other/b.md");
    vi.mocked(findOrphanedImages)
      .mockRejectedValueOnce(new Error("scan failed"))
      .mockResolvedValue(scan([]));

    await expect(cleanupOrphansForClosingTabs(["t1", "t2"])).resolves.toBeUndefined();
    // The failing directory does not stop the next one.
    expect(vi.mocked(findOrphanedImages).mock.calls.map((c) => c[0])).toContain("/other/b.md");
  });
});
