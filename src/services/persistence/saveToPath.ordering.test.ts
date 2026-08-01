/**
 * Concurrent saves to ONE path must not land out of order.
 *
 * A debounced auto-save and a manual save can be in flight together — that is
 * ordinary, not exotic. Nothing ordered their `atomic_write_file` calls, so if
 * the OLDER write completed second it won on disk, and `applyPostSaveState`
 * then recorded its content as the saved snapshot. The document showed clean
 * against bytes the user had already replaced. The pending-save token
 * protected cleanup bookkeeping; it never ordered writes.
 *
 * Saves to DIFFERENT paths must stay concurrent — serializing every save in
 * the app behind one queue would make a multi-document save as slow as the
 * slowest disk.
 *
 * @coordinates-with services/persistence/saveToPath.ts
 * @coordinates-with services/persistence/serializeByPath.ts
 * @module services/persistence/saveToPath.ordering.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke, mockMarkSaved, mockMarkAutoSaved, snapshotOrder } = vi.hoisted(() => {
  const snapshotOrder: string[] = [];
  const record = (_tab: string, snaps: { editorSnapshot: string }) =>
    snapshotOrder.push(snaps.editorSnapshot);
  return {
    mockInvoke: vi.fn(),
    // An AUTO save records through markAutoSaved, a manual one through
    // markSaved. Watching only one of them makes an ordering assertion vacuous.
    mockMarkSaved: vi.fn(record),
    mockMarkAutoSaved: vi.fn(record),
    snapshotOrder,
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@/services/history/historyOperations", () => ({ createSnapshot: vi.fn() }));
vi.mock("@/services/coherence/captureFunnel", () => ({ captureWrite: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: vi.fn(() => Symbol("token")),
  clearPendingSave: vi.fn(),
}));
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      setFilePath: vi.fn(),
      markSaved: mockMarkSaved,
      markAutoSaved: mockMarkAutoSaved,
      setLineMetadata: vi.fn(),
      markMissing: vi.fn(),
      getDocument: () => ({
        filePath: "/w/a.md",
        lineEnding: "lf",
        hardBreakStyle: "unknown",
        hasBom: false,
      }),
    }),
  },
}));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ updateTabPath: vi.fn(), findTabById: () => ({ id: "t" }) }) },
}));
vi.mock("@/stores/workspaceStore", () => ({
  useRecentFilesStore: { getState: () => ({ addFile: vi.fn() }) },
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      general: {
        lineEndingsOnSave: "preserve",
        historyEnabled: false,
        coherenceCaptureOnSave: false,
      },
      markdown: { hardBreakStyleOnSave: "preserve" },
    }),
    subscribe: vi.fn(),
  },
}));
vi.mock("@/services/workspaces/fileOwnership", () => ({
  resolveWritableFileOwnership: () => ({ ok: true, conflicts: [] }),
  showFileOwnershipConflictToast: vi.fn(),
}));

import { saveToPath } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";

/** A promise plus its resolve handle. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  snapshotOrder.length = 0;
  __resetSerializer();
  mockInvoke.mockResolvedValue(undefined);
});

describe("two saves to the same path", () => {
  it("writes them in submission order even when the first is slower", async () => {
    // Without serialization: OLD resolves after NEW, so disk ends with OLD.
    const slow = deferred();
    const writes: string[] = [];
    mockInvoke.mockImplementation(async (_cmd: string, args: { content: string }) => {
      if (args.content.includes("OLD")) await slow.promise;
      writes.push(args.content);
    });

    const first = saveToPath("t", "/w/a.md", "OLD\n", "auto");
    const second = saveToPath("t", "/w/a.md", "NEW\n", "manual");

    slow.resolve();
    await Promise.all([first, second]);

    expect(writes).toEqual(["OLD\n", "NEW\n"]);
    // The LAST write wins on disk, and it is the newer content.
    expect(writes[writes.length - 1]).toBe("NEW\n");
  });

  it("records the newer content as the saved snapshot, not the older", async () => {
    // The second half of the defect: even when disk ends correct, a late
    // applyPostSaveState from the older save marked the doc clean against
    // content the user had already replaced.
    const slow = deferred();
    mockInvoke.mockImplementation(async (_cmd: string, args: { content: string }) => {
      if (args.content.includes("OLD")) await slow.promise;
    });

    const first = saveToPath("t", "/w/a.md", "OLD\n", "auto");
    const second = saveToPath("t", "/w/a.md", "NEW\n", "manual");
    slow.resolve();
    await Promise.all([first, second]);

    // Both writers observed, in real completion order.
    expect(snapshotOrder).toEqual(["OLD\n", "NEW\n"]);
    expect(snapshotOrder.at(-1)).toBe("NEW\n");
  });

  it("does not start the second write until the first has finished", async () => {
    const gate = deferred();
    let concurrent = 0;
    let maxConcurrent = 0;
    mockInvoke.mockImplementation(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await gate.promise;
      concurrent -= 1;
    });

    const a = saveToPath("t", "/w/a.md", "1\n", "auto");
    const b = saveToPath("t", "/w/a.md", "2\n", "auto");
    gate.resolve();
    await Promise.all([a, b]);

    expect(maxConcurrent).toBe(1);
  });

  it("a failed save does not block the next save to that file", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("EACCES"));

    await expect(saveToPath("t", "/w/a.md", "1\n", "manual")).resolves.toBe(false);
    await expect(saveToPath("t", "/w/a.md", "2\n", "manual")).resolves.toBe(true);
  });

  it("serializes spellings that normalizePath unifies (separators, trailing slash)", async () => {
    // The queue keys on `normalizePath`, the same path identity the pending-save
    // registry and the fs-event router use. It unifies separators, Windows
    // drive-letter case, and trailing slashes — it does NOT resolve "." or ".."
    // segments, so `/w/./a.md` is a different key. That is a deliberate
    // limitation of the shared definition, not of the queue: fixing it here
    // alone would make the save queue disagree with the watcher about which
    // file it is looking at, which is worse than the narrow gap it closes.
    const writes: string[] = [];
    const slow = deferred();
    mockInvoke.mockImplementation(async (_cmd: string, args: { content: string }) => {
      if (args.content.includes("OLD")) await slow.promise;
      writes.push(args.content);
    });

    const first = saveToPath("t", "\\w\\a.md", "OLD\n", "auto");
    const second = saveToPath("t", "/w/a.md", "NEW\n", "manual");
    slow.resolve();
    await Promise.all([first, second]);

    expect(writes).toEqual(["OLD\n", "NEW\n"]);
  });
});

describe("saves to different paths", () => {
  it("still run concurrently — one slow disk must not stall the others", async () => {
    const gate = deferred();
    let bFinished = false;
    mockInvoke.mockImplementation(async (_cmd: string, args: { path: string }) => {
      if (args.path === "/w/a.md") await gate.promise;
      else bFinished = true;
    });

    const a = saveToPath("t", "/w/a.md", "A\n", "manual");
    await saveToPath("t2", "/w/b.md", "B\n", "manual");

    expect(bFinished).toBe(true); // did not wait on /w/a.md
    gate.resolve();
    await a;
  });
});
