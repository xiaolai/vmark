/**
 * parseHistoryIndex — the values a later prune or delete trusts.
 *
 * Retention settings read from an index decide which snapshot files the next
 * prune removes, so a value outside the range the settings page can produce
 * (negative, fractional, enormous) is brought back into that range rather
 * than trusted. Snapshot ids name files, so two entries sharing one id would
 * share one file: the first is kept and later duplicates are dropped.
 */

import { describe, it, expect, vi } from "vitest";
import { CLAMP_RANGES } from "../clamp";

import { parseHistoryIndex } from "@/utils/historyTypes";

const general = CLAMP_RANGES.general!;

function index(settings: Record<string, unknown>, snapshots: unknown[] = []): Record<string, unknown> {
  return {
    pathHash: "abc",
    documentPath: "/doc.md",
    documentName: "doc.md",
    status: "active",
    deletedAt: null,
    snapshots,
    settings,
  };
}

const ok = { maxSnapshots: 50, maxAgeDays: 7, mergeWindowSeconds: 30, maxFileSizeKB: 512 };

describe("parseHistoryIndex — retention settings stay in the settings-page range", () => {
  it("keeps in-range settings unchanged", () => {
    expect(parseHistoryIndex(index(ok))?.settings).toEqual(ok);
  });

  it.each([
    ["a negative age limit", { maxAgeDays: -3 }, { maxAgeDays: general.historyMaxAgeDays![0] }],
    ["a zero age limit", { maxAgeDays: 0 }, { maxAgeDays: general.historyMaxAgeDays![0] }],
    ["a fractional age limit below one day", { maxAgeDays: 0.5 }, { maxAgeDays: general.historyMaxAgeDays![0] }],
    ["an enormous age limit", { maxAgeDays: 1e12 }, { maxAgeDays: general.historyMaxAgeDays![1] }],
    ["a negative snapshot limit", { maxSnapshots: -1 }, { maxSnapshots: general.historyMaxSnapshots![0] }],
    ["a zero snapshot limit", { maxSnapshots: 0 }, { maxSnapshots: general.historyMaxSnapshots![0] }],
    ["a fractional snapshot limit", { maxSnapshots: 2.7 }, { maxSnapshots: 2 }],
    ["an enormous snapshot limit", { maxSnapshots: 1e9 }, { maxSnapshots: general.historyMaxSnapshots![1] }],
    ["a negative merge window", { mergeWindowSeconds: -10 }, { mergeWindowSeconds: general.historyMergeWindow![0] }],
    ["an enormous merge window", { mergeWindowSeconds: 1e9 }, { mergeWindowSeconds: general.historyMergeWindow![1] }],
    ["a negative size limit", { maxFileSizeKB: -1 }, { maxFileSizeKB: general.historyMaxFileSize![0] }],
    ["an enormous size limit", { maxFileSizeKB: 1e12 }, { maxFileSizeKB: general.historyMaxFileSize![1] }],
  ])("brings %s into range, keeping the index", (_name, over, expected) => {
    const parsed = parseHistoryIndex(index({ ...ok, ...over }, [{ id: "1-a", timestamp: 1, type: "auto", size: 1, preview: "" }]));
    expect(parsed?.settings).toEqual({ ...ok, ...expected });
    expect(parsed?.snapshots.map((s) => s.id)).toEqual(["1-a"]);
  });
});

describe("parseHistoryIndex — duplicate snapshot ids", () => {
  const snap = (id: string, preview: string) => ({ id, timestamp: 1, type: "auto", size: 1, preview });

  it("keeps the first entry for an id and drops later ones, reporting them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseHistoryIndex(index(ok, [snap("1-a", "first"), snap("1-b", "other"), snap("1-a", "second")]));
    expect(parsed?.snapshots.map((s) => [s.id, s.preview])).toEqual([
      ["1-a", "first"],
      ["1-b", "other"],
    ]);
    const duplicateWarnings = warn.mock.calls.filter((args) => args.join(" ").includes("duplicate snapshot id"));
    expect(duplicateWarnings).toHaveLength(1);
    warn.mockRestore();
  });

  it("keeps distinct ids untouched", () => {
    const parsed = parseHistoryIndex(index(ok, [snap("1-a", "x"), snap("1-b", "y")]));
    expect(parsed?.snapshots).toHaveLength(2);
  });
});
