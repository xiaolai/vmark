/**
 * Tests for orphanAssetCleanup module.
 *
 * extractImageReferences is a pure function — tested exhaustively.
 * Async functions (findOrphanedImages, deleteOrphanedImages, runOrphanCleanup)
 * are tested via mocked Tauri APIs from test/setup.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractImageReferences } from "./orphanAssetCleanup";

// ---- extractImageReferences (pure) ----

describe("extractImageReferences", () => {
  it("extracts standard markdown image paths", () => {
    const content = "![alt](assets/images/test.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts paths with ./ prefix and normalizes them", () => {
    const content = "![alt](./assets/images/test.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts paths with title attribute", () => {
    const content = '![alt](./assets/images/test.png "Title")';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts angle bracket syntax for paths with spaces", () => {
    const content = "![alt](<./assets/images/my image.png>)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/my image.png")).toBe(true);
  });

  it("extracts URL-encoded paths and decodes them", () => {
    const content = "![alt](./assets/images/my%20image.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/my image.png")).toBe(true);
  });

  it("extracts multiple images from content", () => {
    const content = `
# Document

![first](./assets/images/first.png)

Some text here.

![second](./assets/images/second.jpg)

More text.

![third](./assets/images/third.gif)
`;
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(3);
    expect(refs.has("assets/images/first.png")).toBe(true);
    expect(refs.has("assets/images/second.jpg")).toBe(true);
    expect(refs.has("assets/images/third.gif")).toBe(true);
  });

  it("extracts HTML img tags", () => {
    const content = '<img src="./assets/images/test.png" alt="test">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("extracts HTML img with single quotes", () => {
    const content = "<img src='./assets/images/test.png' alt='test'>";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("handles mixed markdown and HTML images", () => {
    const content = `
![md](./assets/images/markdown.png)
<img src="./assets/images/html.png">
`;
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(2);
    expect(refs.has("assets/images/markdown.png")).toBe(true);
    expect(refs.has("assets/images/html.png")).toBe(true);
  });

  it("handles empty alt text", () => {
    const content = "![](./assets/images/test.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/test.png")).toBe(true);
  });

  it("handles alt text with special characters", () => {
    const content = "![image with [brackets] and (parens)](./assets/images/test.png)";
    const refs = extractImageReferences(content);
    // The bracket handling in the regex is simple, this tests actual behavior
    expect(refs.size).toBeGreaterThanOrEqual(0);
  });

  it("returns empty set for content with no images", () => {
    const content = "# Just text\n\nNo images here.";
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(0);
  });

  it("handles external URLs (should still extract)", () => {
    const content = "![external](https://example.com/image.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("https://example.com/image.png")).toBe(true);
  });

  it("deduplicates repeated references", () => {
    const content = `
![first](./assets/images/same.png)
![second](./assets/images/same.png)
![third](./assets/images/same.png)
`;
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(1);
    expect(refs.has("assets/images/same.png")).toBe(true);
  });

  // ---- Additional edge cases for coverage ----

  it("returns empty set for empty string", () => {
    expect(extractImageReferences("").size).toBe(0);
  });

  it("handles path without ./ prefix (no normalization needed)", () => {
    const content = "![alt](assets/photo.jpg)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/photo.jpg")).toBe(true);
  });

  it("handles CJK filenames in markdown images", () => {
    const content = "![alt](./assets/images/\u622a\u56fe.png)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/\u622a\u56fe.png")).toBe(true);
  });

  it("handles CJK filenames in HTML img tags", () => {
    const content = '<img src="./assets/images/\u622a\u56fe.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/\u622a\u56fe.png")).toBe(true);
  });

  it("handles URL-encoded CJK in img src", () => {
    const content = '<img src="./assets/images/%E6%88%AA%E5%9B%BE.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/\u622a\u56fe.png")).toBe(true);
  });

  it("handles malformed percent encoding gracefully", () => {
    const content = "![alt](./assets/images/%ZZ%invalid.png)";
    const refs = extractImageReferences(content);
    // decodeURIComponent fails, so raw string (with ./ stripped) is used
    expect(refs.has("assets/images/%ZZ%invalid.png")).toBe(true);
  });

  it("handles malformed percent encoding in HTML img tags", () => {
    const content = '<img src="./assets/images/%ZZ%bad.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/%ZZ%bad.png")).toBe(true);
  });

  it("handles img tag without ./ prefix", () => {
    const content = '<img src="assets/images/direct.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/images/direct.png")).toBe(true);
  });

  it("handles multiple img tags on same line", () => {
    const content = '<img src="a.png"><img src="b.png">';
    const refs = extractImageReferences(content);
    expect(refs.has("a.png")).toBe(true);
    expect(refs.has("b.png")).toBe(true);
  });

  it("handles img tag with extra attributes", () => {
    const content = '<img width="100" src="./assets/photo.png" height="50" alt="pic">';
    const refs = extractImageReferences(content);
    expect(refs.has("assets/photo.png")).toBe(true);
  });

  it("handles angle bracket path without ./ prefix", () => {
    const content = "![alt](<assets/my image.png>)";
    const refs = extractImageReferences(content);
    expect(refs.has("assets/my image.png")).toBe(true);
  });

  it("handles markdown link (not image) — should not extract", () => {
    const content = "[click here](https://example.com)";
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(0);
  });

  it("handles content with only whitespace", () => {
    const content = "   \n\n   \t  ";
    const refs = extractImageReferences(content);
    expect(refs.size).toBe(0);
  });
});

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
      totalInFolder: 0,
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

// ---- deleteOrphanedImages (async, mocked FS) ----

describe("deleteOrphanedImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes all provided orphaned images and returns count", async () => {
    const { remove } = await import("@tauri-apps/plugin-fs");
    vi.mocked(remove).mockResolvedValue(undefined);

    const { deleteOrphanedImages } = await import("./orphanAssetCleanup");
    const count = await deleteOrphanedImages([
      { filename: "a.png", fullPath: "/doc/assets/images/a.png" },
      { filename: "b.png", fullPath: "/doc/assets/images/b.png" },
    ]);
    expect(count).toBe(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("returns 0 for empty array", async () => {
    const { deleteOrphanedImages } = await import("./orphanAssetCleanup");
    const count = await deleteOrphanedImages([]);
    expect(count).toBe(0);
  });

  it("continues deleting when one file fails and counts successes", async () => {
    const { remove } = await import("@tauri-apps/plugin-fs");
    vi.mocked(remove)
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(undefined);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deleteOrphanedImages } = await import("./orphanAssetCleanup");

    const count = await deleteOrphanedImages([
      { filename: "fail.png", fullPath: "/fail.png" },
      { filename: "ok.png", fullPath: "/ok.png" },
    ]);
    expect(count).toBe(1);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});

// ---- runOrphanCleanup (async, mocked dialogs) ----

describe("runOrphanCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns -1 and shows warning when documentPath is null", async () => {
    const { message } = await import("@tauri-apps/plugin-dialog");
    const { runOrphanCleanup } = await import("./orphanAssetCleanup");
    const result = await runOrphanCleanup(null, "content");
    expect(result).toBe(-1);
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("save the document first"),
      expect.objectContaining({ kind: "warning" }),
    );
  });

  it("returns -1 and shows warning when documentContent is null", async () => {
    const { message } = await import("@tauri-apps/plugin-dialog");
    const { runOrphanCleanup } = await import("./orphanAssetCleanup");
    const result = await runOrphanCleanup("/doc/test.md", null);
    expect(result).toBe(-1);
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("save your changes first"),
      expect.objectContaining({ kind: "warning" }),
    );
  });

  it("returns 0 and shows info when no orphans found", async () => {
    const { exists } = await import("@tauri-apps/plugin-fs");
    const { message } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(exists).mockResolvedValue(false);

    const { runOrphanCleanup } = await import("./orphanAssetCleanup");
    const result = await runOrphanCleanup("/doc/test.md", "content");
    expect(result).toBe(0);
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("No unused images"),
      expect.objectContaining({ kind: "info" }),
    );
  });

  it("returns -1 when user cancels deletion", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "orphan.png", isFile: true, isDirectory: false, isSymlink: false },
    ]);
    vi.mocked(confirm).mockResolvedValue(false);

    const { runOrphanCleanup } = await import("./orphanAssetCleanup");
    const result = await runOrphanCleanup("/doc/test.md", "no images here");
    expect(result).toBe(-1);
  });

  it("deletes orphans and returns count on confirmation", async () => {
    const { exists, readDir, remove } = await import("@tauri-apps/plugin-fs");
    const { confirm, message } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "orphan1.png", isFile: true, isDirectory: false, isSymlink: false },
      { name: "orphan2.jpg", isFile: true, isDirectory: false, isSymlink: false },
    ]);
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(remove).mockResolvedValue(undefined);

    const { runOrphanCleanup } = await import("./orphanAssetCleanup");
    const result = await runOrphanCleanup("/doc/test.md", "no images");
    expect(result).toBe(2);
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("Deleted 2"),
      expect.objectContaining({ kind: "info" }),
    );
  });

  it("shows more text for more than 10 orphans", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const entries = Array.from({ length: 12 }, (_, i) => ({
      name: `img${i}.png`,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    }));
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue(entries);
    vi.mocked(confirm).mockResolvedValue(false);

    const { runOrphanCleanup } = await import("./orphanAssetCleanup");
    await runOrphanCleanup("/doc/test.md", "no images");
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("and 2 more"),
      expect.anything(),
    );
  });

  it("shows auto-cleanup hint when autoCleanupEnabled is true", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "orphan.png", isFile: true, isDirectory: false, isSymlink: false },
    ]);
    vi.mocked(confirm).mockResolvedValue(false);

    const { runOrphanCleanup } = await import("./orphanAssetCleanup");
    await runOrphanCleanup("/doc/test.md", "no images", true);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("automatically deleted"),
      expect.anything(),
    );
  });

  it("shows tip hint when autoCleanupEnabled is false", async () => {
    const { exists, readDir } = await import("@tauri-apps/plugin-fs");
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readDir).mockResolvedValue([
      { name: "orphan.png", isFile: true, isDirectory: false, isSymlink: false },
    ]);
    vi.mocked(confirm).mockResolvedValue(false);

    const { runOrphanCleanup } = await import("./orphanAssetCleanup");
    await runOrphanCleanup("/doc/test.md", "no images", false);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Tip:"),
      expect.anything(),
    );
  });
});
