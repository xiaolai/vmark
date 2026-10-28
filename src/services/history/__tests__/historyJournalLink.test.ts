// @vitest-environment node
// WI-AL1.4 — a Version History "mcp" snapshot is linked to the agent edit journal by the revision id that holds the saved text; a snapshot without one stores no link, and the link survives the index round trip
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HistoryIndex, HistorySettings } from "@/utils/historyTypes";

vi.mock("@tauri-apps/plugin-fs", async () => (await import("./historyTestFs")).pluginFsMock);
vi.mock("@tauri-apps/api/path", async () => (await import("./historyTestFs")).pathApiMock);
vi.mock("@/utils/debug", () => ({ historyLog: vi.fn(), historyError: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/utils/historyTypes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/historyTypes")>()),
  hashPath: async () => "hdoc",
}));

import { APP_DATA_DIR, vfs } from "./historyTestFs";
import { createSnapshot, getSnapshots } from "../historyOperations";

const DOC = "/work/笔记.md";
const INDEX = `${APP_DATA_DIR}/history/hdoc/index.json`;
const REV = "0190d3c4-0000-7000-8000-000000000002";
const settings: HistorySettings = { maxSnapshots: 50, maxAgeDays: 7, mergeWindowSeconds: 30, maxFileSizeKB: 0 };

beforeEach(() => vfs.reset());

function index(): HistoryIndex {
  return JSON.parse(vfs.read(INDEX) ?? "null") as HistoryIndex;
}

describe("journal revision link on history snapshots", () => {
  it("stores the revision id on the snapshot it was given for", async () => {
    await createSnapshot(DOC, "agent 文本", "mcp", settings, REV);
    expect(index().snapshots[0]).toMatchObject({ type: "mcp", journalRevision: REV });
    const [listed] = await getSnapshots(DOC);
    expect(listed.journalRevision).toBe(REV);
  });

  it("stores no link key when there is no revision", async () => {
    await createSnapshot(DOC, "x", "mcp", settings, null);
    await createSnapshot(DOC, "y", "manual", settings);
    for (const s of index().snapshots) expect("journalRevision" in s).toBe(false);
  });

  it.each(["manual", "auto", "revert"] as const)("never links a %s snapshot, even when handed a revision", async (type) => {
    await createSnapshot(DOC, `text ${type}`, type, settings, REV);
    expect(index().snapshots).toHaveLength(1);
    expect("journalRevision" in index().snapshots[0]).toBe(false);
  });
});
