/**
 * Tests for imageHandlerUtils — file URL conversion, image detection,
 * filename generation, and view checking.
 */

import { describe, it, expect, vi } from "vitest";

// Mock external dependencies
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(),
}));

vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));

let mockActiveFilePath: string | null = null;
import { getWindowLabel } from "@/services/navigation/windowFocus";

vi.mock("@/plugins/shared/hostDocument", () => ({
  hostDocument: { activeFilePath: () => mockActiveFilePath },
  // The guarded convenience over activeFilePath; same answer here.
  activeFilePathForCurrentWindow: () => mockActiveFilePath,
}));

vi.mock("@/utils/imagePathDetection", () => ({
  hasImageExtension: vi.fn((name: string) =>
    /\.(png|jpe?g|gif|svg|webp|bmp|ico|tiff?)$/i.test(name)
  ),
}));

vi.mock("@/utils/debug", () => ({
  imageHandlerWarn: vi.fn(),
}));

import {
  fileUrlToPath,
  isViewConnected,
  getActiveFilePathForCurrentWindow,
  isImageFile,
  generateClipboardImageFilename,
  generateDroppedImageFilename,
  getToastAnchorRect,
} from "./imageHandlerUtils";

describe("fileUrlToPath", () => {
  it("converts Unix file URL", () => {
    expect(fileUrlToPath("file:///Users/name/file.png")).toBe(
      "/Users/name/file.png"
    );
  });

  it("converts Windows file URL", () => {
    expect(fileUrlToPath("file:///C:/Users/name/file.png")).toBe(
      "C:/Users/name/file.png"
    );
  });

  it("decodes URL-encoded characters", () => {
    expect(fileUrlToPath("file:///Users/name/my%20file.png")).toBe(
      "/Users/name/my file.png"
    );
  });

  it("handles URL with special characters", () => {
    expect(fileUrlToPath("file:///Users/name/%E4%BD%A0%E5%A5%BD.png")).toBe(
      "/Users/name/你好.png"
    );
  });

  it("handles file URL without triple slash", () => {
    expect(fileUrlToPath("file://path/file.png")).toBe("path/file.png");
  });

  it("handles Windows drive letter D:", () => {
    expect(fileUrlToPath("file:///D:/folder/image.jpg")).toBe(
      "D:/folder/image.jpg"
    );
  });

  it("preserves Unix path without drive letter", () => {
    expect(fileUrlToPath("file:///home/user/pic.png")).toBe(
      "/home/user/pic.png"
    );
  });
});

describe("isViewConnected", () => {
  it("returns true when dom is connected", () => {
    const view = {
      dom: { isConnected: true },
    } as never;
    expect(isViewConnected(view)).toBe(true);
  });

  it("returns false when dom is not connected", () => {
    const view = {
      dom: { isConnected: false },
    } as never;
    expect(isViewConnected(view)).toBe(false);
  });

  it("returns false when dom is null", () => {
    const view = { dom: null } as never;
    expect(isViewConnected(view)).toBe(false);
  });

  it("returns false on error", () => {
    const view = {
      get dom() {
        throw new Error("destroyed");
      },
    } as never;
    expect(isViewConnected(view)).toBe(false);
  });
});

describe("showUnsavedDocWarning", () => {
  it("calls message with warning", async () => {
    const { showUnsavedDocWarning } = await import("./imageHandlerUtils");
    const { message: dialogMessage } = await import("@tauri-apps/plugin-dialog");
    await showUnsavedDocWarning();
    expect(dialogMessage).toHaveBeenCalledWith(
      expect.stringContaining("save the document first"),
      expect.objectContaining({ kind: "warning" }),
    );
  });
});

describe("getActiveFilePathForCurrentWindow", () => {
  it("returns null when no active tab", () => {
    expect(getActiveFilePathForCurrentWindow()).toBeNull();
  });

  it("returns the active document's path", () => {
    mockActiveFilePath = "/docs/test.md";
    expect(getActiveFilePathForCurrentWindow()).toBe("/docs/test.md");
    mockActiveFilePath = null;
  });

  it("returns null and logs a warning when the lookup throws", () => {
    // `getWindowLabel` throws outside a Tauri context; the guard is what
    // keeps a paste from failing there rather than resolving to no path.
    vi.mocked(getWindowLabel).mockImplementationOnce(() => {
      throw new Error("no window");
    });
    expect(getActiveFilePathForCurrentWindow()).toBeNull();
  });

  it("returns null when the active document has no path yet", () => {
    // An untitled buffer. Distinct from "no tab" only in the host; from here
    // both are the same null.
    mockActiveFilePath = null;
    expect(getActiveFilePathForCurrentWindow()).toBeNull();
  });
});

describe("validateLocalPath", () => {
  it("returns true when exists() returns true", async () => {
    const { validateLocalPath } = await import("./imageHandlerUtils");
    const { exists } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValueOnce(true);
    const result = await validateLocalPath("/valid/path.png");
    expect(result).toBe(true);
  });

  it("returns false when exists() throws", async () => {
    const { validateLocalPath } = await import("./imageHandlerUtils");
    const { exists } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockRejectedValueOnce(new Error("fs error"));
    const result = await validateLocalPath("/bad/path");
    expect(result).toBe(false);
  });
});

