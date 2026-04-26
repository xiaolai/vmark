/**
 * Tests for useHistoryRecovery
 *
 * Tests deleteHistory, clearAllHistory, deleteDocumentHistory, clearWorkspaceHistory.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockExists = vi.fn();
const mockReadTextFile = vi.fn();

const mockReadDir = vi.fn();
const mockRemove = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...args: unknown[]) => mockExists(...args),
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),

  readDir: (...args: unknown[]) => mockReadDir(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

vi.mock("@/utils/debug", () => ({
  historyLog: vi.fn(),
  historyError: vi.fn(),
}));

const mockGetHistoryBaseDir = vi.fn(() => Promise.resolve("/appdata/history"));
vi.mock("@/hooks/useHistoryOperations", () => ({
  getHistoryBaseDir: () => mockGetHistoryBaseDir(),
}));

const mockHashPath = vi.fn(async (path: string) => `hash_${path.replace(/\//g, "_")}`);
vi.mock("@/utils/historyTypes", () => ({
  INDEX_FILE: "index.json",
  hashPath: (...args: unknown[]) => mockHashPath(...(args as [string])),
  parseHistoryIndex: (raw: unknown) => {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.pathHash !== "string") return null;
    if (!Array.isArray(obj.snapshots)) return null;
    return raw;
  },
}));

vi.mock("@/utils/paths/paths", () => ({
  normalizePath: (p: string) => p.replace(/\\/g, "/").replace(/\/$/, ""),
  isWithinRoot: (root: string, path: string) => path.startsWith(root),
}));

import {
  deleteHistory,
  clearAllHistory,
  deleteDocumentHistory,
  clearWorkspaceHistory,
} from "./useHistoryRecovery";

describe("deleteHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes directory when it exists", async () => {
    mockExists.mockResolvedValue(true);
    await deleteHistory("abc123");
    expect(mockRemove).toHaveBeenCalledWith(
      expect.stringContaining("abc123"),
      { recursive: true }
    );
  });

  it("does nothing when directory does not exist", async () => {
    mockExists.mockResolvedValue(false);
    await deleteHistory("missing");
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("handles remove error gracefully", async () => {
    mockExists.mockResolvedValue(true);
    mockRemove.mockRejectedValue(new Error("permission denied"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await deleteHistory("abc123");
    // Should not throw
    errorSpy.mockRestore();
  });
});

describe("clearAllHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes entire history directory and logs", async () => {
    mockExists.mockResolvedValue(true);
    mockRemove.mockResolvedValue(undefined);
    await clearAllHistory();
    expect(mockRemove).toHaveBeenCalledWith("/appdata/history", { recursive: true });
    // Verify historyLog was called after successful removal (line 164)
    const { historyLog } = await import("@/utils/debug");
    expect(vi.mocked(historyLog)).toHaveBeenCalledWith("Cleared all history");
  });

  it("does nothing when directory does not exist", async () => {
    mockExists.mockResolvedValue(false);
    await clearAllHistory();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("handles error gracefully", async () => {
    mockExists.mockResolvedValue(true);
    mockRemove.mockRejectedValue(new Error("disk error"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await clearAllHistory();
    errorSpy.mockRestore();
  });
});

describe("deleteDocumentHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes history using hashed path", async () => {
    mockExists.mockResolvedValue(true);
    await deleteDocumentHistory("/docs/test.md");
    expect(mockRemove).toHaveBeenCalled();
  });

  it("handles error gracefully when remove fails", async () => {
    mockExists.mockResolvedValue(true);
    mockRemove.mockRejectedValue(new Error("fail"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await deleteDocumentHistory("/docs/test.md");
    errorSpy.mockRestore();
  });

  it("catches error when hashPath throws (line 181)", async () => {
    mockHashPath.mockRejectedValueOnce(new Error("hash failed"));

    await deleteDocumentHistory("/docs/broken.md");
    const { historyError } = await import("@/utils/debug");
    expect(vi.mocked(historyError)).toHaveBeenCalledWith(
      "Failed to delete document history:",
      expect.any(Error),
    );
  });
});

describe("clearWorkspaceHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 for empty workspace path", async () => {
    const count = await clearWorkspaceHistory("  ");
    expect(count).toBe(0);
  });

  it("returns 0 when base dir does not exist", async () => {
    mockExists.mockResolvedValue(false);
    const count = await clearWorkspaceHistory("/workspace");
    expect(count).toBe(0);
  });

  it("deletes history for documents within workspace", async () => {
    mockExists.mockResolvedValue(true);
    // Reset remove mock — earlier `clearAllHistory` describe leaves
    // a mockRejectedValue that would otherwise leak in here.
    mockRemove.mockReset();
    mockRemove.mockResolvedValue(undefined);
    mockReadDir.mockResolvedValue([
      { name: "hash1", isDirectory: true },
      { name: "hash2", isDirectory: true },
    ]);
    mockReadTextFile
      .mockResolvedValueOnce(
        JSON.stringify({
          pathHash: "hash1",
          documentPath: "/workspace/docs/file1.md",
          snapshots: [{ id: "s1" }],
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          pathHash: "hash2",
          documentPath: "/other/docs/file2.md",
          snapshots: [{ id: "s2" }],
        })
      );

    const count = await clearWorkspaceHistory("/workspace");

    expect(count).toBe(1); // Only file1.md is within workspace
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it("does NOT count failed removes — partial failure surfaces a warning toast", async () => {
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([
      { name: "hash1", isDirectory: true },
      { name: "hash2", isDirectory: true },
    ]);
    mockReadTextFile
      .mockResolvedValueOnce(
        JSON.stringify({
          pathHash: "hash1",
          documentPath: "/workspace/docs/file1.md",
          snapshots: [{ id: "s1" }],
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          pathHash: "hash2",
          documentPath: "/workspace/docs/file2.md",
          snapshots: [{ id: "s2" }],
        })
      );
    // First remove succeeds, second fails — count must reflect the truth.
    mockRemove.mockReset();
    mockRemove
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("permission denied"));

    const count = await clearWorkspaceHistory("/workspace");

    expect(count).toBe(1);
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });

  it("skips entries with invalid index", async () => {
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([{ name: "hash1", isDirectory: true }]);
    mockReadTextFile.mockResolvedValue("invalid json");

    const count = await clearWorkspaceHistory("/workspace");
    expect(count).toBe(0);
  });

  it("skips entries where parseHistoryIndex returns null (line 210)", async () => {
    // Valid JSON but missing required fields — parseHistoryIndex returns null
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([{ name: "hash1", isDirectory: true }]);
    mockReadTextFile.mockResolvedValue(JSON.stringify({ foo: "bar" }));

    const count = await clearWorkspaceHistory("/workspace");
    expect(count).toBe(0);
  });

  it("handles readDir error gracefully", async () => {
    mockExists.mockResolvedValue(true);
    mockReadDir.mockRejectedValue(new Error("fail"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const count = await clearWorkspaceHistory("/workspace");
    expect(count).toBe(0);
    errorSpy.mockRestore();
  });

  it("skips non-directory entries in workspace clearing", async () => {
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([
      { name: "file.txt", isDirectory: false },
    ]);
    const count = await clearWorkspaceHistory("/workspace");
    expect(count).toBe(0);
  });

  it("skips entries without index file in workspace clearing", async () => {
    mockExists
      .mockResolvedValueOnce(true)  // baseDir
      .mockResolvedValueOnce(false); // index.json
    mockReadDir.mockResolvedValue([{ name: "hash1", isDirectory: true }]);
    const count = await clearWorkspaceHistory("/workspace");
    expect(count).toBe(0);
  });
});

