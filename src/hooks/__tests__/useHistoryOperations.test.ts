/**
 * Tests for useHistoryOperations — createSnapshot merge window and file size guard
 *
 * @module hooks/__tests__/useHistoryOperations.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HistorySettings } from "@/utils/historyTypes";

// Predictable hash for DOC_PATH — vi.hoisted ensures availability inside vi.mock factories
const { HASH, HISTORY_DIR, INDEX_PATH } = vi.hoisted(() => {
  const HASH = "testhash01";
  const HISTORY_DIR = `/app-data/history/${HASH}`;
  const INDEX_PATH = `${HISTORY_DIR}/index.json`;
  return { HASH, HISTORY_DIR, INDEX_PATH };
});

// Virtual filesystem — tracks written files so reads return fresh data
const fileStore = new Map<string, string>();

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockExists = vi.fn((path: string) =>
  Promise.resolve(fileStore.has(path))
);
const mockReadTextFile = vi.fn((path: string) => {
  const content = fileStore.get(path);
  if (content !== undefined) return Promise.resolve(content);
  return Promise.reject(new Error("not found"));
});
const mockWriteTextFile = vi.fn((path: string, content: string) => {
  fileStore.set(path, content);
  return Promise.resolve();
});
const mockRemove = vi.fn((path: string) => {
  fileStore.delete(path);
  return Promise.resolve();
});
const mockAppDataDir = vi.fn().mockResolvedValue("/app-data");
const mockJoin = vi.fn((...parts: string[]) =>
  Promise.resolve(parts.join("/"))
);

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: (path: string, opts?: unknown) => mockMkdir(path, opts),
  exists: (path: string) => mockExists(path),
  readTextFile: (path: string) => mockReadTextFile(path),
  writeTextFile: (path: string, content: string) =>
    mockWriteTextFile(path, content),
  remove: (path: string) => mockRemove(path),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => mockAppDataDir(),
  join: (...args: string[]) => mockJoin(...args),
}));

vi.mock("@/utils/debug", () => ({
  historyLog: vi.fn(),
}));

// Partial mock — only override hashPath, keep all real types/helpers
vi.mock("@/utils/historyTypes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/utils/historyTypes")>();
  return {
    ...actual,
    hashPath: vi.fn().mockResolvedValue(HASH),
  };
});

import { createSnapshot, deleteSnapshot } from "../useHistoryOperations";

const DOC_PATH = "/docs/test.md";

const defaultSettings: HistorySettings = {
  maxSnapshots: 50,
  maxAgeDays: 7,
  mergeWindowSeconds: 30,
  maxFileSizeKB: 512,
};

/**
 * Seed the virtual filesystem with an existing index and snapshot files
 */
function seedIndex(
  snapshots: Array<{
    id: string;
    timestamp: number;
    type: string;
    size: number;
    preview: string;
  }>,
  settings: HistorySettings = defaultSettings
) {
  const indexData = JSON.stringify({
    documentPath: DOC_PATH,
    documentName: "test.md",
    pathHash: HASH,
    status: "active",
    deletedAt: null,
    snapshots,
    settings,
  });

  // Seed index file
  fileStore.set(INDEX_PATH, indexData);
  // Seed snapshot files
  for (const s of snapshots) {
    fileStore.set(`${HISTORY_DIR}/${s.id}.md`, "snapshot content");
  }
  // Mark history dir as existing
  fileStore.set(HISTORY_DIR, "");
}

/**
 * Get the last written index from mockWriteTextFile calls
 */
function getLastWrittenIndex(): Record<string, unknown> {
  const indexWrites = mockWriteTextFile.mock.calls.filter(
    (call: unknown[]) =>
      typeof call[0] === "string" &&
      (call[0] as string).endsWith("index.json")
  );
  expect(indexWrites.length).toBeGreaterThan(0);
  return JSON.parse(
    indexWrites[indexWrites.length - 1][1] as string
  ) as Record<string, unknown>;
}

