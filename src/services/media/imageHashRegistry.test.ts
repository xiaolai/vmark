import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";

const mockExists = vi.mocked(exists);
const mockReadTextFile = vi.mocked(readTextFile);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockDirname = vi.mocked(dirname);
const mockJoin = vi.mocked(join);

// Mock debug logger to suppress output
vi.mock("@/utils/debug", () => ({
  imageHashWarn: vi.fn(),
  imageHashError: vi.fn(),
}));

// Mock ASSETS_FOLDER constant
vi.mock("@/utils/imageUtils", () => ({
  ASSETS_FOLDER: "assets/images",
}));

import {
  loadHashRegistry,
  saveHashRegistry,
  findExistingImage,
  registerImageHash,
} from "./imageHashRegistry";

const DOC_PATH = "/Users/test/docs/note.md";
const DOC_DIR = "/Users/test/docs";
const ASSETS_PATH = "/Users/test/docs/assets/images";
const REGISTRY_PATH = "/Users/test/docs/assets/images/image-hashes.json";

// Suppress console.error from saveHashRegistry's error handler in tests
// that don't explicitly check it.
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy.mockClear();

  // Default path mocks
  mockDirname.mockImplementation((path: string) =>
    Promise.resolve(path.split("/").slice(0, -1).join("/") || "/")
  );
  mockJoin.mockImplementation((...parts: string[]) =>
    Promise.resolve(parts.join("/"))
  );
});

// ────────────────────────────────────────────────
// loadHashRegistry
// ────────────────────────────────────────────────

describe("loadHashRegistry", () => {
  it("returns empty registry when file does not exist", async () => {
    mockExists.mockResolvedValue(false);

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual({ version: 1, hashes: {} });
  });

  it("loads valid registry from disk", async () => {
    const stored = {
      version: 1,
      hashes: { abc123: "photo.png", def456: "diagram.svg" },
    };
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(JSON.stringify(stored));

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual(stored);
    expect(registry.hashes["abc123"]).toBe("photo.png");
    expect(registry.hashes["def456"]).toBe("diagram.svg");
  });

  it("returns empty registry for invalid JSON", async () => {
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue("not valid json{{{");

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual({ version: 1, hashes: {} });
  });

  it("returns empty registry when version field is missing", async () => {
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(
      JSON.stringify({ hashes: { a: "b" } })
    );

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual({ version: 1, hashes: {} });
  });

  it("returns empty registry when hashes field is not an object", async () => {
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(
      JSON.stringify({ version: 1, hashes: "not-an-object" })
    );

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual({ version: 1, hashes: {} });
  });

  it("returns empty registry when data is null", async () => {
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue("null");

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual({ version: 1, hashes: {} });
  });

  it("returns empty registry when data is an array", async () => {
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue("[1,2,3]");

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual({ version: 1, hashes: {} });
  });

  it("returns empty registry when readTextFile throws", async () => {
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockRejectedValue(new Error("read error"));

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual({ version: 1, hashes: {} });
  });

  it("returns empty registry when exists() throws", async () => {
    mockExists.mockRejectedValue(new Error("fs error"));

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry).toEqual({ version: 1, hashes: {} });
  });

  it("preserves registry with version > 1", async () => {
    const stored = { version: 2, hashes: { h1: "f1.png" } };
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(JSON.stringify(stored));

    const registry = await loadHashRegistry(DOC_PATH);
    expect(registry.version).toBe(2);
    expect(registry.hashes["h1"]).toBe("f1.png");
  });

  it("constructs the correct registry path", async () => {
    mockExists.mockResolvedValue(false);

    await loadHashRegistry(DOC_PATH);

    // dirname called with doc path
    expect(mockDirname).toHaveBeenCalledWith(DOC_PATH);
    // join called to build assets path, then registry path
    expect(mockJoin).toHaveBeenCalledWith(DOC_DIR, "assets/images");
    expect(mockJoin).toHaveBeenCalledWith(ASSETS_PATH, "image-hashes.json");
  });
});

// ────────────────────────────────────────────────
// saveHashRegistry
// ────────────────────────────────────────────────

describe("saveHashRegistry", () => {
  it("writes registry as formatted JSON", async () => {
    const registry = { version: 1, hashes: { hash1: "file1.png" } };

    await saveHashRegistry(DOC_PATH, registry);

    expect(mockWriteTextFile).toHaveBeenCalledWith(
      REGISTRY_PATH,
      JSON.stringify(registry, null, 2)
    );
  });

  it("writes empty registry", async () => {
    const registry = { version: 1, hashes: {} };

    await saveHashRegistry(DOC_PATH, registry);

    expect(mockWriteTextFile).toHaveBeenCalledWith(
      REGISTRY_PATH,
      JSON.stringify(registry, null, 2)
    );
  });

  it("does not throw when writeTextFile fails", async () => {
    mockWriteTextFile.mockRejectedValue(new Error("write error"));
    const registry = { version: 1, hashes: { h: "f.png" } };

    // Should not throw
    await expect(
      saveHashRegistry(DOC_PATH, registry)
    ).resolves.toBeUndefined();
  });

  it("logs error when write fails", async () => {
    mockWriteTextFile.mockRejectedValue(new Error("disk full"));

    await saveHashRegistry(DOC_PATH, {
      version: 1,
      hashes: {},
    });

    const debug = await import("@/utils/debug");
    expect(vi.mocked(debug.imageHashError)).toHaveBeenCalledWith(
      "Failed to save registry:",
      expect.any(Error)
    );
  });
});

