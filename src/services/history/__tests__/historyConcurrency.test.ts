// @vitest-environment node
// WI-RA10A.13 — every mutation of a document's history is one step: two of
// them never interleave, so the index never loses an entry, keeps a deleted
// one, or points at a file that is gone.
/**
 * The history index is read, changed in memory and written back. Nothing
 * ordered two such cycles: a revert from the History sidebar and the snapshot
 * of an autosave both read the same index, each added its own entry, and the
 * second write discarded the first — leaving a snapshot file no index entry
 * names.
 *
 * Runs the real operations against an in-memory filesystem whose calls are
 * asynchronous, so the interleaving is the one production has.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HistoryIndex, HistorySettings, Snapshot } from "@/utils/historyTypes";

vi.mock("@tauri-apps/plugin-fs", async () => (await import("./historyTestFs")).pluginFsMock);
vi.mock("@tauri-apps/api/path", async () => (await import("./historyTestFs")).pathApiMock);
vi.mock("@/utils/debug", () => ({
  historyLog: vi.fn(),
  historyError: vi.fn(),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
// The real hash runs on a worker thread and settles in a later turn of the
// event loop, which would make every interleaving below depend on its timing.
// A promise that settles in order keeps the schedule deterministic; one
// directory per path is all the code under test asks of a hash.
vi.mock("@/utils/historyTypes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/historyTypes")>()),
  hashPath: async (documentPath: string) => testHash(documentPath),
}));

import { APP_DATA_DIR, vfs } from "./historyTestFs";
import {
  createSnapshot,
  deleteSnapshot,
  getSnapshots,
  pruneSnapshots,
  revertToSnapshot,
} from "../historyOperations";
import {
  clearAllHistory,
  clearWorkspaceHistory,
  deleteDocumentHistory,
} from "../historyRecovery";

const DOC = "/work/notes.md";
const OTHER_DOC = "/elsewhere/other.md";
const BASE = `${APP_DATA_DIR}/history`;

const settings: HistorySettings = {
  maxSnapshots: 50,
  maxAgeDays: 7,
  mergeWindowSeconds: 30,
  maxFileSizeKB: 0,
};

/** Hoisted with the mock factory that calls it. */
function testHash(documentPath: string): string {
  return `h${documentPath.replace(/[^a-z0-9]/gi, "_")}`;
}

const docDir = `${BASE}/${testHash(DOC)}`;
const otherDir = `${BASE}/${testHash(OTHER_DOC)}`;

/** The fixed "now" every test runs at; snapshot ages are measured from it. */
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

beforeEach(() => {
  vi.setSystemTime(NOW);
  vfs.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

function seedHistory(
  dir: string,
  documentPath: string,
  snapshots: Array<Pick<Snapshot, "id" | "type"> & { content: string; ageMs?: number }>,
  indexSettings: HistorySettings = settings,
): void {
  const index: HistoryIndex = {
    documentPath,
    documentName: documentPath.split("/").pop() ?? "",
    pathHash: dir.slice(BASE.length + 1),
    status: "active",
    deletedAt: null,
    snapshots: snapshots.map((s, i) => ({
      id: s.id,
      type: s.type,
      timestamp: NOW - (s.ageMs ?? (snapshots.length - i) * 60_000),
      size: s.content.length,
      preview: s.content,
    })),
    settings: indexSettings,
  };
  vfs.seed(`${dir}/index.json`, JSON.stringify(index));
  for (const s of snapshots) vfs.seed(`${dir}/${s.id}.md`, s.content);
}

function readIndex(dir: string): HistoryIndex {
  const raw = vfs.read(`${dir}/index.json`);
  if (raw === undefined) throw new Error(`no index in ${dir}`);
  return JSON.parse(raw) as HistoryIndex;
}

/** The index and the snapshot files describe each other exactly. */
function expectConsistent(dir: string): void {
  const indexed = readIndex(dir).snapshots.map((s) => `${s.id}.md`).sort();
  const onDisk = vfs.filesIn(dir).filter((name) => name !== "index.json");
  expect(onDisk).toEqual(indexed);
}

const typesIn = (dir: string) => readIndex(dir).snapshots.map((s) => s.type).sort();

describe("mutations of one document's history do not interleave", () => {
  it("a revert racing an autosave snapshot keeps both entries and orphans no file", async () => {
    seedHistory(docDir, DOC, [{ id: "target", type: "manual", content: "# Old" }]);

    const [, restored] = await Promise.all([
      createSnapshot(DOC, "# Autosaved", "auto", settings),
      revertToSnapshot(DOC, "target", "# Current", settings),
    ]);

    expect(restored).toBe("# Old");
    expect(typesIn(docDir)).toEqual(["auto", "manual", "revert"]);
    expectConsistent(docDir);
  });

  it("holds in the other submission order", async () => {
    seedHistory(docDir, DOC, [{ id: "target", type: "manual", content: "# Old" }]);

    const [restored] = await Promise.all([
      revertToSnapshot(DOC, "target", "# Current", settings),
      createSnapshot(DOC, "# Autosaved", "auto", settings),
    ]);

    expect(restored).toBe("# Old");
    expect(typesIn(docDir)).toEqual(["auto", "manual", "revert"]);
    expectConsistent(docDir);
  });

  it("ten snapshots submitted at once all land, each with its file", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => createSnapshot(DOC, `# Version ${i}`, "manual", settings)),
    );

    const index = readIndex(docDir);
    expect(index.snapshots).toHaveLength(10);
    expect(index.snapshots.map((s) => s.preview)).toEqual(
      Array.from({ length: 10 }, (_, i) => `# Version ${i}`),
    );
    expectConsistent(docDir);
  });

  it("two autosave snapshots submitted at once merge into one, leaving one file", async () => {
    await Promise.all([
      createSnapshot(DOC, "# First", "auto", settings),
      createSnapshot(DOC, "# Second", "auto", settings),
    ]);

    const index = readIndex(docDir);
    expect(index.snapshots.map((s) => s.preview)).toEqual(["# Second"]);
    expectConsistent(docDir);
  });

  it("a delete racing a snapshot neither resurrects the deleted entry nor drops the new one", async () => {
    seedHistory(docDir, DOC, [
      { id: "doomed", type: "manual", content: "# Doomed" },
      { id: "kept", type: "manual", content: "# Kept" },
    ]);

    await Promise.all([
      deleteSnapshot(DOC, "doomed"),
      createSnapshot(DOC, "# New", "manual", settings),
    ]);

    expect(readIndex(docDir).snapshots.map((s) => s.preview)).toEqual(["# Kept", "# New"]);
    expectConsistent(docDir);
  });

  it("a prune racing a snapshot keeps the index and the files in step", async () => {
    const tight = { ...settings, maxSnapshots: 2 };
    seedHistory(
      docDir,
      DOC,
      [
        { id: "a", type: "manual", content: "# A" },
        { id: "b", type: "manual", content: "# B" },
        { id: "c", type: "manual", content: "# C" },
      ],
      tight,
    );

    await Promise.all([pruneSnapshots(DOC), createSnapshot(DOC, "# D", "manual", tight)]);

    expect(readIndex(docDir).snapshots.map((s) => s.preview)).toEqual(["# C", "# D"]);
    expectConsistent(docDir);
  });

  it("different documents are not held up by each other", async () => {
    // The first document's snapshot stalls on a write. A snapshot for another
    // document, submitted while it is stalled, must finish first.
    const order: string[] = [];
    let otherDone: Promise<void> | null = null;
    vfs.setTruncatedWindow(5000, () => {
      // Only this one write stalls; the other document's writes run freely.
      vfs.setTruncatedWindow(0);
      otherDone = createSnapshot(OTHER_DOC, "# Other", "manual", settings).then(() => {
        order.push("other");
      });
    });

    await createSnapshot(DOC, "# Mine", "manual", settings).then(() => order.push("mine"));
    await otherDone;

    expect(order).toEqual(["other", "mine"]);
    expectConsistent(docDir);
    expectConsistent(otherDir);
  });

  it("a failed mutation does not wedge the ones behind it", async () => {
    vfs.failNext("writeTextFile", ".md", new Error("disk full"));

    const [first, second] = await Promise.allSettled([
      createSnapshot(DOC, "# Lost", "manual", settings),
      createSnapshot(DOC, "# Kept", "manual", settings),
    ]);

    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
    expect(readIndex(docDir).snapshots.map((s) => s.preview)).toEqual(["# Kept"]);
    expectConsistent(docDir);
  });
});

