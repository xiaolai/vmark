/**
 * Tests for useHistoryOperations — createSnapshot merge window and file size guard
 *
 * @module hooks/__tests__/useHistoryOperations.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HistorySettings } from "@/utils/historyTypes";

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
  writeTextFile: (path: string, content: string) => mockWriteTextFile(path, content),
  remove: (path: string) => mockRemove(path),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => mockAppDataDir(),
  join: (a: string, b: string) => mockJoin(a, b),
}));

vi.mock("@/utils/debug", () => ({
  historyLog: vi.fn(),
}));

import { createSnapshot } from "../useHistoryOperations";

const DOC_PATH = "/docs/test.md";

const defaultSettings: HistorySettings = {
  maxSnapshots: 50,
  maxAgeDays: 7,
  mergeWindowSeconds: 30,
  maxFileSizeKB: 512,
};

/**
 * Helper: seed the virtual filesystem with an existing index
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
  // The index path constructed by the code (appDataDir + history + hash + index.json)
  // Since mockJoin concatenates with "/", and hashPath returns a hex hash,
  // we need to pre-seed all paths that the code will construct.
  // We seed the index and snapshot files using a known hash path prefix.
  const indexData = JSON.stringify({
    documentPath: DOC_PATH,
    documentName: "test.md",
    pathHash: "abc123",
    status: "active",
    deletedAt: null,
    snapshots,
    settings,
  });

  // We need to figure out the actual path. Since mockJoin just joins with "/",
  // and hashPath generates a real SHA-256 hash, we can't predict the exact path.
  // Instead, let's intercept by storing based on suffix matching.

  // Actually, let's compute it: the code calls:
  // appDataDir() -> "/app-data"
  // join("/app-data", "history") -> "/app-data/history"
  // hashPath(DOC_PATH) -> real hash of DOC_PATH
  // join("/app-data/history", hash) -> "/app-data/history/<hash>"
  // join(historyDir, "index.json") -> "/app-data/history/<hash>/index.json"

  // We need to compute the actual hash. Since hashPath uses crypto.subtle,
  // we can't easily pre-compute it. Let's use a different approach:
  // override mockReadTextFile to check for index.json suffix.

  // Reset the mocks to use suffix-based matching
  mockExists.mockImplementation((path: string) => {
    if (path.endsWith("index.json")) return Promise.resolve(true);
    if (path.endsWith(".md")) {
      // Check if any snapshot file exists
      for (const s of snapshots) {
        if (path.endsWith(`${s.id}.md`)) return Promise.resolve(true);
      }
    }
    // History dir exists
    return Promise.resolve(true);
  });

  // Track writes for index.json to keep reads fresh
  let currentIndex = indexData;
  const writtenFiles = new Map<string, string>();

  mockReadTextFile.mockImplementation((path: string) => {
    // Return latest written version if available
    if (writtenFiles.has(path)) return Promise.resolve(writtenFiles.get(path)!);
    if (path.endsWith("index.json")) return Promise.resolve(currentIndex);
    return Promise.reject(new Error("not found"));
  });

  mockWriteTextFile.mockImplementation((path: string, content: string) => {
    writtenFiles.set(path, content);
    if (path.endsWith("index.json")) currentIndex = content;
    return Promise.resolve();
  });

  mockRemove.mockImplementation((path: string) => {
    writtenFiles.delete(path);
    return Promise.resolve();
  });
}

/**
 * Get the last written index from mockWriteTextFile calls
 */
function getLastWrittenIndex(): Record<string, unknown> {
  const indexWrites = mockWriteTextFile.mock.calls.filter(
    (call: unknown[]) =>
      typeof call[0] === "string" && (call[0] as string).endsWith("index.json")
  );
  expect(indexWrites.length).toBeGreaterThan(0);
  return JSON.parse(indexWrites[indexWrites.length - 1][1] as string) as Record<string, unknown>;
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
      { id: String(prevTimestamp), timestamp: prevTimestamp, type: "auto", size: 100, preview: "old" },
    ]);

    await createSnapshot(DOC_PATH, "new content", "auto", defaultSettings);

    // Should have removed the old snapshot file
    expect(mockRemove).toHaveBeenCalledWith(
      expect.stringContaining(`${prevTimestamp}.md`)
    );

    // Final index should have only the new snapshot
    const writtenIndex = getLastWrittenIndex();
    const snapshots = writtenIndex.snapshots as Array<{ type: string; timestamp: number }>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].type).toBe("auto");
    expect(snapshots[0].timestamp).toBe(now);
  });

  it("manual save always creates new entry — never merged", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 5_000;
    seedIndex([
      { id: String(prevTimestamp), timestamp: prevTimestamp, type: "auto", size: 100, preview: "old" },
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
      { id: String(prevTimestamp), timestamp: prevTimestamp, type: "auto", size: 100, preview: "old" },
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
      { id: String(prevTimestamp), timestamp: prevTimestamp, type: "manual", size: 100, preview: "manual" },
    ]);

    await createSnapshot(DOC_PATH, "auto after manual", "auto", defaultSettings);

    expect(mockRemove).not.toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });

  it("auto-save outside window creates new entry", async () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    const prevTimestamp = now - 60_000; // 60s ago, outside 30s window
    seedIndex([
      { id: String(prevTimestamp), timestamp: prevTimestamp, type: "auto", size: 100, preview: "old" },
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
      { id: String(prevTimestamp), timestamp: prevTimestamp, type: "auto", size: 100, preview: "old" },
    ]);

    await createSnapshot(DOC_PATH, "new auto", "auto", {
      ...defaultSettings,
      mergeWindowSeconds: 0,
    });

    expect(mockRemove).not.toHaveBeenCalled();

    const writtenIndex = getLastWrittenIndex();
    expect(writtenIndex.snapshots as unknown[]).toHaveLength(2);
  });
});

describe("createSnapshot — file size guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fileStore.clear();
    // Default: no existing files
    mockExists.mockResolvedValue(false);
    mockReadTextFile.mockRejectedValue(new Error("not found"));
    mockWriteTextFile.mockImplementation((path: string, content: string) => {
      fileStore.set(path, content);
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips snapshot when content exceeds maxFileSizeKB", async () => {
    vi.setSystemTime(1700000000000);

    // 600KB content (exceeds 512KB limit)
    const largeContent = "x".repeat(600 * 1024);

    await createSnapshot(DOC_PATH, largeContent, "auto", defaultSettings);

    // Should not write anything
    expect(mockWriteTextFile).not.toHaveBeenCalled();
    expect(mockMkdir).not.toHaveBeenCalled();
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
});

describe("createSnapshot — basic behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fileStore.clear();
    mockExists.mockResolvedValue(false);
    mockReadTextFile.mockRejectedValue(new Error("not found"));
    mockWriteTextFile.mockImplementation((path: string, content: string) => {
      fileStore.set(path, content);
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates snapshot for new document (no existing index)", async () => {
    vi.setSystemTime(1700000000000);

    await createSnapshot(DOC_PATH, "Hello world", "manual", defaultSettings);

    expect(mockWriteTextFile).toHaveBeenCalled();

    const indexWrites = mockWriteTextFile.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).endsWith("index.json")
    );
    expect(indexWrites.length).toBeGreaterThan(0);
    const writtenIndex = JSON.parse(
      indexWrites[indexWrites.length - 1][1] as string
    );
    expect(writtenIndex.snapshots).toHaveLength(1);
    expect(writtenIndex.snapshots[0].type).toBe("manual");
    expect(writtenIndex.snapshots[0].timestamp).toBe(1700000000000);
  });
});
