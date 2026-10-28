// @vitest-environment node
/**
 * A history index write that fails must never leave the index naming a
 * snapshot file that is gone. A file no longer referenced is removed only
 * after the index that drops it has been written; a failed write leaves the
 * old index, and every file it names, in place.
 *
 * Runs the real operations against the in-memory filesystem, with the index
 * write failing once.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HistoryIndex, HistorySettings, Snapshot } from "@/utils/historyTypes";

vi.mock("@tauri-apps/plugin-fs", async () => (await import("./historyTestFs")).pluginFsMock);
vi.mock("@tauri-apps/api/path", async () => (await import("./historyTestFs")).pathApiMock);
vi.mock("@/utils/debug", () => ({ historyLog: vi.fn(), historyError: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/utils/historyTypes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/historyTypes")>()),
  hashPath: async () => "hdoc",
}));

import { APP_DATA_DIR, vfs } from "./historyTestFs";
import { createSnapshot, deleteSnapshot, pruneSnapshots } from "../historyOperations";

const DOC = "/work/notes.md";
const DIR = `${APP_DATA_DIR}/history/hdoc`;
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const settings: HistorySettings = { maxSnapshots: 50, maxAgeDays: 7, mergeWindowSeconds: 30, maxFileSizeKB: 0 };

beforeEach(() => {
  vi.setSystemTime(NOW);
  vfs.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

function seed(snapshots: Array<Pick<Snapshot, "id" | "type"> & { ageMs: number }>, indexSettings = settings): void {
  const index: HistoryIndex = {
    documentPath: DOC,
    documentName: "notes.md",
    pathHash: "hdoc",
    status: "active",
    deletedAt: null,
    snapshots: snapshots.map((s) => ({ id: s.id, type: s.type, timestamp: NOW - s.ageMs, size: 1, preview: s.id })),
    settings: indexSettings,
  };
  vfs.seed(`${DIR}/index.json`, JSON.stringify(index));
  for (const s of snapshots) vfs.seed(`${DIR}/${s.id}.md`, s.id);
}

/** Every snapshot the index names, missing its file. */
function danglingEntries(): string[] {
  const raw = vfs.read(`${DIR}/index.json`);
  if (raw === undefined) throw new Error("no index");
  const index = JSON.parse(raw) as HistoryIndex;
  return index.snapshots.map((s) => s.id).filter((id) => !vfs.has(`${DIR}/${id}.md`));
}

// The new index is written beside the old one, then renamed over it.
const indexWriteFails = () => vfs.failNext("writeTextFile", "/index.json.tmp", new Error("disk full"));

describe("a failed index write leaves no index entry without its file", () => {
  it("merging an autosave into the previous one", async () => {
    seed([{ id: "prev", type: "auto", ageMs: 5_000 }]);
    indexWriteFails();
    await expect(createSnapshot(DOC, "# New", "auto", settings)).rejects.toThrow("disk full");
    expect(danglingEntries()).toEqual([]);
  });

  it("pruning past the snapshot limit", async () => {
    seed(
      [
        { id: "a", type: "auto", ageMs: 3_000 },
        { id: "b", type: "auto", ageMs: 2_000 },
        { id: "c", type: "auto", ageMs: 1_000 },
      ],
      { ...settings, maxSnapshots: 1 },
    );
    indexWriteFails();
    await expect(pruneSnapshots(DOC)).rejects.toThrow("disk full");
    expect(danglingEntries()).toEqual([]);
  });

  it("deleting one snapshot", async () => {
    seed([
      { id: "keep", type: "manual", ageMs: 2_000 },
      { id: "drop", type: "manual", ageMs: 1_000 },
    ]);
    indexWriteFails();
    await expect(deleteSnapshot(DOC, "drop")).rejects.toThrow("disk full");
    expect(danglingEntries()).toEqual([]);
  });

  it("still removes the files once the index that drops them is written", async () => {
    seed([
      { id: "a", type: "auto", ageMs: 3_000 },
      { id: "b", type: "auto", ageMs: 2_000 },
    ], { ...settings, maxSnapshots: 1 });
    await pruneSnapshots(DOC);
    await deleteSnapshot(DOC, "b");
    expect(vfs.filesIn(DIR)).toEqual(["index.json"]);
  });
});
