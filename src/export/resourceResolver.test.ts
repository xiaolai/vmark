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
const mockStat = vi.fn();
const mockLstat = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
  exists: (...args: unknown[]) => mockExists(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  lstat: (...args: unknown[]) => mockLstat(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
  dirname: vi.fn((path: string) =>
    Promise.resolve(path.split("/").slice(0, -1).join("/") || "/"),
  ),
  basename: vi.fn((path: string) =>
    Promise.resolve(path.split("/").pop() || ""),
  ),
  normalize: vi.fn((path: string) => {
    // Tauri-like normalization: resolves "." and ".." but PRESERVES leading
    // "//" (POSIX allows implementation-defined meaning for paths starting
    // with exactly two slashes; Tauri does not collapse them). Also respects
    // paths without any leading slash (e.g. Windows "C:/..." drive paths).
    const leadingSlashes = path.match(/^\/+/)?.[0] ?? "";
    const rest = path.slice(leadingSlashes.length);
    const parts = rest.split("/");
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        normalized.pop();
      } else if (part !== "." && part !== "") {
        normalized.push(part);
      }
    }
    // Preserve leading slashes as-is (none / single / double), collapse 3+ to //
    const prefix =
      leadingSlashes.length === 0
        ? ""
        : leadingSlashes.length >= 2
          ? "//"
          : "/";
    return Promise.resolve(prefix + normalized.join("/"));
  }),
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
  extractImageSources,
  fileToDataUri,
  resolveResources,
  formatFileSize,
} from "./resourceResolver";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: files are not symlinks
  mockLstat.mockResolvedValue({ isSymlink: false });
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

  it("extracts src containing apostrophe in double-quoted attribute", () => {
    const html = `<img src="asset://localhost/%2FUsers%2Fjoker%2FWriter's%20Office%2Fimages%2Fcover.png" alt="Cover">`;
    expect(extractImageSources(html)).toEqual([
      "asset://localhost/%2FUsers%2Fjoker%2FWriter's%20Office%2Fimages%2Fcover.png",
    ]);
  });

  it("extracts src containing double quote in single-quoted attribute", () => {
    const html = `<img src='path/with&quot;quote/file.png' alt='test'>`;
    expect(extractImageSources(html)).toEqual([`path/with&quot;quote/file.png`]);
  });
});

