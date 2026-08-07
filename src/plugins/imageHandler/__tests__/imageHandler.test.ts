// @vitest-environment node
/**
 * Tests for imageHandler plugin — pure/mockable functions.
 *
 * Covers:
 *   - fileUrlToPath (pure string transform)
 *   - validateLocalPath (mocked Tauri fs)
 *   - expandHomePath (mocked Tauri path)
 *   - isViewConnected (mock EditorView)
 *   - isImageFile (MIME + extension fallback)
 *   - generateDroppedImageFilename (name generation)
 *   - generateClipboardImageFilename (name generation)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (must be before imports) ---

const mockExists = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...args: unknown[]) => mockExists(...args),
}));

const mockHomeDir = vi.fn(() => Promise.resolve("/Users/test"));
const mockJoin = vi.fn((...parts: string[]) => Promise.resolve(parts.join("/")));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: () => mockHomeDir(),
  join: (...args: string[]) => mockJoin(...args),
}));

vi.mock("@/utils/imagePathDetection", () => ({
  hasImageExtension: (name: string) => {
    const exts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".avif"];
    const clean = name.toLowerCase().split("?")[0].split("#")[0];
    return exts.some((ext) => clean.endsWith(ext));
  },
}));

// --- Imports (after mocks) ---

import {
  fileUrlToPath,
  validateLocalPath,
  expandHomePath,
  isViewConnected,
  isImageFile,
  generateClipboardImageFilename,
  generateDroppedImageFilename,
} from "../imageHandlerUtils";

// ============================================================
// fileUrlToPath — pure string transform
// ============================================================

describe("fileUrlToPath", () => {
  it.each([
    // Unix paths
    { input: "file:///Users/name/file.png", expected: "/Users/name/file.png" },
    { input: "file:///tmp/image.jpg", expected: "/tmp/image.jpg" },
    // Windows paths — drive letter after file:///
    { input: "file:///C:/Users/name/file.png", expected: "C:/Users/name/file.png" },
    { input: "file:///D:/photos/img.jpg", expected: "D:/photos/img.jpg" },
    // URL-encoded characters
    { input: "file:///Users/name/my%20file.png", expected: "/Users/name/my file.png" },
    { input: "file:///Users/%E4%B8%AD%E6%96%87/pic.png", expected: "/Users/\u4E2D\u6587/pic.png" },
    // URL-encoded + Windows
    { input: "file:///C:/My%20Docs/photo.png", expected: "C:/My Docs/photo.png" },
    // Special characters
    { input: "file:///Users/name/file%23hash.png", expected: "/Users/name/file#hash.png" },
    { input: "file:///Users/name/file%26amp.png", expected: "/Users/name/file&amp.png" },
  ])("converts $input -> $expected", ({ input, expected }) => {
    expect(fileUrlToPath(input)).toBe(expected);
  });

  it("handles empty prefix (no file://)", () => {
    // If there's no file:// prefix, decodeURIComponent still runs
    expect(fileUrlToPath("/Users/name/file.png")).toBe("/Users/name/file.png");
  });

  it("handles lowercase drive letters on Windows", () => {
    expect(fileUrlToPath("file:///c:/test/img.png")).toBe("c:/test/img.png");
  });
});

// ============================================================
// validateLocalPath — mocked Tauri fs.exists
// ============================================================

describe("validateLocalPath", () => {
  beforeEach(() => {
    mockExists.mockReset();
  });

  it("returns true when file exists", async () => {
    mockExists.mockResolvedValue(true);
    expect(await validateLocalPath("/Users/test/image.png")).toBe(true);
    expect(mockExists).toHaveBeenCalledWith("/Users/test/image.png");
  });

  it("returns false when file does not exist", async () => {
    mockExists.mockResolvedValue(false);
    expect(await validateLocalPath("/nonexistent/path.png")).toBe(false);
  });

  it("returns false when exists() throws", async () => {
    mockExists.mockRejectedValue(new Error("Permission denied"));
    expect(await validateLocalPath("/restricted/file.png")).toBe(false);
  });

  it("handles empty path", async () => {
    mockExists.mockResolvedValue(false);
    expect(await validateLocalPath("")).toBe(false);
  });
});

// ============================================================
// expandHomePath — mocked Tauri path APIs
// ============================================================

describe("expandHomePath", () => {
  beforeEach(() => {
    mockHomeDir.mockReset();
    mockJoin.mockReset();
    mockHomeDir.mockResolvedValue("/Users/test");
    mockJoin.mockImplementation((...parts: string[]) => Promise.resolve(parts.join("/")));
  });

  it("expands ~/path to absolute path", async () => {
    const result = await expandHomePath("~/Documents/image.png");
    expect(result).toBe("/Users/test/Documents/image.png");
    expect(mockHomeDir).toHaveBeenCalled();
    expect(mockJoin).toHaveBeenCalledWith("/Users/test", "Documents/image.png");
  });

  it("returns path unchanged if it does not start with ~/", async () => {
    expect(await expandHomePath("/absolute/path.png")).toBe("/absolute/path.png");
    expect(await expandHomePath("relative/path.png")).toBe("relative/path.png");
    expect(await expandHomePath("")).toBe("");
    expect(mockHomeDir).not.toHaveBeenCalled();
  });

  it("returns null when homeDir() throws", async () => {
    mockHomeDir.mockRejectedValue(new Error("No home dir"));
    expect(await expandHomePath("~/file.png")).toBeNull();
  });

  it("handles ~/file (no subdirectory)", async () => {
    const result = await expandHomePath("~/file.png");
    expect(result).toBe("/Users/test/file.png");
    expect(mockJoin).toHaveBeenCalledWith("/Users/test", "file.png");
  });

  it("handles ~/ alone (trailing slash, empty remainder)", async () => {
    const result = await expandHomePath("~/");
    expect(result).toBe("/Users/test/");
    expect(mockJoin).toHaveBeenCalledWith("/Users/test", "");
  });
});

// ============================================================
// isViewConnected — mock EditorView
// ============================================================

describe("isViewConnected", () => {
  it("returns true when dom.isConnected is true", () => {
    const mockView = { dom: { isConnected: true } } as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(mockView)).toBe(true);
  });

  it("returns false when dom.isConnected is false", () => {
    const mockView = { dom: { isConnected: false } } as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(mockView)).toBe(false);
  });

  it("returns false when dom is null", () => {
    const mockView = { dom: null } as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(mockView)).toBe(false);
  });

  it("returns false when dom is undefined", () => {
    const mockView = {} as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(mockView)).toBe(false);
  });

  it("returns false when accessing dom throws", () => {
    const mockView = {
      get dom(): never {
        throw new Error("View destroyed");
      },
    } as unknown as import("@tiptap/pm/view").EditorView;
    expect(isViewConnected(mockView)).toBe(false);
  });
});

// ============================================================
// isImageFile — MIME type + extension fallback
// ============================================================

describe("isImageFile", () => {
  it.each([
    // MIME type detection
    { type: "image/png", name: "test.png", expected: true },
    { type: "image/jpeg", name: "photo.jpg", expected: true },
    { type: "image/webp", name: "img.webp", expected: true },
    { type: "image/svg+xml", name: "icon.svg", expected: true },
    { type: "image/gif", name: "animation.gif", expected: true },
    // Non-image MIME but image extension
    { type: "application/octet-stream", name: "photo.jpg", expected: true },
    { type: "", name: "screenshot.png", expected: true },
    // Non-image file
    { type: "text/plain", name: "readme.txt", expected: false },
    { type: "application/pdf", name: "doc.pdf", expected: false },
    { type: "", name: "file.zip", expected: false },
  ])("$name (type=$type) -> $expected", ({ type, name, expected }) => {
    const file = new File([""], name, { type });
    expect(isImageFile(file)).toBe(expected);
  });
});

// ============================================================
// generateDroppedImageFilename — name generation
// ============================================================

describe("generateDroppedImageFilename", () => {
  it("preserves original extension", () => {
    const result = generateDroppedImageFilename("photo.jpg");
    expect(result).toMatch(/^photo-\d+-[a-z0-9]{4}\.jpg$/);
  });

  it("preserves base name", () => {
    const result = generateDroppedImageFilename("my-screenshot.png");
    expect(result).toMatch(/^my-screenshot-\d+-[a-z0-9]{4}\.png$/);
  });

  it("defaults to png when no extension", () => {
    const result = generateDroppedImageFilename("image");
    expect(result).toMatch(/^image-\d+-[a-z0-9]{4}\.png$/);
  });

  it("handles filename with multiple dots", () => {
    const result = generateDroppedImageFilename("my.photo.v2.png");
    expect(result).toMatch(/^my\.photo\.v2-\d+-[a-z0-9]{4}\.png$/);
  });

  it("generates unique filenames on successive calls", () => {
    const a = generateDroppedImageFilename("test.png");
    const b = generateDroppedImageFilename("test.png");
    expect(a).not.toBe(b);
  });
});

// ============================================================
// generateClipboardImageFilename — name generation
// ============================================================

describe("generateClipboardImageFilename", () => {
  it("generates clipboard-prefixed filename", () => {
    const result = generateClipboardImageFilename("image.png");
    expect(result).toMatch(/^clipboard-\d+-[a-z0-9]{4}\.png$/);
  });

  it("preserves original extension", () => {
    const result = generateClipboardImageFilename("photo.webp");
    expect(result).toMatch(/\.webp$/);
  });

  it("defaults to png when no extension", () => {
    const result = generateClipboardImageFilename("image");
    expect(result).toMatch(/^clipboard-\d+-[a-z0-9]{4}\.png$/);
  });

  it("generates unique filenames", () => {
    const a = generateClipboardImageFilename("img.png");
    const b = generateClipboardImageFilename("img.png");
    expect(a).not.toBe(b);
  });

  it("handles empty string", () => {
    const result = generateClipboardImageFilename("");
    expect(result).toMatch(/^clipboard-\d+-[a-z0-9]{4}\.png$/);
  });
});
