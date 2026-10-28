// @vitest-environment node
/**
 * History integrity against the real operations on the in-memory filesystem:
 *   - the index file is replaced in one step, so it is never seen torn;
 *   - a prune or delete whose index write fails reports the failure;
 *   - a new snapshot never takes an id (and so a file) another one holds;
 *   - a corrupt retention setting in the index cannot make a prune delete
 *     snapshots it should keep.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HistoryIndex, HistorySettings } from "@/utils/historyTypes";

vi.mock("@tauri-apps/plugin-fs", async () => (await import("./historyTestFs")).pluginFsMock);
vi.mock("@tauri-apps/api/path", async () => (await import("./historyTestFs")).pathApiMock);
vi.mock("@/utils/debug", () => ({ historyLog: vi.fn(), historyError: vi.fn(), historyWarn: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/utils/historyTypes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/historyTypes")>()),
  hashPath: async () => "hdoc",
}));

import { APP_DATA_DIR, vfs } from "./historyTestFs";
import { createSnapshot, deleteSnapshot, pruneSnapshots } from "../historyOperations";

const DOC = "/work/notes.md";
const DIR = `${APP_DATA_DIR}/history/hdoc`;
const INDEX = `${DIR}/index.json`;
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const settings: HistorySettings = { maxSnapshots: 50, maxAgeDays: 7, mergeWindowSeconds: 0, maxFileSizeKB: 0 };

beforeEach(() => {
  vi.setSystemTime(NOW);
  vfs.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function seed(ids: string[], indexSettings: Record<string, unknown> = { ...settings }): void {
  const index = {
    documentPath: DOC,
    documentName: "notes.md",
    pathHash: "hdoc",
    status: "active",
    deletedAt: null,
    snapshots: ids.map((id, i) => ({ id, type: "manual", timestamp: NOW - (ids.length - i) * 1000, size: 1, preview: id })),
    settings: indexSettings,
  };
  vfs.seed(INDEX, JSON.stringify(index));
  for (const id of ids) vfs.seed(`${DIR}/${id}.md`, id);
}

function readIndex(): HistoryIndex {
  const raw = vfs.read(INDEX);
  if (raw === undefined) throw new Error("no index");
  return JSON.parse(raw) as HistoryIndex;
}

describe("the index is published in one step", () => {
  it("is never empty or torn while an update is written", async () => {
    seed(["a"]);
    const seen: Array<string | undefined> = [];
    vfs.setTruncatedWindow(2, () => seen.push(vfs.read(INDEX)));
    await createSnapshot(DOC, "# New", "manual", settings);
    expect(seen.length).toBeGreaterThan(0);
    for (const content of seen) expect(() => JSON.parse(content ?? "")).not.toThrow();
    expect(readIndex().snapshots).toHaveLength(2);
  });
});

describe("a failed index write is reported", () => {
  const indexPublishFails = () => vfs.failNext("rename", "/index.json", new Error("disk full"));

  it("by pruneSnapshots, keeping every file the index names", async () => {
    seed(["a", "b"], { ...settings, maxSnapshots: 1 });
    indexPublishFails();
    await expect(pruneSnapshots(DOC)).rejects.toThrow("disk full");
    expect(readIndex().snapshots.map((s) => s.id)).toEqual(["a", "b"]);
    expect(vfs.has(`${DIR}/a.md`)).toBe(true);
  });

  it("by deleteSnapshot, keeping the entry and its file", async () => {
    seed(["a", "b"]);
    indexPublishFails();
    await expect(deleteSnapshot(DOC, "b")).rejects.toThrow("disk full");
    expect(readIndex().snapshots.map((s) => s.id)).toEqual(["a", "b"]);
    expect(vfs.has(`${DIR}/b.md`)).toBe(true);
  });
});

describe("snapshot ids never collide", () => {
  it("two snapshots in the same millisecond with the same random draw get distinct ids and files", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID");
    uuid.mockReturnValueOnce("00000000-0000-4000-8000-000000000001");
    uuid.mockReturnValueOnce("00000000-0000-4000-8000-000000000001");
    uuid.mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    await createSnapshot(DOC, "first", "manual", settings);
    await createSnapshot(DOC, "second", "manual", settings);
    const ids = readIndex().snapshots.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    const contents = ids.map((id) => vfs.read(`${DIR}/${id}.md`)).sort();
    expect(contents).toEqual(["first", "second"]);
  });
});

describe("a corrupt retention setting cannot delete snapshots", () => {
  it.each([
    ["a negative age limit", { maxAgeDays: -1 }],
    ["a zero age limit", { maxAgeDays: 0 }],
    ["a negative snapshot limit", { maxSnapshots: -5 }],
  ])("prune with %s keeps recent snapshots", async (_name, over) => {
    seed(["a", "b"], { ...settings, ...over });
    await pruneSnapshots(DOC);
    expect(readIndex().snapshots.map((s) => s.id)).toEqual("maxSnapshots" in over ? ["b"] : ["a", "b"]);
    expect(vfs.has(`${DIR}/b.md`)).toBe(true);
  });
});
