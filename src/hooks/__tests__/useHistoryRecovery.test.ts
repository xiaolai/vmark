/**
 * Tests for useHistoryRecovery — deleteDocumentHistory and clearWorkspaceHistory
 *
 * @module hooks/__tests__/useHistoryRecovery.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { HASH_A, HASH_B, HASH_C } = vi.hoisted(() => ({
  HASH_A: "hash_aaa",
  HASH_B: "hash_bbb",
  HASH_C: "hash_ccc",
}));

const BASE_DIR = "/app-data/history";

// Virtual filesystem
const fileStore = new Map<string, string>();

const mockExists = vi.fn((path: string) =>
  Promise.resolve(fileStore.has(path))
);
const mockReadTextFile = vi.fn((path: string) => {
  const content = fileStore.get(path);
  if (content !== undefined) return Promise.resolve(content);
  return Promise.reject(new Error("not found"));
});
const mockRemove = vi.fn((path: string, _opts?: unknown) => {
  // Remove this path and any paths that start with it (recursive)
  for (const key of fileStore.keys()) {
    if (key === path || key.startsWith(path + "/")) {
      fileStore.delete(key);
    }
  }
  return Promise.resolve();
});
const mockReadDir = vi.fn((_path: string) => {
  // Return directory entries under BASE_DIR
  const entries: Array<{ name: string; isDirectory: boolean }> = [];
  const seen = new Set<string>();
  for (const key of fileStore.keys()) {
    if (key.startsWith(BASE_DIR + "/")) {
      const rest = key.slice(BASE_DIR.length + 1);
      const dirName = rest.split("/")[0];
      if (!seen.has(dirName)) {
        seen.add(dirName);
        entries.push({ name: dirName, isDirectory: true });
      }
    }
  }
  return Promise.resolve(entries);
});

const mockJoin = vi.fn((...parts: string[]) =>
  Promise.resolve(parts.join("/"))
);
const mockAppDataDir = vi.fn().mockResolvedValue("/app-data");

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (path: string) => mockExists(path),
  readTextFile: (path: string) => mockReadTextFile(path),
  readDir: (path: string) => mockReadDir(path),
  remove: (path: string, opts?: unknown) => mockRemove(path, opts),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => mockAppDataDir(),
  join: (...args: string[]) => mockJoin(...args),
}));

vi.mock("@/utils/debug", () => ({
  historyLog: vi.fn(),
}));

// Track which hash each doc path maps to
const hashMap: Record<string, string> = {};

vi.mock("@/utils/historyTypes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/utils/historyTypes")>();
  return {
    ...actual,
    hashPath: vi.fn((path: string) => Promise.resolve(hashMap[path] || "unknown")),
  };
});

import {
  deleteDocumentHistory,
  clearWorkspaceHistory,
} from "../useHistoryRecovery";

function seedHistory(
  hash: string,
  documentPath: string,
  snapshotCount: number = 1
) {
  hashMap[documentPath] = hash;
  const historyDir = `${BASE_DIR}/${hash}`;
  const snapshots = Array.from({ length: snapshotCount }, (_, i) => ({
    id: `snap-${i}`,
    timestamp: 1000 + i,
    type: "auto",
    size: 10,
    preview: `preview-${i}`,
  }));
  const index = JSON.stringify({
    documentPath,
    documentName: documentPath.split("/").pop(),
    pathHash: hash,
    status: "active",
    deletedAt: null,
    snapshots,
    settings: { maxSnapshots: 50, maxAgeDays: 7, mergeWindowSeconds: 30, maxFileSizeKB: 512 },
  });
  fileStore.set(historyDir, "");
  fileStore.set(`${historyDir}/index.json`, index);
  for (let i = 0; i < snapshotCount; i++) {
    fileStore.set(`${historyDir}/snap-${i}.md`, "content");
  }
  // Mark base dir as existing
  fileStore.set(BASE_DIR, "");
}

describe("deleteDocumentHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileStore.clear();
    Object.keys(hashMap).forEach((k) => delete hashMap[k]);
  });

  it("computes hash and deletes history directory", async () => {
    seedHistory(HASH_A, "/docs/file-a.md", 3);

    await deleteDocumentHistory("/docs/file-a.md");

    expect(mockRemove).toHaveBeenCalledWith(
      `${BASE_DIR}/${HASH_A}`,
      { recursive: true }
    );
  });

  it("no-ops when history does not exist", async () => {
    hashMap["/docs/no-history.md"] = "nonexistent";
    // No history seeded

    await deleteDocumentHistory("/docs/no-history.md");

    // remove should not be called (directory doesn't exist)
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe("clearWorkspaceHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileStore.clear();
    Object.keys(hashMap).forEach((k) => delete hashMap[k]);
  });

  it("deletes histories for documents within workspace root", async () => {
    seedHistory(HASH_A, "/workspace/doc1.md", 2);
    seedHistory(HASH_B, "/workspace/sub/doc2.md", 1);
    seedHistory(HASH_C, "/other/doc3.md", 1);

    const count = await clearWorkspaceHistory("/workspace");

    expect(count).toBe(2);
    // A and B deleted, C remains
    expect(mockRemove).toHaveBeenCalledWith(`${BASE_DIR}/${HASH_A}`, { recursive: true });
    expect(mockRemove).toHaveBeenCalledWith(`${BASE_DIR}/${HASH_B}`, { recursive: true });
    expect(mockRemove).not.toHaveBeenCalledWith(
      `${BASE_DIR}/${HASH_C}`,
      expect.anything()
    );
  });

  it("returns 0 when no history exists", async () => {
    // No history seeded, base dir doesn't exist
    const count = await clearWorkspaceHistory("/workspace");
    expect(count).toBe(0);
  });

  it("returns 0 when no documents match workspace", async () => {
    seedHistory(HASH_A, "/other/doc.md", 1);

    const count = await clearWorkspaceHistory("/workspace");
    expect(count).toBe(0);
  });

  it("handles Windows backslash paths", async () => {
    seedHistory(HASH_A, "C:\\Users\\doc.md", 1);

    const count = await clearWorkspaceHistory("C:\\Users");

    expect(count).toBe(1);
  });

  it("rejects prefix-match that crosses path boundary", async () => {
    seedHistory(HASH_A, "/Users/rootother/doc.md", 1);

    const count = await clearWorkspaceHistory("/Users/root");

    // Should NOT match — /Users/root is not a parent of /Users/rootother
    expect(count).toBe(0);
  });
});
