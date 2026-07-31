/**
 * Tests for the orphan asset scanner (async, mocked Tauri FS).
 *
 * Reference parsing lives in utils/imageReferences.test.ts; the confirm-before-
 * delete flow in orphanCleanupPrompt.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- findOrphanedImages (async, mocked FS) ----

describe("findOrphanedImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result when assets folder does not exist", async () => {
    const { exists } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(false);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no images here");
    expect(result).toEqual({
      orphanedImages: [],
      referencedCount: 0,
      sharedCount: 0,
      totalInFolder: 0,
      scanComplete: true,
    });
  });

  it("identifies orphaned images not referenced in content", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "used.png", isFile: true, isDirectory: false, isSymlink: false },
      { name: "orphan.png", isFile: true, isDirectory: false, isSymlink: false },
    ]);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const content = "![alt](assets/images/used.png)";
    const result = await findOrphanedImages("/doc/test.md", content);

    expect(result.referencedCount).toBe(1);
    expect(result.totalInFolder).toBe(2);
    expect(result.orphanedImages).toHaveLength(1);
    expect(result.orphanedImages[0].filename).toBe("orphan.png");
  });

  it("skips non-image files in assets folder", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "readme.txt", isFile: true, isDirectory: false, isSymlink: false },
      { name: "data.json", isFile: true, isDirectory: false, isSymlink: false },
    ]);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "some content");
    expect(result.totalInFolder).toBe(0);
    expect(result.orphanedImages).toHaveLength(0);
  });

  it("skips files with no extension (line 41 fallback)", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "no-extension", isFile: true, isDirectory: false, isSymlink: false },
      { name: "photo.png", isFile: true, isDirectory: false, isSymlink: false },
    ]);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no refs");
    // Only photo.png should be counted as an image file
    expect(result.totalInFolder).toBe(1);
  });

  it("skips file with trailing dot — ext is empty string, || '' branch (line 41)", async () => {
    // isImageExtension line 41: `ext || ""` — when filename ends with ".", pop() returns ""
    // (empty string is falsy), so the || "" right-hand branch fires.
    // IMAGE_EXTENSIONS.includes("") is false, so the file is not counted as an image.
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "file.", isFile: true, isDirectory: false, isSymlink: false },
      { name: "valid.png", isFile: true, isDirectory: false, isSymlink: false },
    ]);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no refs");
    // "file." has an empty extension — not counted as image, only valid.png is
    expect(result.totalInFolder).toBe(1);
  });

  it("skips directory entries", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "subdir", isFile: false, isDirectory: true, isSymlink: false },
      { name: "photo.png", isFile: true, isDirectory: false, isSymlink: false },
    ]);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no refs");
    expect(result.totalInFolder).toBe(1);
  });
});

// ---- sibling documents share one assets folder ----
//
// `assets/images` is resolved from the document's DIRECTORY, so every markdown
// file in that directory references the same folder. Scanning only the closing
// document would report a neighbour's images as orphans and delete them.

const dirEntry = (name: string) => ({
  name,
  isFile: false,
  isDirectory: true,
  isSymlink: false,
});
const fileEntry = (name: string) => ({
  name,
  isFile: true,
  isDirectory: false,
  isSymlink: false,
});

/** Route readDir per directory: assets folder vs. the document's own folder. */
function mockDirs(assets: string[], docDir: string[]) {
  return async (path: string | URL) => {
    const p = String(path);
    return p.includes("assets")
      ? assets.map(fileEntry)
      : docDir.map((n) => (n.includes(".") ? fileEntry(n) : dirEntry(n)));
  };
}

