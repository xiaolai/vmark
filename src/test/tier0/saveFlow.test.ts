// WI-17 — Tier-0 SAVE flow, end to end in jsdom over the REAL composition:
// real documentStore/tabStore/settingsStore, real saveToPath + normalization +
// pending-save registry + history snapshot, `@tauri-apps/*` faked statefully
// (src/test/statefulFsFake.ts). The claim is about BYTES ON DISK, not about
// which collaborator was called — the choreography suite
// (src/services/files/fileSave.test.ts) keeps the branch coverage.
// Protocol for the racing cases: decision ledger D6
// (.claude/tdd-guardian/decisions-20260803.md).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { handleSave } from "@/services/files/fileSave";
import { statefulFs } from "@/test/statefulFsFake";
import { WINDOW, ROOT, resetTier0, openDocInTab, newUntitledTab, editDoc, doc } from "./harness";

const DOC = `${ROOT}/notes.md`;
/** CJK + a trailing newline: multibyte content is where naive writers drift. */
const ORIGINAL = "# 标题\n\n第一段。\n";
const EDITED = "# 标题\n\n第一段。\n\n第二段：新增内容。\n";

beforeEach(() => {
  resetTier0();
  vi.mocked(saveDialog).mockReset();
});

describe("Tier-0 save flow (case 1)", () => {
  it("edit → save puts the EXACT serialized bytes on disk and clears dirty", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, EDITED);
    expect(doc(tabId).isDirty).toBe(true);

    await handleSave(WINDOW);

    // The file, not the call: read back through the fake disk.
    expect(statefulFs.read(DOC)).toBe(EDITED);
    expect(statefulFs.writesTo(DOC)).toEqual([
      { path: DOC, content: EDITED, via: "atomic_write_file" },
    ]);
    expect(doc(tabId).isDirty).toBe(false);
    expect(doc(tabId).savedContent).toBe(EDITED);
  });

  it("preserves the file's CRLF convention and its BOM through the real save path", async () => {
    const crlfWithBom = "\u{FEFF}# 标题\r\n\r\n正文\r\n";
    const tabId = await openDocInTab(DOC, crlfWithBom);
    // The editor buffer is canonical LF and BOM-free; the file's convention
    // lives in document metadata and must come back on write.
    editDoc(tabId, "# 标题\n\n正文\n改动\n");

    await handleSave(WINDOW);

    expect(statefulFs.read(DOC)).toBe("\u{FEFF}# 标题\r\n\r\n正文\r\n改动\r\n");
  });

  it("untitled document routes through Save As and lands at the chosen path", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "初稿\n");
    const target = `${ROOT}/untitled-1.md`;
    vi.mocked(saveDialog).mockResolvedValue(target);

    await handleSave(WINDOW);

    expect(statefulFs.read(target)).toBe("初稿\n");
    expect(doc(tabId).filePath).toBe(target);
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("cancelled Save As writes nothing and keeps the work dirty", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "未保存内容\n");
    vi.mocked(saveDialog).mockResolvedValue(null);

    await handleSave(WINDOW);

    expect(statefulFs.writes.filter((w) => w.content === "未保存内容\n")).toEqual([]);
    expect(doc(tabId).isDirty).toBe(true);
    expect(doc(tabId).content).toBe("未保存内容\n");
  });

  it("empty content is a real save, not a skipped one", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, "");

    await handleSave(WINDOW);

    expect(statefulFs.read(DOC)).toBe("");
    expect(doc(tabId).isDirty).toBe(false);
  });
});

describe("Tier-0 save flow — failure path (case 7)", () => {
  it("a rejected write keeps the doc dirty, keeps the buffer, and leaves disk bytes untouched", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, EDITED);
    statefulFs.failWrites(new Error("disk full"));

    await handleSave(WINDOW);

    // No unsaved user bytes discarded (D6 invariant), nothing half-written.
    expect(statefulFs.read(DOC)).toBe(ORIGINAL);
    expect(statefulFs.writesTo(DOC)).toEqual([]);
    expect(doc(tabId).isDirty).toBe(true);
    expect(doc(tabId).content).toBe(EDITED);
    expect(doc(tabId).savedContent).toBe(ORIGINAL);
  });

  it("the failed save is retryable: the next save writes the same buffer", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, EDITED);
    statefulFs.failWrites(new Error("disk full"));
    await handleSave(WINDOW);

    statefulFs.failWrites(null);
    await handleSave(WINDOW);

    expect(statefulFs.read(DOC)).toBe(EDITED);
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("a vanished parent directory routes the save into Save As instead of losing the edit", async () => {
    const tabId = await openDocInTab(`${ROOT}/sub/deep.md`, ORIGINAL);
    editDoc(tabId, EDITED);
    // The directory disappears (renamed/deleted externally) between edits.
    statefulFs.reset();
    statefulFs.mkdirp(ROOT);
    const recovered = `${ROOT}/deep-recovered.md`;
    vi.mocked(saveDialog).mockResolvedValue(recovered);

    await handleSave(WINDOW);

    expect(statefulFs.read(recovered)).toBe(EDITED);
    expect(doc(tabId).isMissing).toBe(false);
    expect(doc(tabId).isDirty).toBe(false);
  });
});

describe("Tier-0 save flow — rapid double save (case 9)", () => {
  it("two immediate saves settle on the final bytes and clear dirty exactly once", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, EDITED);

    // Both are dispatched before either settles — the per-path save queue and
    // the window re-entry guard decide what reaches disk.
    await Promise.all([handleSave(WINDOW), handleSave(WINDOW)]);

    const writes = statefulFs.writesTo(DOC);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes.length).toBeLessThanOrEqual(2);
    // Whatever the count, every write carried the same bytes and the file is
    // the buffer — a re-entrancy bug would interleave or truncate.
    expect(new Set(writes.map((w) => w.content))).toEqual(new Set([EDITED]));
    expect(statefulFs.read(DOC)).toBe(EDITED);
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("a second save of newer content wins on disk (submission order is preserved)", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, EDITED);
    const first = handleSave(WINDOW);
    editDoc(tabId, `${EDITED}更新\n`);
    await first;
    await handleSave(WINDOW);

    expect(statefulFs.read(DOC)).toBe(`${EDITED}更新\n`);
    expect(doc(tabId).isDirty).toBe(false);
  });
});