describe("expandHomePath", () => {
  it("returns path unchanged when not starting with ~/", async () => {
    const { expandHomePath } = await import("./imageHandlerUtils");
    const result = await expandHomePath("/absolute/path.md");
    expect(result).toBe("/absolute/path.md");
  });

  it("expands ~/ path using homeDir and join (line 96)", async () => {
    const { expandHomePath } = await import("./imageHandlerUtils");
    const result = await expandHomePath("~/Documents/file.md");
    expect(result).toBe("/Users/test/Documents/file.md");
  });

  it("returns null when homeDir throws for ~/ path", async () => {
    const { expandHomePath } = await import("./imageHandlerUtils");
    const pathMod = await import("@tauri-apps/api/path");
    vi.mocked(pathMod.homeDir).mockRejectedValueOnce(new Error("no home"));
    const result = await expandHomePath("~/Documents/file.md");
    expect(result).toBeNull();
  });
});

describe("isImageFile", () => {
  it("returns true for image MIME type", () => {
    const file = new File([""], "photo.jpg", { type: "image/jpeg" });
    expect(isImageFile(file)).toBe(true);
  });

  it("returns true for image/png MIME type", () => {
    const file = new File([""], "photo.png", { type: "image/png" });
    expect(isImageFile(file)).toBe(true);
  });

  it("returns true for image/gif MIME type", () => {
    const file = new File([""], "anim.gif", { type: "image/gif" });
    expect(isImageFile(file)).toBe(true);
  });

  it("returns true for file with image extension but no MIME", () => {
    const file = new File([""], "photo.webp", { type: "" });
    expect(isImageFile(file)).toBe(true);
  });

  it("returns false for non-image file", () => {
    const file = new File([""], "doc.pdf", { type: "application/pdf" });
    expect(isImageFile(file)).toBe(false);
  });

  it("returns false for text file", () => {
    const file = new File([""], "readme.txt", { type: "text/plain" });
    expect(isImageFile(file)).toBe(false);
  });

  it("detects .svg extension", () => {
    const file = new File([""], "icon.svg", { type: "" });
    expect(isImageFile(file)).toBe(true);
  });

  it("detects .bmp extension", () => {
    const file = new File([""], "image.bmp", { type: "" });
    expect(isImageFile(file)).toBe(true);
  });
});

describe("generateClipboardImageFilename", () => {
  it("generates filename with extension from original", () => {
    const name = generateClipboardImageFilename("screenshot.jpg");
    expect(name).toMatch(/^clipboard-\d+-[a-z0-9]+\.jpg$/);
  });

  it("defaults to png when no extension", () => {
    const name = generateClipboardImageFilename("image");
    expect(name).toMatch(/^clipboard-\d+-[a-z0-9]+\.png$/);
  });

  it("generates unique filenames", () => {
    const name1 = generateClipboardImageFilename("a.png");
    const name2 = generateClipboardImageFilename("a.png");
    expect(name1).not.toBe(name2);
  });

  it("handles webp extension", () => {
    const name = generateClipboardImageFilename("photo.webp");
    expect(name).toMatch(/\.webp$/);
  });
});

describe("generateDroppedImageFilename", () => {
  it("preserves base name from original", () => {
    const name = generateDroppedImageFilename("photo.jpg");
    expect(name).toMatch(/^photo-\d+-[a-z0-9]+\.jpg$/);
  });

  it("defaults to png when no extension", () => {
    const name = generateDroppedImageFilename("image");
    expect(name).toMatch(/^image-\d+-[a-z0-9]+\.png$/);
  });

  it("generates unique filenames", () => {
    const name1 = generateDroppedImageFilename("test.png");
    const name2 = generateDroppedImageFilename("test.png");
    expect(name1).not.toBe(name2);
  });

  it("handles filename with multiple dots", () => {
    const name = generateDroppedImageFilename("my.file.name.png");
    expect(name).toMatch(/^my\.file\.name-\d+-[a-z0-9]+\.png$/);
  });

  it("handles filename with spaces", () => {
    const name = generateDroppedImageFilename("my photo.jpg");
    expect(name).toMatch(/^my photo-\d+-[a-z0-9]+\.jpg$/);
  });
});

describe("getToastAnchorRect", () => {
  it("returns viewport center on error", () => {
    const view = {
      state: { selection: { from: 0 } },
      coordsAtPos: () => {
        throw new Error("invalid");
      },
    } as never;
    const rect = getToastAnchorRect(view);
    expect(rect).toHaveProperty("top");
    expect(rect).toHaveProperty("left");
    expect(rect).toHaveProperty("bottom");
    expect(rect).toHaveProperty("right");
  });

  it("returns coords from view when available", () => {
    const view = {
      state: { selection: { from: 5 } },
      coordsAtPos: () => ({ top: 100, left: 200, bottom: 120, right: 210 }),
    } as never;
    const rect = getToastAnchorRect(view);
    expect(rect.top).toBe(100);
    expect(rect.left).toBe(200);
    expect(rect.bottom).toBe(120);
    expect(rect.right).toBe(210);
  });
});
