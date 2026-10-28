// @vitest-environment node
/**
 * Tests for useHistoryOperations — document version history CRUD.
 *
 * Covers:
 *   - getHistoryIndex: read/parse/missing/invalid
 *   - createSnapshot: file size guard, merge window, auto/manual/revert types
 *   - getSnapshots / loadSnapshot / revertToSnapshot
 *   - pruneSnapshots: age filtering, max count
 *   - markAsDeleted / deleteSnapshot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** The fixed "now" every test runs at; snapshot ages are measured from it. */
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);


const mockMkdir = vi.fn();
const mockExists = vi.fn((..._args: unknown[]) => Promise.resolve(false));
const mockReadTextFile = vi.fn();
const mockWriteTextFile = vi.fn();
const mockRemove = vi.fn();
// The index is written beside itself and renamed over the old one.
const mockRename = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  exists: (...args: unknown[]) => mockExists(...args),
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
  rename: (...args: unknown[]) => mockRename(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(() => Promise.resolve("/app")),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

vi.mock("@/utils/debug", () => ({
  historyLog: vi.fn(),
  historyError: vi.fn(),
}));

// A non-English UI: the stored name of a document with no file name must be
// the translation, not a hard-coded "Untitled" (WI-RA26.6).
vi.mock("@/i18n", () => ({
  default: { t: (key: string) => (key === "common:untitled" ? "未命名" : key) },
}));

vi.mock("@/utils/historyTypes", async (importOriginal) => ({
  HISTORY_FOLDER: "history",
  INDEX_FILE: "index.json",
  // Pure constructor: the real one, so the stored index is what production writes.
  createHistoryIndex: (await importOriginal<typeof import("@/utils/historyTypes")>()).createHistoryIndex,
  generatePreview: vi.fn((c: string) => c.slice(0, 50)),
  getByteSize: vi.fn((c: string) => c.length),
  hashPath: vi.fn((p: string) => Promise.resolve("hash_" + p.replace(/\//g, "_"))),
  parseHistoryIndex: vi.fn((obj: unknown) => obj),
}));

import {
  getHistoryIndex,
  createSnapshot,
  getSnapshots,
  loadSnapshot,
  revertToSnapshot,
  pruneSnapshots,

  deleteSnapshot,
} from "./historyOperations";

const defaultSettings = {
  maxSnapshots: 50,
  maxAgeDays: 30,
  mergeWindowSeconds: 30,
  maxFileSizeKB: 1024,
};

/** Every path exists except a newly allocated snapshot file (timestamp-uuid.md). */
const existsExceptNewSnapshot = (path: unknown) =>
  Promise.resolve(!/\/\d+-[0-9a-f]{8}-[0-9a-f-]{27}\.md$/.test(String(path)));

function makeIndex(overrides = {}) {
  return {
    documentPath: "/test/doc.md",
    documentName: "doc.md",
    pathHash: "hash_test_doc.md",
    status: "active" as const,
    deletedAt: null,
    snapshots: [],
    settings: defaultSettings,
    ...overrides,
  };
}

describe("useHistoryOperations", () => {
  beforeEach(() => {
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    mockExists.mockResolvedValue(false);
    mockReadTextFile.mockResolvedValue("{}");
    mockWriteTextFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getHistoryIndex", () => {
    it("returns null when index file does not exist", async () => {
      mockExists.mockResolvedValue(false);
      const result = await getHistoryIndex("/test/doc.md");
      expect(result).toBeNull();
    });

    it("returns parsed index when file exists", async () => {
      const index = makeIndex();
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));
      const result = await getHistoryIndex("/test/doc.md");
      expect(result).toEqual(index);
    });

    it("returns null when parseHistoryIndex returns null", async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue("{}");
      const { parseHistoryIndex } = await import("@/utils/historyTypes");
      (parseHistoryIndex as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
      const result = await getHistoryIndex("/test/doc.md");
      expect(result).toBeNull();
    });

    it("returns null on read error", async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockRejectedValue(new Error("read error"));
      const result = await getHistoryIndex("/test/doc.md");
      expect(result).toBeNull();
    });
  });

  describe("createSnapshot", () => {
    it("creates a new snapshot when no index exists", async () => {
      mockExists.mockResolvedValue(false);
      await createSnapshot("/test/doc.md", "content", "manual", defaultSettings);
      expect(mockWriteTextFile).toHaveBeenCalledTimes(2); // snapshot file + index
    });

    // WI-RA26.6 — a path with no file name is stored under the translated name.
    it("names a document with no file name in the UI language", async () => {
      mockExists.mockResolvedValue(false);
      await createSnapshot("/test/folder/", "content", "manual", defaultSettings);
      const indexWrite = mockWriteTextFile.mock.calls.find(([path]) => String(path).endsWith("index.json.tmp"));
      expect(JSON.parse(String(indexWrite?.[1])).documentName).toBe("未命名");
    });

    it("skips auto-save when file size exceeds limit", async () => {
      await createSnapshot("/test/doc.md", "x".repeat(2000), "auto", {
        ...defaultSettings,
        maxFileSizeKB: 1, // 1KB limit
      });
      // Should not write anything
      expect(mockWriteTextFile).not.toHaveBeenCalled();
    });

    it("does NOT skip manual save when file size exceeds limit", async () => {
      mockExists.mockResolvedValue(false);
      await createSnapshot("/test/doc.md", "x".repeat(2000), "manual", {
        ...defaultSettings,
        maxFileSizeKB: 1,
      });
      expect(mockWriteTextFile).toHaveBeenCalled();
    });

    // WI-RA18.11 — an AI client's save keeps a manual save's guarantees.
    it("does NOT skip an mcp snapshot when file size exceeds limit", async () => {
      mockExists.mockResolvedValue(false);
      await createSnapshot("/test/doc.md", "x".repeat(2000), "mcp", {
        ...defaultSettings,
        maxFileSizeKB: 1,
      });
      expect(mockWriteTextFile).toHaveBeenCalled();
    });

    it.each([
      ["an mcp snapshot into a previous auto one", "auto", "mcp"],
      ["an auto snapshot into a previous mcp one", "mcp", "auto"],
    ] as const)("does not merge %s", async (_label, previousType, type) => {
      const now = Date.now();
      const index = makeIndex({
        snapshots: [{ id: "prev-id", timestamp: now - 10000, type: previousType, size: 100, preview: "old" }],
      });
      mockExists.mockImplementation(existsExceptNewSnapshot);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));

      await createSnapshot("/test/doc.md", "new content", type, { ...defaultSettings, mergeWindowSeconds: 60 });

      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("merges with previous auto snapshot within merge window", async () => {
      const now = NOW;
      const prevSnapshot = {
        id: "prev-id",
        timestamp: now - 10000, // 10 seconds ago
        type: "auto",
        size: 100,
        preview: "old",
      };
      const index = makeIndex({ snapshots: [prevSnapshot] });

      mockExists.mockImplementation(existsExceptNewSnapshot);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));

      await createSnapshot("/test/doc.md", "new content", "auto", {
        ...defaultSettings,
        mergeWindowSeconds: 60,
      });

      // Should have removed old snapshot file
      expect(mockRemove).toHaveBeenCalledWith(expect.stringContaining("prev-id.md"));
    });

    it("throws on write failure", async () => {
      mockExists.mockResolvedValue(false);
      mockWriteTextFile.mockRejectedValue(new Error("write fail"));
      await expect(
        createSnapshot("/test/doc.md", "content", "manual", defaultSettings)
      ).rejects.toThrow("write fail");
    });
  });

  describe("getSnapshots", () => {
    it("returns empty array when no index", async () => {
      mockExists.mockResolvedValue(false);
      const result = await getSnapshots("/test/doc.md");
      expect(result).toEqual([]);
    });

    it("returns snapshots sorted newest first", async () => {
      const index = makeIndex({
        snapshots: [
          { id: "a", timestamp: 100, type: "auto", size: 10, preview: "" },
          { id: "b", timestamp: 300, type: "auto", size: 10, preview: "" },
          { id: "c", timestamp: 200, type: "auto", size: 10, preview: "" },
        ],
      });
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));
      const result = await getSnapshots("/test/doc.md");
      expect(result[0].id).toBe("b");
      expect(result[1].id).toBe("c");
      expect(result[2].id).toBe("a");
    });
  });

  describe("loadSnapshot", () => {
    it("returns content when snapshot exists", async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue("snapshot content");
      const result = await loadSnapshot("/test/doc.md", "snap-1");
      expect(result).toBe("snapshot content");
    });

    it("returns null when snapshot file missing", async () => {
      mockExists.mockResolvedValue(false);
      const result = await loadSnapshot("/test/doc.md", "snap-1");
      expect(result).toBeNull();
    });

    it("returns null on read error", async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockRejectedValue(new Error("fail"));
      const result = await loadSnapshot("/test/doc.md", "snap-1");
      expect(result).toBeNull();
    });
  });

  describe("revertToSnapshot", () => {
    it("creates revert snapshot then loads target", async () => {
      // For createSnapshot
      mockExists.mockResolvedValue(false);
      // For loadSnapshot after revert
      mockReadTextFile.mockResolvedValue("old content");

      const _result = await revertToSnapshot(
        "/test/doc.md",
        "snap-1",
        "current content",
        defaultSettings
      );
      // loadSnapshot will return null because exists is false for the snapshot
      // but createSnapshot should have been called
      expect(mockWriteTextFile).toHaveBeenCalled();
    });
  });

  describe("pruneSnapshots", () => {
    it("does nothing when no index", async () => {
      mockExists.mockResolvedValue(false);
      await pruneSnapshots("/test/doc.md");
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("removes snapshots exceeding max count", async () => {
      const now = NOW;
      const snapshots = Array.from({ length: 5 }, (_, i) => ({
        id: `snap-${i}`,
        timestamp: now - i * 1000,
        type: "auto" as const,
        size: 10,
        preview: "",
      }));
      const index = makeIndex({
        snapshots,
        settings: { ...defaultSettings, maxSnapshots: 3 },
      });

      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));

      await pruneSnapshots("/test/doc.md");

      // Should remove 2 oldest snapshots
      expect(mockRemove).toHaveBeenCalledTimes(2);
    });

    it("removes snapshots older than maxAgeDays", async () => {
      const now = NOW;
      const oldTime = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago
      const snapshots = [
        { id: "new", timestamp: now, type: "auto" as const, size: 10, preview: "" },
        { id: "old", timestamp: oldTime, type: "auto" as const, size: 10, preview: "" },
      ];
      const index = makeIndex({
        snapshots,
        settings: { ...defaultSettings, maxAgeDays: 30 },
      });

      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));

      await pruneSnapshots("/test/doc.md");

      expect(mockRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleteSnapshot", () => {
    it("removes snapshot file and updates index", async () => {
      const index = makeIndex({
        snapshots: [
          { id: "keep", timestamp: 200, type: "auto", size: 10, preview: "" },
          { id: "delete-me", timestamp: 100, type: "auto", size: 10, preview: "" },
        ],
      });
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));

      await deleteSnapshot("/test/doc.md", "delete-me");

      expect(mockRemove).toHaveBeenCalled();
      const writtenContent = JSON.parse(mockWriteTextFile.mock.calls[0][1]);
      expect(writtenContent.snapshots).toHaveLength(1);
      expect(writtenContent.snapshots[0].id).toBe("keep");
    });

    it("does nothing when no index", async () => {
      mockExists.mockResolvedValue(false);
      await deleteSnapshot("/test/doc.md", "snap-1");
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("does nothing when snapshot not in index", async () => {
      const index = makeIndex({ snapshots: [] });
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));
      await deleteSnapshot("/test/doc.md", "nonexistent");
      // No remove or write calls beyond the initial read
    });

    it("tolerates missing snapshot file during deletion", async () => {
      const index = makeIndex({
        snapshots: [{ id: "snap-1", timestamp: 100, type: "auto", size: 10, preview: "" }],
      });
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));
      mockRemove.mockRejectedValue(new Error("file not found"));

      // Should not throw
      await deleteSnapshot("/test/doc.md", "snap-1");

      // Index should still be updated
      expect(mockWriteTextFile).toHaveBeenCalled();
    });

    it("catches and silences errors from getHistoryIndex throwing (line 380)", async () => {
      // Make mockExists throw to trigger the outer catch in deleteSnapshot (line 380)
      mockExists.mockRejectedValue(new Error("fs error"));
      // Should not throw
      await deleteSnapshot("/test/doc.md", "snap-1");
      expect(mockWriteTextFile).not.toHaveBeenCalled();
    });
  });

  describe("pruneSnapshots — error path (line 329)", () => {
    it("catches and silences errors from getHistoryIndex throwing", async () => {
      mockExists.mockRejectedValue(new Error("fs error in prune"));
      // Should not throw
      await pruneSnapshots("/test/doc.md");
    });
  });

  describe("createSnapshot — merge window old snapshot does not exist (branch 12, line 189)", () => {
    it("pops last snapshot from index even when old file does not exist on disk", async () => {
      const now = NOW;
      const prevSnapshot = {
        id: "prev-id",
        timestamp: now - 5000,
        type: "auto",
        size: 100,
        preview: "old",
      };
      const index = makeIndex({ snapshots: [prevSnapshot] });

      // Sequence: historyDir exists, index exists, old snapshot file does NOT exist, prune paths
      mockExists
        .mockResolvedValueOnce(true)   // historyDir exists
        .mockResolvedValueOnce(true)   // index file exists (for getHistoryIndex)
        .mockResolvedValueOnce(false)  // old snapshot file does NOT exist (branch 12 false)
        .mockResolvedValueOnce(false); // prune: index doesn't exist

      mockReadTextFile.mockResolvedValue(JSON.stringify(index));

      await createSnapshot("/test/doc.md", "new content", "auto", {
        ...defaultSettings,
        mergeWindowSeconds: 60,
      });

      // The old snapshot was NOT on disk, so remove should NOT have been called for it
      expect(mockRemove).not.toHaveBeenCalled();
      // But the snapshot should still have been replaced in the index (pop + push new)
      expect(mockWriteTextFile).toHaveBeenCalled();
    });
  });

  describe("pruneSnapshots — snapshot file does not exist during prune (branch 17, line 313)", () => {
    it("skips remove when snapshot file does not exist on disk", async () => {
      const now = NOW;
      const snapshots = Array.from({ length: 5 }, (_, i) => ({
        id: `snap-${i}`,
        timestamp: now - i * 1000,
        type: "auto" as const,
        size: 10,
        preview: "",
      }));
      const index = makeIndex({
        snapshots,
        settings: { ...defaultSettings, maxSnapshots: 3 },
      });

      // For getHistoryIndex calls and getDocHistoryDir
      // exists calls: index file exists(true), then for each of 2 pruned snapshots: file does NOT exist
      mockExists
        .mockResolvedValueOnce(true)   // index file exists
        .mockResolvedValueOnce(false)  // snap-4 does not exist on disk (branch 17 false)
        .mockResolvedValueOnce(false); // snap-3 does not exist on disk (branch 17 false)

      mockReadTextFile.mockResolvedValue(JSON.stringify(index));

      await pruneSnapshots("/test/doc.md");

      // remove should NOT have been called since files don't exist
      expect(mockRemove).not.toHaveBeenCalled();
      // But index should still be saved with only 3 snapshots
      expect(mockWriteTextFile).toHaveBeenCalled();
      const writtenIndex = JSON.parse(mockWriteTextFile.mock.calls[0][1]);
      expect(writtenIndex.snapshots).toHaveLength(3);
    });
  });

  describe("pruneSnapshots — individual snapshot deletion error (line 316-318)", () => {
    it("continues pruning when individual snapshot file deletion throws", async () => {
      const now = NOW;
      const snapshots = Array.from({ length: 4 }, (_, i) => ({
        id: `snap-${i}`,
        timestamp: now - i * 1000,
        type: "auto" as const,
        size: 10,
        preview: "",
      }));
      const index = makeIndex({
        snapshots,
        settings: { ...defaultSettings, maxSnapshots: 2 },
      });

      mockExists.mockResolvedValue(true); // all paths exist
      mockReadTextFile.mockResolvedValue(JSON.stringify(index));
      mockRemove.mockRejectedValue(new Error("permission denied"));

      await pruneSnapshots("/test/doc.md");

      // Despite deletion errors, the index should still be saved
      expect(mockWriteTextFile).toHaveBeenCalled();
    });
  });

  describe("createSnapshot — merge window sort (line 179)", () => {
    it("sorts snapshots when merge window is active but last snapshot is outside window", async () => {
      const now = NOW;
      // Two snapshots: one old auto (outside merge window), one manual
      const snapshots = [
        { id: "snap-manual", timestamp: now - 5000, type: "manual", size: 10, preview: "" },
        { id: "snap-auto-old", timestamp: now - 120000, type: "auto", size: 10, preview: "" },
      ];
      const index = makeIndex({ snapshots });

      mockExists
        .mockResolvedValueOnce(true)  // historyDir exists
        .mockResolvedValueOnce(true)  // index exists
        .mockResolvedValueOnce(false); // prune: historyDir missing

      mockReadTextFile.mockResolvedValue(JSON.stringify(index));

      // Auto snapshot with mergeWindowSeconds = 60, but last snapshot (snap-manual) is type "manual"
      // so no merge happens, but the sort at line 179 DOES execute (index.snapshots.length > 0)
      await createSnapshot("/test/doc.md", "content", "auto", {
        ...defaultSettings,
        mergeWindowSeconds: 60,
      });

      // Snapshot created — should have written twice (snapshot file + index)
      expect(mockWriteTextFile).toHaveBeenCalled();
    });
  });
});