describe("findOrphanedImages — sibling documents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not orphan an image referenced by a sibling document", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["shared.png"], ["test.md", "neighbour.md", "assets"]) as never,
    );
    vi.mocked(readTextFile).mockResolvedValue("![](./assets/images/shared.png)");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no images here");

    expect(result.orphanedImages).toEqual([]);
    expect(result.sharedCount).toBe(1);
    expect(result.referencedCount).toBe(0);
    expect(result.totalInFolder).toBe(1);
  });

  it("still deletes an image no document references", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["orphan.png"], ["test.md", "neighbour.md"]) as never,
    );
    vi.mocked(readTextFile).mockResolvedValue("nothing in here either");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no images here");

    expect(result.orphanedImages.map((i) => i.filename)).toEqual(["orphan.png"]);
    expect(result.sharedCount).toBe(0);
  });

  it("never reads the closing document itself back off disk", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(mockDirs(["orphan.png"], ["test.md"]) as never);
    vi.mocked(readTextFile).mockResolvedValue("![](./assets/images/orphan.png)");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    // The caller's in-memory content is authoritative for THIS document — a
    // stale on-disk copy must not resurrect an image the user just removed.
    const result = await findOrphanedImages("/doc/test.md", "no images here");

    expect(readTextFile).not.toHaveBeenCalled();
    expect(result.orphanedImages.map((i) => i.filename)).toEqual(["orphan.png"]);
  });

  it("skips the sibling scan entirely when nothing is orphaned", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["used.png"], ["test.md", "neighbour.md"]) as never,
    );

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "![](./assets/images/used.png)");

    expect(readTextFile).not.toHaveBeenCalled();
    expect(result.referencedCount).toBe(1);
  });

  it("ignores non-document siblings", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["orphan.png"], ["test.md", "notes.txt", "data.json"]) as never,
    );
    vi.mocked(readTextFile).mockResolvedValue("![](./assets/images/orphan.png)");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no images");

    expect(readTextFile).not.toHaveBeenCalled();
    expect(result.orphanedImages).toHaveLength(1);
  });

  it("keeps the image when ONE unreadable sibling makes the scan incomplete", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["maybe.png"], ["test.md", "locked.md"]) as never,
    );
    vi.mocked(readTextFile).mockRejectedValue(new Error("EACCES"));

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no images");

    // A sibling we could not read might reference it — deleting would be a guess.
    expect(result.orphanedImages).toEqual([]);
    expect(result.sharedCount).toBe(1);
  });

  it("keeps the image when the sibling directory cannot be listed", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation((async (path: string | URL) => {
      if (String(path).includes("assets")) return [fileEntry("maybe.png")];
      throw new Error("EACCES");
    }) as never);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no images");

    expect(result.orphanedImages).toEqual([]);
    expect(result.sharedCount).toBe(1);
  });

  it("recognises every markdown extension as a sibling document", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["shared.png"], ["test.md", "a.MARKDOWN", "b.mdown", "c.mkd", "d.mdx"]) as never,
    );
    vi.mocked(readTextFile).mockImplementation((async (p: string) =>
      String(p).endsWith("d.mdx") ? "![](./assets/images/shared.png)" : "") as never);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no images");

    expect(result.orphanedImages).toEqual([]);
  });
});

// ---- deleteOrphanedImages (async, mocked FS) ----

describe("deleteOrphanedImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes all provided orphaned images and reports the count", async () => {
    const { remove } = await import("@tauri-apps/plugin-fs");
    vi.mocked(remove).mockResolvedValue(undefined);

    const { deleteOrphanedImages } = await import("./orphanAssetCleanup");
    const outcome = await deleteOrphanedImages([
      { filename: "a.png", fullPath: "/doc/assets/images/a.png" },
      { filename: "b.png", fullPath: "/doc/assets/images/b.png" },
    ]);
    expect(outcome).toEqual({ deleted: 2, failed: [] });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("reports nothing for an empty array", async () => {
    const { deleteOrphanedImages } = await import("./orphanAssetCleanup");
    expect(await deleteOrphanedImages([])).toEqual({ deleted: 0, failed: [] });
  });

  // A locked or already-removed file must be NAMED, not folded into a success
  // count — the prompt reports "Cleanup Complete" off this value.
  it("names the files it could not delete and keeps going", async () => {
    const { remove } = await import("@tauri-apps/plugin-fs");
    vi.mocked(remove)
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(undefined);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deleteOrphanedImages } = await import("./orphanAssetCleanup");

    const outcome = await deleteOrphanedImages([
      { filename: "fail.png", fullPath: "/fail.png" },
      { filename: "ok.png", fullPath: "/ok.png" },
    ]);
    expect(outcome).toEqual({ deleted: 1, failed: ["fail.png"] });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it("reports every failure when nothing can be deleted", async () => {
    const { remove } = await import("@tauri-apps/plugin-fs");
    vi.mocked(remove).mockRejectedValue(new Error("EACCES"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deleteOrphanedImages } = await import("./orphanAssetCleanup");

    const outcome = await deleteOrphanedImages([
      { filename: "a.png", fullPath: "/a.png" },
      { filename: "b.png", fullPath: "/b.png" },
    ]);
    expect(outcome).toEqual({ deleted: 0, failed: ["a.png", "b.png"] });
    consoleSpy.mockRestore();
  });
});

// ---- knownContents: an open sibling's UNSAVED buffer ----
//
// A tab that just pasted an image references it only in memory. Reading that
// sibling from disk misses the reference, and closing another tab then deletes
// the image out from under a document the user is still looking at.

describe("findOrphanedImages — knownContents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("protects an image referenced only by an open sibling's unsaved buffer", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["pasted.png"], ["test.md", "neighbour.md"]) as never,
    );
    // Disk copy of the neighbour predates the paste.
    vi.mocked(readTextFile).mockResolvedValue("no images yet");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "no images here", {
      knownContents: new Map([["/doc/neighbour.md", "![](./assets/images/pasted.png)"]]),
    });

    expect(result.orphanedImages).toEqual([]);
    expect(result.sharedCount).toBe(1);
  });

  it("deletes only when NEITHER the buffer nor the file references it", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["orphan.png"], ["test.md", "neighbour.md"]) as never,
    );
    vi.mocked(readTextFile).mockResolvedValue("nothing here");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "", {
      knownContents: new Map([["/doc/neighbour.md", "the paste was undone"]]),
    });

    expect(result.orphanedImages.map((i) => i.filename)).toEqual(["orphan.png"]);
  });

  // Buffer and file are UNIONED, not one-wins-over-the-other. A buffer can be
  // behind its file — a sync client or another editor may have just rewritten
  // it — so trusting only the buffer deletes what the file still references.
  it("protects an image the FILE references even when the buffer does not", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["shared.png"], ["test.md", "neighbour.md"]) as never,
    );
    vi.mocked(readTextFile).mockResolvedValue("![](./assets/images/shared.png)");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "", {
      knownContents: new Map([["/doc/neighbour.md", "buffer has not caught up"]]),
    });

    expect(result.orphanedImages).toEqual([]);
  });

  // An open document readDir did not return — deleted or moved externally while
  // its buffer stays on screen — still holds references.
  it("scans a buffered sibling that the directory listing no longer contains", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(mockDirs(["shared.png"], ["test.md"]) as never);
    vi.mocked(readTextFile).mockRejectedValue(new Error("ENOENT"));

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "", {
      knownContents: new Map([["/doc/vanished.md", "![](./assets/images/shared.png)"]]),
    });

    expect(result.orphanedImages).toEqual([]);
    expect(result.scanComplete).toBe(true); // a buffer covered the unreadable file
  });

  it("ignores a buffered document from another directory", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(mockDirs(["orphan.png"], ["test.md"]) as never);
    vi.mocked(readTextFile).mockResolvedValue("");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "", {
      knownContents: new Map([["/elsewhere/other.md", "![](./assets/images/orphan.png)"]]),
    });

    // A different directory has a different assets folder — that reference is
    // not to this file.
    expect(result.orphanedImages.map((i) => i.filename)).toEqual(["orphan.png"]);
  });

  it("reads siblings from disk when no buffer is supplied for them", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["shared.png"], ["test.md", "a.md", "b.md"]) as never,
    );
    vi.mocked(readTextFile).mockResolvedValue("![](./assets/images/shared.png)");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "", {
      knownContents: new Map([["/doc/a.md", "nothing"]]),
    });

    // Both siblings are read — buffered ones too, so buffer and file union.
    expect(vi.mocked(readTextFile).mock.calls.map((c) => c[0]).sort()).toEqual([
      "/doc/a.md",
      "/doc/b.md",
    ]);
    expect(result.orphanedImages).toEqual([]);
  });
});

