import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  readDir,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

import {
  getRecoveryDir,
  ensureRecoveryDir,
  writeRecoverySnapshot,
  readRecoverySnapshots,
  deleteRecoverySnapshot,
  deleteRecoveryFilesForTabs,
  deleteStaleRecoveryFiles,
  type RecoverySnapshot,
} from "./crashRecovery";

const mockExists = vi.mocked(exists);
const mockMkdir = vi.mocked(mkdir);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockReadTextFile = vi.mocked(readTextFile);
const mockReadDir = vi.mocked(readDir);
const mockRemove = vi.mocked(remove);
const mockRename = vi.mocked(rename);
const mockAppDataDir = vi.mocked(appDataDir);
const mockJoin = vi.mocked(join);

function makeSnapshot(overrides: Partial<RecoverySnapshot> = {}): RecoverySnapshot {
  return {
    version: 1,
    tabId: "tab-123",
    windowLabel: "main",
    content: "# Hello",
    filePath: null,
    title: "Untitled-1",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("crashRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppDataDir.mockResolvedValue("/Users/test/.config");
    mockJoin.mockImplementation((...parts: string[]) =>
      Promise.resolve(parts.join("/"))
    );
    mockExists.mockResolvedValue(false);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteTextFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
  });

  describe("getRecoveryDir", () => {
    it("returns appDataDir/recovery path", async () => {
      const dir = await getRecoveryDir();
      expect(dir).toBe("/Users/test/.config/recovery");
    });
  });

  describe("ensureRecoveryDir", () => {
    it("creates recovery dir if it does not exist", async () => {
      mockExists.mockResolvedValue(false);
      const dir = await ensureRecoveryDir();
      expect(dir).toBe("/Users/test/.config/recovery");
      expect(mockMkdir).toHaveBeenCalledWith("/Users/test/.config/recovery", {
        recursive: true,
      });
    });

    it("skips mkdir if dir already exists", async () => {
      mockExists.mockResolvedValue(true);
      await ensureRecoveryDir();
      expect(mockMkdir).not.toHaveBeenCalled();
    });
  });

  describe("writeRecoverySnapshot", () => {
    it("writes snapshot as JSON via atomic rename", async () => {
      const snapshot = makeSnapshot();
      const result = await writeRecoverySnapshot(snapshot);

      expect(result).toBe(true);

      // Should write to tmp file first (includes timestamp suffix)
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringMatching(/^\/Users\/test\/\.config\/recovery\/\.tmp-tab-123-\d+$/),
        expect.any(String)
      );

      // Then rename to final path
      const tmpPath = mockWriteTextFile.mock.calls[0][0] as string;
      expect(mockRename).toHaveBeenCalledWith(
        tmpPath,
        "/Users/test/.config/recovery/snapshot-tab-123.json"
      );

      // Verify JSON content
      const writtenJson = mockWriteTextFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenJson);
      expect(parsed.version).toBe(1);
      expect(parsed.tabId).toBe("tab-123");
      expect(parsed.content).toBe("# Hello");
    });

    it("ensures recovery dir exists before writing", async () => {
      mockExists.mockResolvedValue(false);
      await writeRecoverySnapshot(makeSnapshot());
      expect(mockMkdir).toHaveBeenCalled();
    });

    it("returns false on write error", async () => {
      mockWriteTextFile.mockRejectedValue(new Error("disk full"));
      const result = await writeRecoverySnapshot(makeSnapshot());
      expect(result).toBe(false);
    });
  });

  describe("readRecoverySnapshots", () => {
    it("returns empty array if recovery dir does not exist", async () => {
      mockExists.mockResolvedValue(false);
      const result = await readRecoverySnapshots();
      expect(result).toEqual([]);
    });

    it("reads and parses valid snapshot files", async () => {
      mockExists.mockResolvedValue(true);
      const snapshot = makeSnapshot();
      mockReadDir.mockResolvedValue([
        { name: "snapshot-tab-123.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      mockReadTextFile.mockResolvedValue(JSON.stringify(snapshot));

      const result = await readRecoverySnapshots();
      expect(result).toHaveLength(1);
      expect(result[0].tabId).toBe("tab-123");
    });

    it("skips corrupted JSON files", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: "snapshot-tab-1.json", isDirectory: false, isFile: true, isSymlink: false },
        { name: "snapshot-tab-2.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);

      mockReadTextFile
        .mockResolvedValueOnce("not valid json")
        .mockResolvedValueOnce(JSON.stringify(makeSnapshot({ tabId: "tab-2" })));

      const result = await readRecoverySnapshots();
      expect(result).toHaveLength(1);
      expect(result[0].tabId).toBe("tab-2");
    });

    it("skips non-snapshot files", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: ".tmp-tab-1", isDirectory: false, isFile: true, isSymlink: false },
        { name: "random.txt", isDirectory: false, isFile: true, isSymlink: false },
        { name: "snapshot-tab-2.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      mockReadTextFile.mockResolvedValue(JSON.stringify(makeSnapshot({ tabId: "tab-2" })));

      const result = await readRecoverySnapshots();
      expect(result).toHaveLength(1);
    });

    it("skips files missing required fields", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: "snapshot-tab-1.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      mockReadTextFile.mockResolvedValue(JSON.stringify({ version: 1 }));

      const result = await readRecoverySnapshots();
      expect(result).toEqual([]);
    });
  });

  describe("deleteRecoverySnapshot", () => {
    it("deletes the snapshot file for a tab", async () => {
      mockExists.mockResolvedValue(true);
      await deleteRecoverySnapshot("tab-123");
      expect(mockRemove).toHaveBeenCalledWith(
        "/Users/test/.config/recovery/snapshot-tab-123.json"
      );
    });

    it("does not throw if file is missing", async () => {
      mockExists.mockResolvedValue(false);
      await expect(deleteRecoverySnapshot("tab-123")).resolves.toBeUndefined();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("does not throw on remove error", async () => {
      mockExists.mockResolvedValue(true);
      mockRemove.mockRejectedValue(new Error("permission denied"));
      await expect(deleteRecoverySnapshot("tab-123")).resolves.toBeUndefined();
    });
  });

  describe("deleteStaleRecoveryFiles", () => {
    it("deletes files older than maxAgeDays", async () => {
      mockExists.mockResolvedValue(true);
      const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
      const recentTimestamp = Date.now() - 1 * 24 * 60 * 60 * 1000; // 1 day ago

      const oldSnapshot = makeSnapshot({ tabId: "old-tab", timestamp: oldTimestamp });
      const recentSnapshot = makeSnapshot({ tabId: "recent-tab", timestamp: recentTimestamp });

      mockReadDir.mockResolvedValue([
        { name: "snapshot-old-tab.json", isDirectory: false, isFile: true, isSymlink: false },
        { name: "snapshot-recent-tab.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);

      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(oldSnapshot))
        .mockResolvedValueOnce(JSON.stringify(recentSnapshot));

      await deleteStaleRecoveryFiles(7);

      // Should only delete the old one
      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledWith(
        "/Users/test/.config/recovery/snapshot-old-tab.json"
      );
    });

    it("does not throw if dir does not exist", async () => {
      mockExists.mockResolvedValue(false);
      await expect(deleteStaleRecoveryFiles(7)).resolves.toBeUndefined();
    });

    it("skips non-snapshot files (tmp files)", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: ".tmp-tab-1-12345", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);

      await deleteStaleRecoveryFiles(7);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("skips files with non-finite timestamps", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: "snapshot-tab-1.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      mockReadTextFile.mockResolvedValue(JSON.stringify({ timestamp: "not-a-number" }));

      await deleteStaleRecoveryFiles(7);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("skips unreadable files without throwing", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: "snapshot-tab-1.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      mockReadTextFile.mockRejectedValue(new Error("read error"));

      await expect(deleteStaleRecoveryFiles(7)).resolves.toBeUndefined();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("handles readDir throwing", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockRejectedValue(new Error("readDir failed"));

      await expect(deleteStaleRecoveryFiles(7)).resolves.toBeUndefined();
    });
  });

  describe("deleteRecoveryFilesForTabs", () => {
    it("deletes snapshots for each tab ID", async () => {
      mockExists.mockResolvedValue(true);
      await deleteRecoveryFilesForTabs(["tab-1", "tab-2"]);
      expect(mockRemove).toHaveBeenCalledTimes(2);
    });

    it("handles empty tab array", async () => {
      await deleteRecoveryFilesForTabs([]);
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe("readRecoverySnapshots - edge cases", () => {
    it("skips entries without names", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: null, isDirectory: false, isFile: true, isSymlink: false },
      ] as never);

      const result = await readRecoverySnapshots();
      expect(result).toEqual([]);
    });

    it("handles readDir throwing", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockRejectedValue(new Error("readDir failed"));

      const result = await readRecoverySnapshots();
      expect(result).toEqual([]);
    });

    it("validates snapshot with string filePath", async () => {
      mockExists.mockResolvedValue(true);
      const snapshot = makeSnapshot({ filePath: "/path/to/file.md" });
      mockReadDir.mockResolvedValue([
        { name: "snapshot-tab-1.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      mockReadTextFile.mockResolvedValue(JSON.stringify(snapshot));

      const result = await readRecoverySnapshots();
      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("/path/to/file.md");
    });

    it("rejects snapshot with non-finite timestamp", async () => {
      mockExists.mockResolvedValue(true);
      const bad = { ...makeSnapshot(), timestamp: Infinity };
      mockReadDir.mockResolvedValue([
        { name: "snapshot-tab-1.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      mockReadTextFile.mockResolvedValue(JSON.stringify(bad));

      const result = await readRecoverySnapshots();
      expect(result).toEqual([]);
    });
  });

  describe("writeRecoverySnapshot - edge cases", () => {
    it("returns false on non-Error rejection", async () => {
      mockWriteTextFile.mockRejectedValue("string error");
      const result = await writeRecoverySnapshot(makeSnapshot());
      expect(result).toBe(false);
    });
  });

  describe("readRecoverySnapshots - non-Error rejection (line 135)", () => {
    it("handles non-Error thrown by readDir (String path)", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockRejectedValue("string error, not an Error instance");
      const result = await readRecoverySnapshots();
      expect(result).toEqual([]);
    });
  });

  describe("deleteRecoverySnapshot - non-Error rejection (line 157)", () => {
    it("handles non-Error thrown during delete", async () => {
      mockExists.mockResolvedValue(true);
      mockRemove.mockRejectedValue("string error");
      // Should not throw even when error is not an Error instance
      await expect(deleteRecoverySnapshot("tab-123")).resolves.toBeUndefined();
    });
  });

  describe("deleteStaleRecoveryFiles - non-Error rejection (line 238)", () => {
    it("handles non-Error thrown by readDir", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockRejectedValue("string error");
      await expect(deleteStaleRecoveryFiles(7)).resolves.toBeUndefined();
    });
  });

  describe("isValidSnapshot - primitive input (line 247)", () => {
    it("rejects non-object values (number, string, null)", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: "snapshot-tab-1.json", isDirectory: false, isFile: true, isSymlink: false },
        { name: "snapshot-tab-2.json", isDirectory: false, isFile: true, isSymlink: false },
        { name: "snapshot-tab-3.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      // Primitive JSON values — isValidSnapshot receives typeof !== "object"
      mockReadTextFile
        .mockResolvedValueOnce("42")          // number — typeof 42 !== "object"
        .mockResolvedValueOnce('"a string"')  // string — typeof "a" !== "object"
        .mockResolvedValueOnce("true");        // boolean — typeof true !== "object"

      const result = await readRecoverySnapshots();
      // All primitives should be rejected by isValidSnapshot
      expect(result).toEqual([]);
    });
  });
});
