// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  retireRecoveryTabs,
  unretireRecoveryTabs,
  getRetirementEpoch,
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

/** The fixed "now" every test runs at; snapshot ages are measured from it. */
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function makeSnapshot(overrides: Partial<RecoverySnapshot> = {}): RecoverySnapshot {
  return {
    version: 1,
    tabId: "tab-123",
    windowLabel: "main",
    content: "# Hello",
    filePath: null,
    title: "Untitled-1",
    timestamp: NOW,
    ...overrides,
  };
}

describe("crashRecovery", () => {
  beforeEach(() => {
    vi.setSystemTime(NOW);
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

  afterEach(() => {
    vi.useRealTimers();
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
        `/Users/test/.config/recovery/.tmp-tab-123-${NOW}`,
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
      const oldTimestamp = NOW - 8 * DAY_MS;
      const recentTimestamp = NOW - 1 * DAY_MS;

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

    it("keeps a snapshot exactly maxAgeDays old and deletes one a millisecond older", async () => {
      mockExists.mockResolvedValue(true);
      mockReadDir.mockResolvedValue([
        { name: "snapshot-edge.json", isDirectory: false, isFile: true, isSymlink: false },
        { name: "snapshot-past.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as never);
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(makeSnapshot({ tabId: "edge", timestamp: NOW - 7 * DAY_MS })))
        .mockResolvedValueOnce(JSON.stringify(makeSnapshot({ tabId: "past", timestamp: NOW - 7 * DAY_MS - 1 })));

      await deleteStaleRecoveryFiles(7);

      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledWith("/Users/test/.config/recovery/snapshot-past.json");
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

  describe("retireRecoveryTabs", () => {
    it("resolves only after every delete has settled", async () => {
      mockExists.mockResolvedValue(true);
      let finished = 0;
      mockRemove.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5));
        finished++;
      });
      await retireRecoveryTabs(["r-a", "r-b"]);
      expect(finished).toBe(2);
      unretireRecoveryTabs(["r-a", "r-b"]);
    });

    it("does not block when a delete fails (permission denied)", async () => {
      mockExists.mockResolvedValue(true);
      mockRemove.mockRejectedValue(new Error("permission denied"));
      await expect(retireRecoveryTabs(["r-c"])).resolves.toBeUndefined();
      unretireRecoveryTabs(["r-c"]);
    });

    it("refuses later snapshot writes for a retired tab until lifted", async () => {
      await retireRecoveryTabs(["r-d"]);
      expect(await writeRecoverySnapshot(makeSnapshot({ tabId: "r-d", content: "你好 discarded" }))).toBe(false);
      expect(mockWriteTextFile).not.toHaveBeenCalled();

      const epoch = getRetirementEpoch();
      unretireRecoveryTabs(["r-d"]);
      expect(getRetirementEpoch()).toBe(epoch + 1);
      expect(await writeRecoverySnapshot(makeSnapshot({ tabId: "r-d" }))).toBe(true);
    });

    it("takes back a write that was already in flight when the tab retired", async () => {
      mockExists.mockResolvedValue(true);
      let release!: () => void;
      mockWriteTextFile.mockImplementationOnce(
        () => new Promise<void>((r) => { release = r; }),
      );
      const pending = writeRecoverySnapshot(makeSnapshot({ tabId: "r-e" }));
      await vi.waitFor(() => expect(mockWriteTextFile).toHaveBeenCalled());
      let retired = false;
      const retiring = retireRecoveryTabs(["r-e"]).then(() => { retired = true; });
      await new Promise((r) => setTimeout(r, 10));
      // Retirement waits for the running write to land before it deletes.
      expect(retired).toBe(false);
      mockRemove.mockClear();
      release();
      await retiring;
      expect(await pending).toBe(false);
      expect(mockRemove).toHaveBeenCalledWith(expect.stringContaining("snapshot-r-e.json"));
      unretireRecoveryTabs(["r-e"]);
    });

    it("keeps a tab retired until every overlapping retirement is lifted", async () => {
      await retireRecoveryTabs(["r-g"]);
      await retireRecoveryTabs(["r-g"]);
      unretireRecoveryTabs(["r-g"]);
      expect(await writeRecoverySnapshot(makeSnapshot({ tabId: "r-g" }))).toBe(false);
      unretireRecoveryTabs(["r-g"]);
      expect(await writeRecoverySnapshot(makeSnapshot({ tabId: "r-g" }))).toBe(true);
    });

    it("waits for every in-flight write of the targeted tabs, not unrelated ones", async () => {
      mockExists.mockResolvedValue(true);
      const releases: Record<string, Array<() => void>> = { "r-h": [], "r-i": [], "r-other": [] };
      const order: string[] = [];
      mockWriteTextFile.mockImplementation((path) => {
        const key = Object.keys(releases).find((k) => String(path).includes(`.tmp-${k}-`))!;
        return new Promise<void>((r) => releases[key].push(() => { order.push(key); r(); }));
      });
      const w1 = writeRecoverySnapshot(makeSnapshot({ tabId: "r-h" }));
      const w2 = writeRecoverySnapshot(makeSnapshot({ tabId: "r-h" }));
      const w3 = writeRecoverySnapshot(makeSnapshot({ tabId: "r-i" }));
      const w4 = writeRecoverySnapshot(makeSnapshot({ tabId: "r-other" }));
      await vi.waitFor(() => expect(mockWriteTextFile).toHaveBeenCalledTimes(4));
      let retired = false;
      const retiring = retireRecoveryTabs(["r-h", "r-i"]).then(() => { retired = true; });
      releases["r-h"][0](); releases["r-h"][1]();
      await new Promise((r) => setTimeout(r, 10));
      expect(retired).toBe(false); // r-i still running; r-other irrelevant
      releases["r-i"][0]();
      await retiring; // completes without waiting for r-other
      expect(retired).toBe(true);
      releases["r-other"][0]();
      await Promise.all([w1, w2, w3, w4]);
      unretireRecoveryTabs(["r-h", "r-i"]);
      mockWriteTextFile.mockResolvedValue(undefined);
    });

    it("is a no-op when the snapshot is already absent", async () => {
      mockExists.mockResolvedValue(false);
      await retireRecoveryTabs(["r-f"]);
      expect(mockRemove).not.toHaveBeenCalled();
      unretireRecoveryTabs(["r-f"]);
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