// ────────────────────────────────────────────────
// findExistingImage
// ────────────────────────────────────────────────

describe("findExistingImage", () => {
  it("returns null when hash is not in registry", async () => {
    // loadHashRegistry returns empty
    mockExists.mockResolvedValue(false);

    const result = await findExistingImage(DOC_PATH, "nonexistent-hash");
    expect(result).toBeNull();
  });

  it("returns relative path when hash exists and file exists", async () => {
    const stored = { version: 1, hashes: { myhash: "photo.png" } };

    // First call: registry exists check → true
    // Second call: readTextFile for registry
    // Third call: image file exists check → true
    mockExists
      .mockResolvedValueOnce(true)   // registry exists
      .mockResolvedValueOnce(true);  // image file exists
    mockReadTextFile.mockResolvedValue(JSON.stringify(stored));

    const result = await findExistingImage(DOC_PATH, "myhash");
    expect(result).toBe("./assets/images/photo.png");
  });

  it("removes stale entry and returns null when file is deleted", async () => {
    const stored = { version: 1, hashes: { stale: "deleted.png" } };

    mockExists
      .mockResolvedValueOnce(true)    // registry exists
      .mockResolvedValueOnce(false);  // image file does NOT exist
    mockReadTextFile.mockResolvedValue(JSON.stringify(stored));

    const result = await findExistingImage(DOC_PATH, "stale");
    expect(result).toBeNull();

    // Should save updated registry (without the stale entry)
    expect(mockWriteTextFile).toHaveBeenCalled();
    const savedContent = mockWriteTextFile.mock.calls[0][1] as string;
    const savedRegistry = JSON.parse(savedContent);
    expect(savedRegistry.hashes["stale"]).toBeUndefined();
  });

  it("returns null for empty registry", async () => {
    mockExists.mockResolvedValue(false); // no registry file

    const result = await findExistingImage(DOC_PATH, "any-hash");
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────
// registerImageHash
// ────────────────────────────────────────────────

describe("registerImageHash", () => {
  it("adds hash to empty registry and saves", async () => {
    // loadHashRegistry: no registry file
    mockExists.mockResolvedValue(false);

    await registerImageHash(DOC_PATH, "newhash", "new-image.png");

    expect(mockWriteTextFile).toHaveBeenCalled();
    const savedContent = mockWriteTextFile.mock.calls[0][1] as string;
    const savedRegistry = JSON.parse(savedContent);
    expect(savedRegistry.version).toBe(1);
    expect(savedRegistry.hashes["newhash"]).toBe("new-image.png");
  });

  it("adds hash to existing registry", async () => {
    const stored = { version: 1, hashes: { existing: "old.png" } };
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(JSON.stringify(stored));

    await registerImageHash(DOC_PATH, "newhash", "new.jpg");

    const savedContent = mockWriteTextFile.mock.calls[0][1] as string;
    const savedRegistry = JSON.parse(savedContent);
    expect(savedRegistry.hashes["existing"]).toBe("old.png");
    expect(savedRegistry.hashes["newhash"]).toBe("new.jpg");
  });

  it("overwrites existing hash with new filename", async () => {
    const stored = { version: 1, hashes: { samehash: "old-name.png" } };
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(JSON.stringify(stored));

    await registerImageHash(DOC_PATH, "samehash", "new-name.png");

    const savedContent = mockWriteTextFile.mock.calls[0][1] as string;
    const savedRegistry = JSON.parse(savedContent);
    expect(savedRegistry.hashes["samehash"]).toBe("new-name.png");
  });

  it("handles empty hash string", async () => {
    mockExists.mockResolvedValue(false);

    await registerImageHash(DOC_PATH, "", "file.png");

    const savedContent = mockWriteTextFile.mock.calls[0][1] as string;
    const savedRegistry = JSON.parse(savedContent);
    expect(savedRegistry.hashes[""]).toBe("file.png");
  });

  it("handles special characters in filename", async () => {
    mockExists.mockResolvedValue(false);

    await registerImageHash(
      DOC_PATH,
      "hash123",
      "image (1) copy.png"
    );

    const savedContent = mockWriteTextFile.mock.calls[0][1] as string;
    const savedRegistry = JSON.parse(savedContent);
    expect(savedRegistry.hashes["hash123"]).toBe("image (1) copy.png");
  });

  it("handles Unicode filename", async () => {
    mockExists.mockResolvedValue(false);

    await registerImageHash(DOC_PATH, "hash456", "screenshot.png");

    const savedContent = mockWriteTextFile.mock.calls[0][1] as string;
    const savedRegistry = JSON.parse(savedContent);
    expect(savedRegistry.hashes["hash456"]).toBe("screenshot.png");
  });
});