describe("createSnapshot — merge window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fileStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges auto-save within window — removes previous auto snapshot", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 10_000; // 10s ago, within 30s window
    seedIndex([
      {
        id: String(prevTimestamp),
        timestamp: prevTimestamp,
        type: "auto",
        size: 100,
        preview: "old",
      },
    ]);

    await createSnapshot(DOC_PATH, "new content", "auto", defaultSettings);

    // Should have removed the old snapshot file
    expect(mockRemove).toHaveBeenCalledWith(
      `${HISTORY_DIR}/${prevTimestamp}.md`
    );

    // Final index should have only the new snapshot
    const writtenIndex = getLastWrittenIndex();
    const snapshots = writtenIndex.snapshots as Array<{
      type: string;
      timestamp: number;
    }>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].type).toBe("auto");
    expect(snapshots[0].timestamp).toBe(now);
  });

  it("manual save always creates new entry — never merged", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 5_000;
    seedIndex([
      {
        id: String(prevTimestamp),
        timestamp: prevTimestamp,
        type: "auto",
        size: 100,
        preview: "old",
      },
    ]);

    await createSnapshot(DOC_PATH, "manual save", "manual", defaultSettings);

    expect(mockRemove).not.toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });

  it("revert save always creates new entry — never merged", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 5_000;
    seedIndex([
      {
        id: String(prevTimestamp),
        timestamp: prevTimestamp,
        type: "auto",
        size: 100,
        preview: "old",
      },
    ]);

    await createSnapshot(DOC_PATH, "revert save", "revert", defaultSettings);

    expect(mockRemove).not.toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });

  it("auto-save after manual save creates new entry — doesn't merge across types", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 5_000;
    seedIndex([
      {
        id: String(prevTimestamp),
        timestamp: prevTimestamp,
        type: "manual",
        size: 100,
        preview: "manual",
      },
    ]);

    await createSnapshot(
      DOC_PATH,
      "auto after manual",
      "auto",
      defaultSettings
    );

    expect(mockRemove).not.toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });

  it("auto-save outside window creates new entry", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 60_000; // 60s ago, outside 30s window
    seedIndex([
      {
        id: String(prevTimestamp),
        timestamp: prevTimestamp,
        type: "auto",
        size: 100,
        preview: "old",
      },
    ]);

    await createSnapshot(DOC_PATH, "new auto", "auto", defaultSettings);

    expect(mockRemove).not.toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });

  it("mergeWindowSeconds = 0 disables merging — every auto-save creates new entry", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 5_000;
    seedIndex([
      {
        id: String(prevTimestamp),
        timestamp: prevTimestamp,
        type: "auto",
        size: 100,
        preview: "old",
      },
    ]);

    await createSnapshot(DOC_PATH, "new auto", "auto", {
      ...defaultSettings,
      mergeWindowSeconds: 0,
    });

    expect(mockRemove).not.toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });

  it("merges at exact boundary (<=)", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    // Exactly 30s ago = exactly at the 30s window boundary
    const prevTimestamp = now - 30_000;
    seedIndex([
      {
        id: String(prevTimestamp),
        timestamp: prevTimestamp,
        type: "auto",
        size: 100,
        preview: "old",
      },
    ]);

    await createSnapshot(DOC_PATH, "boundary test", "auto", defaultSettings);

    // Should merge — boundary is inclusive (<=)
    expect(mockRemove).toHaveBeenCalledWith(
      `${HISTORY_DIR}/${prevTimestamp}.md`
    );

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(1);
  });

  it("skips merge when clock jumps backward (negative delta)", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    // Future timestamp — simulates clock jump backward
    const futureTimestamp = now + 10_000;
    seedIndex([
      {
        id: String(futureTimestamp),
        timestamp: futureTimestamp,
        type: "auto",
        size: 100,
        preview: "future",
      },
    ]);

    await createSnapshot(DOC_PATH, "after clock jump", "auto", defaultSettings);

    // Should NOT merge — timestamp < lastSnapshot.timestamp
    expect(mockRemove).not.toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });

  it("keeps index entry when merge file deletion fails", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 10_000;
    seedIndex([
      {
        id: String(prevTimestamp),
        timestamp: prevTimestamp,
        type: "auto",
        size: 100,
        preview: "old",
      },
    ]);

    // Make remove fail
    mockRemove.mockRejectedValueOnce(new Error("permission denied"));

    await createSnapshot(DOC_PATH, "new content", "auto", defaultSettings);

    // Should keep both entries (old + new) since deletion failed
    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });
});

