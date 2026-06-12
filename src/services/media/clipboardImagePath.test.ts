import { describe, it, expect, vi, beforeEach } from "vitest";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";

const mockReadText = vi.mocked(readText);
const mockExists = vi.mocked(exists);
const mockHomeDir = vi.mocked(homeDir);
const mockJoin = vi.mocked(join);

import {
  readClipboardImagePath,
} from "./clipboardImagePath";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: join just concatenates with "/"
  mockJoin.mockImplementation((...parts: string[]) =>
    Promise.resolve(parts.join("/"))
  );
  mockHomeDir.mockResolvedValue("/Users/test");
});

describe("readClipboardImagePath", () => {
  // ------- null / empty cases -------

  it("returns null when clipboard is empty", async () => {
    mockReadText.mockResolvedValue("");
    const result = await readClipboardImagePath();
    expect(result).toBeNull();
  });

  it("returns null when Tauri readText throws", async () => {
    mockReadText.mockRejectedValue(new Error("clipboard error"));
    const result = await readClipboardImagePath();
    expect(result).toBeNull();
  });

  it("returns null when clipboard has only whitespace", async () => {
    mockReadText.mockResolvedValue("   \n   ");
    const result = await readClipboardImagePath();
    // detectImagePath trims to empty → isImage: false
    expect(result).not.toBeNull();
    expect(result!.isImage).toBe(false);
  });

  // ------- non-image text -------

  it("returns isImage false for plain text", async () => {
    mockReadText.mockResolvedValue("hello world");
    const result = await readClipboardImagePath();
    expect(result).not.toBeNull();
    expect(result!.isImage).toBe(false);
    expect(result!.validated).toBe(false);
    expect(result!.resolvedPath).toBeNull();
  });

  it("returns isImage false for non-image URL", async () => {
    mockReadText.mockResolvedValue("https://example.com/page.html");
    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(false);
  });

  // ------- HTTP URL images -------

  it("detects HTTP URL image with validated true", async () => {
    mockReadText.mockResolvedValue("https://example.com/photo.png");
    const result = await readClipboardImagePath();
    expect(result).not.toBeNull();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("url");
    expect(result!.validated).toBe(true);
    expect(result!.resolvedPath).toBeNull();
    expect(result!.needsCopy).toBe(false);
  });

  it("detects HTTP URL image with query params", async () => {
    mockReadText.mockResolvedValue(
      "https://cdn.example.com/img.jpg?w=800&h=600"
    );
    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("url");
    expect(result!.validated).toBe(true);
  });

  // ------- data URL images -------

  it("detects data URL image with validated true", async () => {
    mockReadText.mockResolvedValue(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
    );
    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("dataUrl");
    expect(result!.validated).toBe(true);
    expect(result!.resolvedPath).toBeNull();
  });

  // ------- absolute path images -------

  it("detects absolute Unix path and validates existing file", async () => {
    mockReadText.mockResolvedValue("/Users/test/photo.png");
    mockExists.mockResolvedValue(true);

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("absolutePath");
    expect(result!.validated).toBe(true);
    expect(result!.resolvedPath).toBe("/Users/test/photo.png");
    expect(result!.needsCopy).toBe(true);
  });

  it("detects absolute Unix path and marks non-existent file as invalid", async () => {
    mockReadText.mockResolvedValue("/Users/test/missing.jpg");
    mockExists.mockResolvedValue(false);

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("absolutePath");
    expect(result!.validated).toBe(false);
    expect(result!.resolvedPath).toBeNull();
  });

  it("handles exists() throwing for absolute path", async () => {
    mockReadText.mockResolvedValue("/Users/test/photo.png");
    mockExists.mockRejectedValue(new Error("fs error"));

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.validated).toBe(false);
    expect(result!.resolvedPath).toBeNull();
  });

  // ------- home path images -------

  it("detects home path, expands and validates", async () => {
    mockReadText.mockResolvedValue("~/Pictures/photo.png");
    mockHomeDir.mockResolvedValue("/Users/test");
    mockJoin.mockImplementation((...parts: string[]) =>
      Promise.resolve(parts.join("/"))
    );
    mockExists.mockResolvedValue(true);

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("homePath");
    expect(result!.validated).toBe(true);
    expect(result!.resolvedPath).toBe("/Users/test/Pictures/photo.png");
  });

  it("detects home path with non-existent file", async () => {
    mockReadText.mockResolvedValue("~/Desktop/missing.webp");
    mockHomeDir.mockResolvedValue("/Users/test");
    mockJoin.mockImplementation((...parts: string[]) =>
      Promise.resolve(parts.join("/"))
    );
    mockExists.mockResolvedValue(false);

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("homePath");
    expect(result!.validated).toBe(false);
    expect(result!.resolvedPath).toBeNull();
  });

  it("handles homeDir() throwing", async () => {
    mockReadText.mockResolvedValue("~/Pictures/photo.png");
    mockHomeDir.mockRejectedValue(new Error("no home dir"));

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("homePath");
    expect(result!.validated).toBe(false);
    expect(result!.resolvedPath).toBeNull();
  });

  // ------- relative path images -------

  it("detects relative path with validated true (no filesystem check)", async () => {
    mockReadText.mockResolvedValue("./assets/images/photo.png");
    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("relativePath");
    expect(result!.validated).toBe(true);
    expect(result!.resolvedPath).toBeNull();
    expect(result!.needsCopy).toBe(false);
    // Should NOT call exists — no filesystem validation for relative paths
    expect(mockExists).not.toHaveBeenCalled();
  });

  it("detects parent-relative path", async () => {
    mockReadText.mockResolvedValue("../images/photo.jpg");
    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("relativePath");
    expect(result!.validated).toBe(true);
  });

  // ------- multi-line clipboard -------

  it("uses only the first line of multi-line clipboard", async () => {
    mockReadText.mockResolvedValue(
      "https://example.com/photo.png\nsome other text"
    );
    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("url");
    expect(result!.path).toBe("https://example.com/photo.png");
  });

  // ------- web clipboard fallback -------

  it("falls back to navigator.clipboard when Tauri returns empty", async () => {
    mockReadText.mockResolvedValue("");

    // Mock navigator.clipboard
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          readText: vi.fn().mockResolvedValue("https://example.com/img.svg"),
        },
      },
      writable: true,
      configurable: true,
    });

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("url");

    // Restore
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("returns null when both Tauri and web clipboard return empty", async () => {
    mockReadText.mockResolvedValue("");

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          readText: vi.fn().mockResolvedValue(""),
        },
      },
      writable: true,
      configurable: true,
    });

    const result = await readClipboardImagePath();
    expect(result).toBeNull();

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("returns null when web clipboard throws permission error", async () => {
    mockReadText.mockResolvedValue("");

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          readText: vi.fn().mockRejectedValue(new Error("permission denied")),
        },
      },
      writable: true,
      configurable: true,
    });

    const result = await readClipboardImagePath();
    expect(result).toBeNull();

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  // ------- supported image extensions -------

  it.each([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"])(
    "detects %s extension as image",
    async (ext) => {
      mockReadText.mockResolvedValue(`https://example.com/image${ext}`);
      const result = await readClipboardImagePath();
      expect(result!.isImage).toBe(true);
    }
  );

  // ------- file:// URL -------

  it("detects file:// URL as absolute path", async () => {
    mockReadText.mockResolvedValue("file:///Users/test/photo.png");
    mockExists.mockResolvedValue(true);

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("absolutePath");
    expect(result!.validated).toBe(true);
  });

  // ------- Windows path -------

  it("detects Windows absolute path", async () => {
    mockReadText.mockResolvedValue("C:\\Users\\test\\photo.png");
    mockExists.mockResolvedValue(true);

    const result = await readClipboardImagePath();
    expect(result!.isImage).toBe(true);
    expect(result!.type).toBe("absolutePath");
  });
});

