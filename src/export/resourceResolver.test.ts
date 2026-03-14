/**
 * Tests for Resource Resolver
 *
 * Covers image extraction, URL classification, path resolution,
 * data URI conversion, resource bundling, and edge cases.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock Tauri FS APIs (beyond what setup.ts provides)
const mockReadFile = vi.fn();
const mockCopyFile = vi.fn();
const mockExists = vi.fn();
const mockMkdir = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
  exists: (...args: unknown[]) => mockExists(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
  dirname: vi.fn((path: string) =>
    Promise.resolve(path.split("/").slice(0, -1).join("/") || "/"),
  ),
  basename: vi.fn((path: string) =>
    Promise.resolve(path.split("/").pop() || ""),
  ),
}));

vi.mock("./fontEmbedder", () => ({
  uint8ArrayToBase64: vi.fn((data: Uint8Array) => {
    // Simple mock: return a predictable base64 string
    return Buffer.from(data).toString("base64");
  }),
}));

vi.mock("@/utils/debug", () => ({
  exportWarn: vi.fn(),
}));

import {
  isRemoteUrl,
  isDataUri,
  isAssetUrl,
  extractImageSources,
  resolveRelativePath,
  fileToDataUri,
  resolveResources,
  getDocumentBaseDir,
  formatFileSize,
} from "./resourceResolver";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isRemoteUrl
// ---------------------------------------------------------------------------
describe("isRemoteUrl", () => {
  it("returns true for http URLs", () => {
    expect(isRemoteUrl("http://example.com/img.png")).toBe(true);
  });

  it("returns true for https URLs", () => {
    expect(isRemoteUrl("https://example.com/img.png")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isRemoteUrl("images/photo.png")).toBe(false);
  });

  it("returns false for absolute paths", () => {
    expect(isRemoteUrl("/Users/test/photo.png")).toBe(false);
  });

  it("returns false for data URIs", () => {
    expect(isRemoteUrl("data:image/png;base64,abc")).toBe(false);
  });

  it("returns false for asset URLs", () => {
    expect(isRemoteUrl("asset://localhost/path")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRemoteUrl("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDataUri
// ---------------------------------------------------------------------------
describe("isDataUri", () => {
  it("returns true for data: prefix", () => {
    expect(isDataUri("data:image/png;base64,abc")).toBe(true);
  });

  it("returns true for data:text/plain", () => {
    expect(isDataUri("data:text/plain,hello")).toBe(true);
  });

  it("returns false for http URLs", () => {
    expect(isDataUri("https://example.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isDataUri("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAssetUrl
// ---------------------------------------------------------------------------
describe("isAssetUrl", () => {
  it("returns true for asset:// protocol", () => {
    expect(isAssetUrl("asset://localhost/path/to/file.png")).toBe(true);
  });

  it("returns true for tauri:// protocol", () => {
    expect(isAssetUrl("tauri://some-resource")).toBe(true);
  });

  it("returns true for https://asset.localhost/", () => {
    expect(isAssetUrl("https://asset.localhost/path/to/file.png")).toBe(true);
  });

  it("returns false for regular https URLs", () => {
    expect(isAssetUrl("https://example.com/image.png")).toBe(false);
  });

  it("returns false for relative paths", () => {
    expect(isAssetUrl("images/photo.png")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAssetUrl("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractImageSources
// ---------------------------------------------------------------------------
describe("extractImageSources", () => {
  it("extracts src from img tags with double quotes", () => {
    const html = '<img src="images/photo.png" alt="photo">';
    expect(extractImageSources(html)).toEqual(["images/photo.png"]);
  });

  it("extracts src from img tags with single quotes", () => {
    const html = "<img src='images/photo.png' alt='photo'>";
    expect(extractImageSources(html)).toEqual(["images/photo.png"]);
  });

  it("extracts multiple image sources", () => {
    const html = '<img src="a.png"><p>text</p><img src="b.jpg">';
    expect(extractImageSources(html)).toEqual(["a.png", "b.jpg"]);
  });

  it("skips data URIs", () => {
    const html = '<img src="data:image/png;base64,abc"><img src="real.png">';
    expect(extractImageSources(html)).toEqual(["real.png"]);
  });

  it("returns empty array for no images", () => {
    expect(extractImageSources("<p>no images</p>")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractImageSources("")).toEqual([]);
  });

  it("handles img tags with extra attributes", () => {
    const html =
      '<img class="photo" src="test.png" width="100" height="50">';
    expect(extractImageSources(html)).toEqual(["test.png"]);
  });

  it("handles asset URLs in img tags", () => {
    const html = '<img src="https://asset.localhost/path/file.png">';
    expect(extractImageSources(html)).toEqual([
      "https://asset.localhost/path/file.png",
    ]);
  });

  it("handles self-closing img tags", () => {
    const html = '<img src="photo.png" />';
    expect(extractImageSources(html)).toEqual(["photo.png"]);
  });
});

// ---------------------------------------------------------------------------
// resolveRelativePath
// ---------------------------------------------------------------------------
describe("resolveRelativePath", () => {
  it("returns absolute paths as-is", async () => {
    const result = await resolveRelativePath("/absolute/path.png", "/base");
    expect(result).toBe("/absolute/path.png");
  });

  it("resolves relative paths against base directory", async () => {
    const result = await resolveRelativePath(
      "images/photo.png",
      "/Users/test/docs",
    );
    expect(result).toBe("/Users/test/docs/images/photo.png");
  });

  it("extracts path from asset:// URLs", async () => {
    const result = await resolveRelativePath(
      "asset://localhost/path/to/file.png",
      "/base",
    );
    expect(result).toBe("/path/to/file.png");
  });

  it("extracts path from https://asset.localhost/ URLs", async () => {
    const result = await resolveRelativePath(
      "https://asset.localhost/path/to/file.png",
      "/base",
    );
    expect(result).toBe("/path/to/file.png");
  });

  it("decodes URI-encoded characters in asset URLs", async () => {
    const result = await resolveRelativePath(
      "asset://localhost/path/to/my%20file.png",
      "/base",
    );
    expect(result).toBe("/path/to/my file.png");
  });

  it("handles tauri:// URLs", async () => {
    const result = await resolveRelativePath(
      "tauri://localhost/resource.png",
      "/base",
    );
    expect(result).toBe("/resource.png");
  });

  it("returns src as-is for invalid asset URL parse", async () => {
    // A URL that the URL constructor can parse but has unusual shape
    const result = await resolveRelativePath("simple-file.png", "/base");
    expect(result).toBe("/base/simple-file.png");
  });

});

// ---------------------------------------------------------------------------
// fileToDataUri
// ---------------------------------------------------------------------------
describe("fileToDataUri", () => {
  it("converts a PNG file to data URI", async () => {
    const fakeData = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    mockReadFile.mockResolvedValue(fakeData);

    const result = await fileToDataUri("/path/to/image.png");
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(mockReadFile).toHaveBeenCalledWith("/path/to/image.png");
  });

  it("uses correct MIME type for JPEG", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([255, 216]));
    const result = await fileToDataUri("/path/to/photo.jpg");
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("uses correct MIME type for SVG", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([60, 115, 118, 103]));
    const result = await fileToDataUri("/path/to/icon.svg");
    expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("uses correct MIME type for GIF", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([71, 73, 70]));
    const result = await fileToDataUri("/path/to/anim.gif");
    expect(result).toMatch(/^data:image\/gif;base64,/);
  });

  it("uses correct MIME type for WebP", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([82, 73, 70, 70]));
    const result = await fileToDataUri("/path/to/image.webp");
    expect(result).toMatch(/^data:image\/webp;base64,/);
  });

  it("falls back to application/octet-stream for unknown extensions", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([0, 1, 2]));
    const result = await fileToDataUri("/path/to/file.xyz");
    expect(result).toMatch(/^data:application\/octet-stream;base64,/);
  });

  it("returns null when file read fails", async () => {
    mockReadFile.mockRejectedValue(new Error("File not found"));
    const result = await fileToDataUri("/nonexistent/file.png");
    expect(result).toBeNull();
  });

  it("handles files with no extension", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([0]));
    const result = await fileToDataUri("/path/to/noext");
    expect(result).toMatch(/^data:application\/octet-stream;base64,/);
  });

  it("uses correct MIME type for ICO", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([0, 0, 1, 0]));
    const result = await fileToDataUri("/path/to/favicon.ico");
    expect(result).toMatch(/^data:image\/x-icon;base64,/);
  });

  it("uses correct MIME type for BMP", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([66, 77]));
    const result = await fileToDataUri("/path/to/image.bmp");
    expect(result).toMatch(/^data:image\/bmp;base64,/);
  });

  it("uses correct MIME type for AVIF", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([0, 0, 0]));
    const result = await fileToDataUri("/path/to/image.avif");
    expect(result).toMatch(/^data:image\/avif;base64,/);
  });

  it("uses correct MIME type for JPEG extension", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([255, 216]));
    const result = await fileToDataUri("/path/to/photo.jpeg");
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });
});

// ---------------------------------------------------------------------------
// resolveResources
// ---------------------------------------------------------------------------
describe("resolveResources", () => {
  it("passes through HTML with no images", async () => {
    const html = "<p>Hello world</p>";
    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toBe(html);
    expect(report.resources).toHaveLength(0);
    expect(report.resolved).toHaveLength(0);
    expect(report.missing).toHaveLength(0);
    expect(report.totalSize).toBe(0);
  });

  it("keeps remote URLs as-is and marks as resolved", async () => {
    const html = '<img src="https://example.com/photo.png">';
    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toBe(html);
    expect(report.resources).toHaveLength(1);
    expect(report.resources[0].isRemote).toBe(true);
    expect(report.resources[0].found).toBe(true);
    expect(report.resolved).toHaveLength(1);
    expect(report.missing).toHaveLength(0);
  });

  it("replaces local images with data URIs in single mode", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toContain("data:image/png;base64,");
    expect(result).not.toContain("photo.png");
    expect(report.resolved).toHaveLength(1);
    expect(report.resolved[0].found).toBe(true);
  });

  it("replaces missing files with placeholder SVG", async () => {
    const html = '<img src="missing.png">';
    mockExists.mockResolvedValue(false);

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toContain("data:image/svg+xml");
    expect(result).toContain("Image not found");
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0].found).toBe(false);
  });

  it("copies images to assets folder in folder mode", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockImplementation(async (path: string) => {
      // images dir does not exist yet, file does
      if (path.includes("assets/images")) return false;
      return true;
    });
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5]));

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(result).toContain("assets/images/photo.png");
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockCopyFile).toHaveBeenCalled();
    expect(report.resolved).toHaveLength(1);
    expect(report.totalSize).toBe(5);
  });

  it("skips mkdir if images directory already exists", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    mockCopyFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2]));

    await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it("handles multiple images with mixed states", async () => {
    const html =
      '<img src="https://remote.com/a.png"><img src="local.png"><img src="missing.png">';
    let callCount = 0;
    mockExists.mockImplementation(async (path: string) => {
      if (path.includes("assets/images")) return true; // dir exists
      callCount++;
      // First local file exists, second doesn't
      return callCount === 1;
    });
    mockReadFile.mockResolvedValue(new Uint8Array([1]));

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    // remote + local found
    expect(report.resolved).toHaveLength(2);
    // missing.png not found
    expect(report.missing).toHaveLength(1);
    expect(report.resources).toHaveLength(3);
  });

  it("handles resolve error gracefully", async () => {
    const html = '<img src="bad.png">';
    mockExists.mockRejectedValue(new Error("Permission denied"));

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(report.missing).toHaveLength(1);
    expect(report.missing[0].found).toBe(false);
  });

  it("handles copy failure in folder mode gracefully", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    mockCopyFile.mockRejectedValue(new Error("Copy failed"));
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2]));

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    // File was found but copy failed — still in resolved since it exists
    expect(report.resolved).toHaveLength(1);
  });

  it("deduplicates filenames in folder mode to prevent overwrite", async () => {
    // Two different source images with the same basename
    const html =
      '<img src="chapter1/image.png"><img src="chapter2/image.png">';
    mockExists.mockImplementation(async (path: string) => {
      if (path.includes("assets/images")) return false; // dir doesn't exist
      return true; // source files exist
    });
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    // First image keeps original name, second gets deduplicated
    expect(result).toContain("assets/images/image.png");
    expect(result).toContain("assets/images/image-1.png");
    expect(report.resolved).toHaveLength(2);

    // Verify two different destinations were used
    const copyPaths = mockCopyFile.mock.calls.map(
      (call: unknown[]) => call[1],
    );
    expect(copyPaths).toContain("/output/assets/images/image.png");
    expect(copyPaths).toContain("/output/assets/images/image-1.png");
  });

  it("deduplicates filenames with multiple collisions", async () => {
    const html =
      '<img src="a/photo.jpg"><img src="b/photo.jpg"><img src="c/photo.jpg">';
    mockExists.mockImplementation(async (path: string) => {
      if (path.includes("assets/images")) return false;
      return true;
    });
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(new Uint8Array([1]));

    const { html: result } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(result).toContain("assets/images/photo.jpg");
    expect(result).toContain("assets/images/photo-1.jpg");
    expect(result).toContain("assets/images/photo-2.jpg");
  });

  it("deduplicates filenames without extension", async () => {
    const html = '<img src="a/icon"><img src="b/icon">';
    mockExists.mockImplementation(async (path: string) => {
      if (path.includes("assets/images")) return false;
      return true;
    });
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(new Uint8Array([1]));

    const { html: result } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(result).toContain("assets/images/icon");
    expect(result).toContain("assets/images/icon-1");
  });

  it("handles mkdir failure gracefully in folder mode", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockImplementation(async (path: string) => {
      if (path.includes("assets/images")) return false;
      return true;
    });
    mockMkdir.mockRejectedValue(new Error("Permission denied"));
    mockReadFile.mockResolvedValue(new Uint8Array([1]));

    // Should not throw — mkdir failure is logged and continued
    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(report.resources).toHaveLength(1);
  });

  it("keeps original src when fileToDataUri returns null in single mode", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    // First readFile (for data URI) fails, second (for size) also fails
    mockReadFile.mockRejectedValue(new Error("Read error"));

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    // The src should remain unchanged since data URI creation failed
    expect(result).toContain("photo.png");
    expect(report.resolved).toHaveLength(1);
  });

  it("skips image copy in folder mode when outputDir is not provided", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2]));

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      // no outputDir
    });

    expect(mockCopyFile).not.toHaveBeenCalled();
    expect(report.resolved).toHaveLength(1);
  });

  it("handles empty HTML", async () => {
    const { html: result, report } = await resolveResources("", {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toBe("");
    expect(report.resources).toHaveLength(0);
  });

  it("handles file size read failure silently", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    // First readFile call for data URI succeeds, second for size fails
    let callCount = 0;
    mockReadFile.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return new Uint8Array([1, 2, 3]);
      throw new Error("Read failed");
    });

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(report.resolved).toHaveLength(1);
    // Size unknown since second read failed
    expect(report.totalSize).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDocumentBaseDir
// ---------------------------------------------------------------------------
describe("getDocumentBaseDir", () => {
  it("returns dirname for a file path", async () => {
    const result = await getDocumentBaseDir("/Users/test/docs/file.md");
    expect(result).toBe("/Users/test/docs");
  });

  it("returns root for null file path", async () => {
    const result = await getDocumentBaseDir(null);
    expect(result).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------
describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  it("formats fractional kilobytes", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1048576)).toBe("1.0 MB");
  });

  it("formats fractional megabytes", () => {
    expect(formatFileSize(5242880)).toBe("5.0 MB");
  });

  it("formats just below KB threshold", () => {
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats exactly 1 KB", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("formats just below MB threshold", () => {
    const result = formatFileSize(1024 * 1024 - 1);
    expect(result).toMatch(/KB$/);
  });
});