describe("a reader waits for the mutation in progress", () => {
  it("never sees the index half-written", async () => {
    seedHistory(docDir, DOC, [
      { id: "one", type: "manual", content: "# One" },
      { id: "two", type: "manual", content: "# Two" },
    ]);
    // Read at the moment the new index is half-written beside the old one.
    let read: Promise<Snapshot[]> | null = null;
    vfs.setTruncatedWindow(50, (path) => {
      if (!read && path.endsWith("index.json.tmp")) read = getSnapshots(DOC);
    });

    await createSnapshot(DOC, "# Three", "manual", settings);

    expect(read).not.toBeNull();
    expect((await read!).map((s) => s.preview)).toEqual(["# Three", "# Two", "# One"]);
  });
});

describe("removing whole histories takes its turn with everything else", () => {
  it("clear-all submitted behind a snapshot removes that snapshot too", async () => {
    await Promise.all([createSnapshot(DOC, "# In flight", "manual", settings), clearAllHistory()]);

    expect(vfs.has(BASE)).toBe(false);
  });

  it("a snapshot submitted behind clear-all starts a fresh, consistent history", async () => {
    seedHistory(docDir, DOC, [
      { id: "one", type: "manual", content: "# One" },
      { id: "two", type: "manual", content: "# Two" },
    ]);

    await Promise.all([clearAllHistory(), createSnapshot(DOC, "# After", "manual", settings)]);

    expect(readIndex(docDir).snapshots.map((s) => s.preview)).toEqual(["# After"]);
    expectConsistent(docDir);
  });

  it("deleting one document's history behind a snapshot leaves nothing of it", async () => {
    seedHistory(docDir, DOC, [{ id: "one", type: "manual", content: "# One" }]);

    const [, deleted] = await Promise.all([
      createSnapshot(DOC, "# In flight", "manual", settings),
      deleteDocumentHistory(DOC),
    ]);

    expect(deleted).toBe(true);
    expect(vfs.has(docDir)).toBe(false);
  });

  it("clearing a workspace behind a snapshot removes it and spares other workspaces", async () => {
    seedHistory(otherDir, OTHER_DOC, [{ id: "theirs", type: "manual", content: "# Theirs" }]);

    const [, cleared] = await Promise.all([
      createSnapshot(DOC, "# In flight", "manual", settings),
      clearWorkspaceHistory("/work"),
    ]);

    expect(cleared).toBe(1);
    expect(vfs.has(docDir)).toBe(false);
    expectConsistent(otherDir);
  });

  it("a snapshot behind a workspace clear lands in a fresh history", async () => {
    seedHistory(docDir, DOC, [{ id: "one", type: "manual", content: "# One" }]);

    await Promise.all([
      clearWorkspaceHistory("/work"),
      createSnapshot(DOC, "# After", "manual", settings),
    ]);

    expect(readIndex(docDir).snapshots.map((s) => s.preview)).toEqual(["# After"]);
    expectConsistent(docDir);
  });
});