describe("createSnapshot — file size guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fileStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips auto-save snapshot when content exceeds maxFileSizeKB", async () => {
    vi.setSystemTime(1700000000000);

    // 600KB content (exceeds 512KB limit)
    const largeContent = "x".repeat(600 * 1024);

    await createSnapshot(DOC_PATH, largeContent, "auto", defaultSettings);

    // Should not write anything
    expect(mockWriteTextFile).not.toHaveBeenCalled();
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it("allows manual save regardless of file size (bypasses guard)", async () => {
    vi.setSystemTime(1700000000000);

    const largeContent = "x".repeat(600 * 1024);

    await createSnapshot(DOC_PATH, largeContent, "manual", defaultSettings);

    // Manual saves bypass the guard — snapshot should be created
    expect(mockWriteTextFile).toHaveBeenCalled();
    const snapshotWrite = mockWriteTextFile.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).endsWith(".md")
    );
    expect(snapshotWrite).toBeDefined();
  });

  it("allows revert save regardless of file size (bypasses guard)", async () => {
    vi.setSystemTime(1700000000000);

    const largeContent = "x".repeat(600 * 1024);

    await createSnapshot(DOC_PATH, largeContent, "revert", defaultSettings);

    // Revert saves bypass the guard — safety snapshot is critical
    expect(mockWriteTextFile).toHaveBeenCalled();
    const snapshotWrite = mockWriteTextFile.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).endsWith(".md")
    );
    expect(snapshotWrite).toBeDefined();
  });

  it("creates snapshot when content is within limit", async () => {
    vi.setSystemTime(1700000000000);

    // 400KB content (within 512KB limit)
    const content = "x".repeat(400 * 1024);

    await createSnapshot(DOC_PATH, content, "auto", defaultSettings);

    // Should have written a snapshot file
    expect(mockWriteTextFile).toHaveBeenCalled();
    const snapshotWrite = mockWriteTextFile.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).endsWith(".md")
    );
    expect(snapshotWrite).toBeDefined();
  });

  it("maxFileSizeKB = 0 disables guard — always creates snapshot", async () => {
    vi.setSystemTime(1700000000000);

    // 1MB content with guard disabled
    const largeContent = "x".repeat(1024 * 1024);

    await createSnapshot(DOC_PATH, largeContent, "auto", {
      ...defaultSettings,
      maxFileSizeKB: 0,
    });

    // Should have written a snapshot file
    expect(mockWriteTextFile).toHaveBeenCalled();
    const snapshotWrite = mockWriteTextFile.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).endsWith(".md")
    );
    expect(snapshotWrite).toBeDefined();
  });

  it("uses byte size not character count for CJK content", async () => {
    vi.setSystemTime(1700000000000);

    // CJK characters are 3 bytes each in UTF-8 but 1 code unit in JS
    // 200 * 1024 CJK chars = ~200KB by char count but ~600KB by byte size
    const cjkContent = "\u4e2d".repeat(200 * 1024);

    await createSnapshot(DOC_PATH, cjkContent, "auto", defaultSettings);

    // Should skip — byte size exceeds 512KB even though char count doesn't
    expect(mockWriteTextFile).not.toHaveBeenCalled();
  });
});