// ---- scan completeness is reported, not silently folded in ----

describe("findOrphanedImages — scanComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is true for a scan that read everything", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(mockDirs(["orphan.png"], ["test.md", "n.md"]) as never);
    vi.mocked(readTextFile).mockResolvedValue("");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    expect((await findOrphanedImages("/doc/test.md", "")).scanComplete).toBe(true);
  });

  it("is false when a sibling could not be read", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(mockDirs(["maybe.png"], ["test.md", "n.md"]) as never);
    vi.mocked(readTextFile).mockRejectedValue(new Error("EACCES"));

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "");
    expect(result.scanComplete).toBe(false);
    expect(result.orphanedImages).toEqual([]);
  });

  it("is true when there is nothing to delete (no sibling scan needed)", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(mockDirs(["used.png"], ["test.md"]) as never);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "![](./assets/images/used.png)");
    expect(result.scanComplete).toBe(true);
  });
});

// ---- matching rules that gate deletion ----

describe("findOrphanedImages — reference matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["![](./assets/images/Photo.PNG)", "case differs from disk"],
    ["![](./assets/images/photo.png?v=2)", "cache-busting query"],
    ["![](./assets/images/photo.png#top)", "fragment"],
    ["![](assets%2Fimages%2Fphoto.png)", "percent-encoded separators"],
    ["![alt][p]\n\n[p]: ./assets/images/photo.png", "reference-style image"],
  ])("keeps photo.png when referenced with a %s", async (content) => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(mockDirs(["photo.png"], ["test.md"]) as never);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", content);
    expect(result.orphanedImages).toEqual([]);
    expect(result.referencedCount).toBe(1);
  });

  it("does not confuse a same-named file in a different folder", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(mockDirs(["photo.png"], ["test.md"]) as never);
    vi.mocked(readTextFile).mockResolvedValue("");

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "![](./elsewhere/photo.png)");
    expect(result.orphanedImages.map((i) => i.filename)).toEqual(["photo.png"]);
  });

  it("bounds sibling reads instead of opening every file at once", async () => {
    const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    const siblings = Array.from({ length: 40 }, (_, i) => `n${i}.md`);
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockImplementation(
      mockDirs(["orphan.png"], ["test.md", ...siblings]) as never,
    );

    let inFlight = 0;
    let peak = 0;
    vi.mocked(readTextFile).mockImplementation((async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return "";
    }) as never);

    const { findOrphanedImages } = await import("./orphanAssetCleanup");
    const result = await findOrphanedImages("/doc/test.md", "");

    expect(readTextFile).toHaveBeenCalledTimes(40);
    expect(peak).toBeLessThanOrEqual(8);
    expect(result.orphanedImages).toHaveLength(1);
  });
});