// ---------------------------------------------------------------------------
// fileToDataUri
// ---------------------------------------------------------------------------
describe("fileToDataUri", () => {
  it("converts a PNG file to data URI with size", async () => {
    const fakeData = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    mockReadFile.mockResolvedValue(fakeData);

    const result = await fileToDataUri("/path/to/image.png");
    expect(result).not.toBeNull();
    expect(result!.dataUri).toMatch(/^data:image\/png;base64,/);
    expect(result!.size).toBe(4);
    expect(mockReadFile).toHaveBeenCalledWith("/path/to/image.png");
  });

  it("uses correct MIME type for JPEG", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([255, 216]));
    const result = await fileToDataUri("/path/to/photo.jpg");
    expect(result!.dataUri).toMatch(/^data:image\/jpeg;base64,/);
    expect(result!.size).toBe(2);
  });

  it("uses correct MIME type for SVG", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([60, 115, 118, 103]));
    const result = await fileToDataUri("/path/to/icon.svg");
    expect(result!.dataUri).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("uses correct MIME type for GIF", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([71, 73, 70]));
    const result = await fileToDataUri("/path/to/anim.gif");
    expect(result!.dataUri).toMatch(/^data:image\/gif;base64,/);
  });

  it("uses correct MIME type for WebP", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([82, 73, 70, 70]));
    const result = await fileToDataUri("/path/to/image.webp");
    expect(result!.dataUri).toMatch(/^data:image\/webp;base64,/);
  });

  it("falls back to application/octet-stream for unknown extensions", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([0, 1, 2]));
    const result = await fileToDataUri("/path/to/file.xyz");
    expect(result!.dataUri).toMatch(/^data:application\/octet-stream;base64,/);
  });

  it("returns null when file read fails", async () => {
    mockReadFile.mockRejectedValue(new Error("File not found"));
    const result = await fileToDataUri("/nonexistent/file.png");
    expect(result).toBeNull();
  });

  it("handles files with no extension", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([0]));
    const result = await fileToDataUri("/path/to/noext");
    expect(result!.dataUri).toMatch(/^data:application\/octet-stream;base64,/);
  });

  it("uses correct MIME type for ICO", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([0, 0, 1, 0]));
    const result = await fileToDataUri("/path/to/favicon.ico");
    expect(result!.dataUri).toMatch(/^data:image\/x-icon;base64,/);
  });

  it("uses correct MIME type for BMP", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([66, 77]));
    const result = await fileToDataUri("/path/to/image.bmp");
    expect(result!.dataUri).toMatch(/^data:image\/bmp;base64,/);
  });

  it("uses correct MIME type for AVIF", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([0, 0, 0]));
    const result = await fileToDataUri("/path/to/image.avif");
    expect(result!.dataUri).toMatch(/^data:image\/avif;base64,/);
  });

  it("uses correct MIME type for JPEG extension", async () => {
    mockReadFile.mockResolvedValue(new Uint8Array([255, 216]));
    const result = await fileToDataUri("/path/to/photo.jpeg");
    expect(result!.dataUri).toMatch(/^data:image\/jpeg;base64,/);
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

  // Regression for issue #907: in single mode, a successful exists() check
  // followed by a readFile() failure (permission denied, EIO, locked file,
  // etc.) used to leave the original asset:// URL untouched in the exported
  // HTML — invisible to the user inside VMark, broken everywhere else. The
  // fix mirrors the folder-mode copy-fail branch and substitutes the missing
  // image placeholder so the asset is correctly routed into report.missing.
  it("replaces unreadable files with placeholder SVG in single mode", async () => {
    const html = '<img src="locked.png">';
    mockExists.mockResolvedValue(true);
    mockReadFile.mockRejectedValue(new Error("EACCES: permission denied"));

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toContain("data:image/svg+xml");
    expect(result).not.toContain("locked.png");
    expect(result).not.toContain("asset://");
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0].found).toBe(false);
    expect(report.resolved).toHaveLength(0);
  });

  // Regression for issue #1086: on newer macOS/WebKit (and on Windows),
  // Tauri's convertFileSrc() emits the asset protocol as
  // `https://asset.localhost/…`. That superficially matches isRemoteUrl()'s
  // https check, so resolveResources used to classify it as a remote URL and
  // pass it through untouched — leaving an unreachable https URL in the
  // print/PDF HTML that the off-screen WKWebView (no asset:// handler) cannot
  // load, which surfaced as a missing image even though the editor rendered it
  // fine. Asset URLs must be inlined as data URIs regardless of their scheme.
  it("inlines https://asset.localhost/ asset URLs as data URIs in single mode", async () => {
    const src = `https://asset.localhost/${encodeURIComponent("/docs/evidence/page-1.png")}`;
    const html = `<img src="${src}">`;
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toContain("data:image/png;base64,");
    expect(result).not.toContain("asset.localhost");
    expect(report.resolved).toHaveLength(1);
    expect(report.resolved[0].isRemote).toBe(false);
    expect(report.resolved[0].found).toBe(true);
    expect(report.missing).toHaveLength(0);
  });

  it("inlines http://asset.localhost/ (Windows) asset URLs as data URIs in single mode", async () => {
    const src = `http://asset.localhost/${encodeURIComponent("/docs/evidence/page-1.png")}`;
    const html = `<img src="${src}">`;
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toContain("data:image/png;base64,");
    expect(result).not.toContain("asset.localhost");
    expect(report.resolved).toHaveLength(1);
    expect(report.resolved[0].isRemote).toBe(false);
  });

  it("inlines asset://localhost/ asset URLs as data URIs in single mode", async () => {
    const src = `asset://localhost/${encodeURIComponent("/docs/evidence/page-1.png")}`;
    const html = `<img src="${src}">`;
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(result).toContain("data:image/png;base64,");
    expect(result).not.toContain("asset://");
    expect(report.resolved).toHaveLength(1);
    expect(report.resolved[0].isRemote).toBe(false);
  });

  it("copies https://asset.localhost/ asset URLs to assets folder in folder mode", async () => {
    const src = `https://asset.localhost/${encodeURIComponent("/docs/page.png")}`;
    const html = `<img src="${src}">`;
    mockExists.mockImplementation(async (path: string) => {
      if (path.includes("assets/images")) return false;
      return true;
    });
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 7 });

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(result).toContain("assets/images/page.png");
    expect(result).not.toContain("asset.localhost");
    expect(mockCopyFile).toHaveBeenCalled();
    expect(report.resolved).toHaveLength(1);
    expect(report.resolved[0].isRemote).toBe(false);
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
    mockStat.mockResolvedValue({ size: 5 });

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
    mockStat.mockResolvedValue({ size: 2 });

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

  it("handles copy failure in folder mode by marking resource as missing", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    mockCopyFile.mockRejectedValue(new Error("Copy failed"));
    mockStat.mockResolvedValue({ size: 2 });

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    // Copy failed — resource should be marked as missing with placeholder
    expect(report.resolved).toHaveLength(0);
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0].found).toBe(false);
    // Original src replaced with placeholder (not left as broken Tauri URL)
    expect(result).not.toContain("photo.png");
    expect(result).toContain("data:image/svg+xml");
    expect(result).not.toContain("assets/images/");
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
    mockStat.mockResolvedValue({ size: 1 });

    // Should not throw — mkdir failure is logged and continued
    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(report.resources).toHaveLength(1);
  });

  it("skips image copy in folder mode when outputDir is not provided", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      // no outputDir — no copy, no stat
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

  it("gets size from fileToDataUri in single mode without extra read", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(report.resolved).toHaveLength(1);
    // Size comes from the same readFile call inside fileToDataUri
    expect(report.totalSize).toBe(3);
    expect(report.resolved[0].size).toBe(3);
    // readFile should only be called once (inside fileToDataUri)
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("treats path-traversal images as missing", async () => {
    const html = '<img src="../../.ssh/id_rsa">';
    const { report } = await resolveResources(html, {
      baseDir: "/Users/test/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(report.missing).toHaveLength(1);
    expect(report.resolved).toHaveLength(0);
    expect(mockCopyFile).not.toHaveBeenCalled();
  });

  it("substitutes placeholder for traversal-blocked asset:// images in exported HTML", async () => {
    // asset://localhost URLs that resolve outside baseDir must not survive into
    // exported HTML — they have no meaning outside VMark and render broken.
    const evilSrc = `asset://localhost/${encodeURIComponent("/etc/passwd")}`;
    const html = `<img src="${evilSrc}">`;

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/Users/test/docs",
      mode: "single",
    });

    expect(report.missing).toHaveLength(1);
    expect(report.resolved).toHaveLength(0);
    // Original asset:// URL must be gone from exported HTML
    expect(result).not.toContain("asset://localhost");
    expect(result).not.toContain(evilSrc);
    // Placeholder must be present
    expect(result).toContain("data:image/svg+xml");
    expect(result).toContain("Image not found");
  });

  it("blocks symlinks to prevent traversal", async () => {
    const html = '<img src="evil.png">';
    mockExists.mockResolvedValue(true);
    mockLstat.mockResolvedValue({ isSymlink: true });

    const { html: result, report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(report.missing).toHaveLength(1);
    expect(report.resolved).toHaveLength(0);
    expect(mockReadFile).not.toHaveBeenCalled();
    // Symlink-blocked images must be replaced with the placeholder so the
    // exported HTML doesn't carry an unresolvable internal src.
    expect(result).not.toContain('src="evil.png"');
    expect(result).toContain("data:image/svg+xml");
    expect(result).toContain("Image not found");
  });

  it("blocks symlinks in folder mode without copying", async () => {
    const html = '<img src="evil.png">';
    mockExists.mockResolvedValue(true);
    mockLstat.mockResolvedValue({ isSymlink: true });

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(report.missing).toHaveLength(1);
    expect(report.resolved).toHaveLength(0);
    expect(mockCopyFile).not.toHaveBeenCalled();
  });

  it("treats lstat failure as inaccessible", async () => {
    const html = '<img src="broken.png">';
    mockExists.mockResolvedValue(true);
    mockLstat.mockRejectedValue(new Error("Permission denied"));

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "single",
    });

    expect(report.missing).toHaveLength(1);
    expect(report.resolved).toHaveLength(0);
  });

  it("handles stat failure silently in folder mode", async () => {
    const html = '<img src="photo.png">';
    mockExists.mockResolvedValue(true);
    mockCopyFile.mockResolvedValue(undefined);
    mockStat.mockRejectedValue(new Error("Stat failed"));

    const { report } = await resolveResources(html, {
      baseDir: "/docs",
      mode: "folder",
      outputDir: "/output",
    });

    expect(report.resolved).toHaveLength(1);
    // Size unknown since stat failed
    expect(report.totalSize).toBe(0);
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