describe("createSnapshot — basic behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fileStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates snapshot for new document (no existing index)", async () => {
    vi.setSystemTime(1700000000000);

    await createSnapshot(DOC_PATH, "Hello world", "manual", defaultSettings);

    expect(mockWriteTextFile).toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    const snapshots = writtenIndex.snapshots as Array<{
      timestamp: number;
      type: string;
      id: string;
    }>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].type).toBe("manual");
    expect(snapshots[0].timestamp).toBe(1700000000000);
    // ID contains timestamp + random suffix
    expect(snapshots[0].id).toMatch(/^1700000000000-/);
  });

  it("generates unique snapshot IDs (collision safety)", async () => {
    vi.setSystemTime(1700000000000);

    await createSnapshot(DOC_PATH, "First", "manual", defaultSettings);

    const firstIndex = getLastWrittenIndex();
    const firstSnapshots = firstIndex.snapshots as Array<{ id: string }>;
    const firstId = firstSnapshots[0].id;

    // Same timestamp, different random suffix
    await createSnapshot(DOC_PATH, "Second", "manual", defaultSettings);

    const secondIndex = getLastWrittenIndex();
    const secondSnapshots = secondIndex.snapshots as Array<{ id: string }>;
    // Two snapshots should have different IDs despite same timestamp
    expect(secondSnapshots).toHaveLength(2);
    expect(secondSnapshots[0].id).toBe(firstId); // first unchanged
    expect(secondSnapshots[1].id).not.toBe(firstId); // second is different
  });
});

describe("deleteSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fileStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes snapshot file and updates index", async () => {
    vi.setSystemTime(1700000000000);

    seedIndex([
      { id: "snap-1", timestamp: 1000, type: "auto", size: 10, preview: "a" },
      { id: "snap-2", timestamp: 2000, type: "auto", size: 10, preview: "b" },
      { id: "snap-3", timestamp: 3000, type: "auto", size: 10, preview: "c" },
    ]);

    await deleteSnapshot(DOC_PATH, "snap-2");

    // Snapshot file should be removed
    expect(mockRemove).toHaveBeenCalledWith(`${HISTORY_DIR}/snap-2.md`);

    // Index should have 2 remaining snapshots
    const writtenIndex = getLastWrittenIndex();
    const snapshots = writtenIndex.snapshots as Array<{ id: string }>;
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.id)).toEqual(["snap-1", "snap-3"]);
  });

  it("no-ops when document has no history", async () => {
    // No index seeded — empty fileStore
    await deleteSnapshot(DOC_PATH, "snap-1");

    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockWriteTextFile).not.toHaveBeenCalled();
  });

  it("no-ops when snapshot ID not found", async () => {
    seedIndex([
      { id: "snap-1", timestamp: 1000, type: "auto", size: 10, preview: "a" },
    ]);

    await deleteSnapshot(DOC_PATH, "nonexistent");

    // Should not remove any file or rewrite index
    expect(mockRemove).not.toHaveBeenCalled();
    // Index should not be rewritten when nothing changed
    const indexWrites = mockWriteTextFile.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).endsWith("index.json")
    );
    expect(indexWrites).toHaveLength(0);
  });

  it("tolerates missing snapshot file", async () => {
    seedIndex([
      { id: "snap-1", timestamp: 1000, type: "auto", size: 10, preview: "a" },
    ]);
    // Remove the snapshot file from fileStore so remove() would fail
    fileStore.delete(`${HISTORY_DIR}/snap-1.md`);
    mockRemove.mockRejectedValueOnce(new Error("not found"));

    await deleteSnapshot(DOC_PATH, "snap-1");

    // Index should still be updated (snapshot removed from index)
    const writtenIndex = getLastWrittenIndex();
    const snapshots = writtenIndex.snapshots as Array<{ id: string }>;
    expect(snapshots).toHaveLength(0);
  });

  it("handles deleting last remaining snapshot", async () => {
    seedIndex([
      { id: "snap-only", timestamp: 1000, type: "manual", size: 10, preview: "x" },
    ]);

    await deleteSnapshot(DOC_PATH, "snap-only");

    expect(mockRemove).toHaveBeenCalledWith(`${HISTORY_DIR}/snap-only.md`);

    const writtenIndex = getLastWrittenIndex();
    const snapshots = writtenIndex.snapshots as Array<{ id: string }>;
    expect(snapshots).toHaveLength(0);
  });
});
