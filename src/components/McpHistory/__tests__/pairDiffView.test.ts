// @vitest-environment node
// WI-AL2.4 — the bounded whole-document diff the "edited in two windows" row shows: inserted and deleted text exactly as the canonical change list says (CJK and emoji intact), unchanged text cut to a little context around each change with a gap marker, a long change clipped without splitting a surrogate pair, and the whole view held under MAX_VIEW_UNITS with the changes it could not show counted, linear in the document size
import { describe, it, expect } from "vitest";
import { exactCanonicalDiff, trimmedCanonicalDiff } from "@/services/agentJournal/review/canonicalDiff";
import { growthExponent, measureGrowth } from "@/test/cpuClock";
import { CONTEXT_UNITS, MAX_PART_UNITS, MAX_VIEW_UNITS, diffView, type DiffSegment } from "../pairDiffView";

const view = (a: string, b: string) => diffView(a, b, exactCanonicalDiff(a, b));
const units = (segments: readonly DiffSegment[]) => segments.reduce((n, s) => n + (s.kind === "gap" ? 0 : s.text.length), 0);
const changed = (segments: readonly DiffSegment[], kind: "insert" | "delete") => segments.filter((s) => s.kind === kind).map((s) => (s.kind === kind ? s.text : ""));
const isLoneSurrogate = (s: string) => /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(s);

describe("diffView", () => {
  it("shows nothing for identical texts", () => {
    expect(view("同じ 🎉", "同じ 🎉")).toEqual({ segments: [], hiddenChanges: 0 });
  });

  it("shows CJK and emoji insertions and deletions exactly", () => {
    const v = view("Hi 你好 world", "Hi 世界🎉 world");
    expect(changed(v.segments, "delete").join("")).toBe("你好");
    expect(changed(v.segments, "insert").join("")).toBe("世界🎉");
    expect(v.segments[0]).toEqual({ kind: "same", text: "Hi " });
    expect(v.segments.at(-1)).toEqual({ kind: "same", text: " world" });
  });

  it("cuts long unchanged runs to context around each change, with a gap", () => {
    const pad = "x".repeat(CONTEXT_UNITS * 3);
    const v = view(`${pad}A${pad}B${pad}`, `${pad}a${pad}b${pad}`);
    expect(v.segments.map((s) => s.kind)).toEqual(["gap", "same", "delete", "insert", "same", "gap", "same", "delete", "insert", "same", "gap"]);
    for (const s of v.segments) if (s.kind === "same") expect(s.text.length).toBe(CONTEXT_UNITS);
  });

  it("keeps a short unchanged run between changes whole", () => {
    const v = view("A--B", "a--b");
    expect(v.segments).toContainEqual({ kind: "same", text: "--" });
    expect(v.segments.some((s) => s.kind === "gap")).toBe(false);
  });

  it("clips a long change without splitting a surrogate pair", () => {
    const long = "🎉".repeat(MAX_PART_UNITS);
    const v = view("a", `a${long}`);
    const [inserted] = v.segments.filter((s) => s.kind === "insert");
    expect(inserted).toMatchObject({ kind: "insert", clipped: true });
    if (inserted.kind !== "insert") throw new Error("unreachable");
    expect(inserted.text.length).toBeLessThanOrEqual(MAX_PART_UNITS);
    expect(isLoneSurrogate(inserted.text)).toBe(false);
  });

  it("does not split a surrogate pair at a context edge", () => {
    const emoji = "🎉".repeat(CONTEXT_UNITS * 2);
    const v = view(`${emoji}A${emoji}`, `${emoji}B${emoji}`);
    for (const s of v.segments) if (s.kind !== "gap") expect(isLoneSurrogate(s.text)).toBe(false);
  });

  it("stays under MAX_VIEW_UNITS and counts the changes it could not show", () => {
    const lines = Array.from({ length: 4_000 }, (_, i) => `line ${i} ${"z".repeat(20)}`);
    const a = lines.join("\n");
    const b = lines.map((l, i) => (i % 2 === 0 ? `${l} changed` : l)).join("\n");
    const changes = exactCanonicalDiff(a, b);
    const v = diffView(a, b, changes);
    expect(units(v.segments)).toBeLessThanOrEqual(MAX_VIEW_UNITS);
    const shown = v.segments.filter((s) => s.kind === "insert").length;
    expect(shown).toBeGreaterThan(0);
    expect(shown + v.hiddenChanges).toBe(changes.length);
    expect(v.hiddenChanges).toBeGreaterThan(0);
  });

  it("bounds a whole-document rewrite of a large document", () => {
    const a = "旧".repeat(500_000);
    const b = "新🎉".repeat(300_000);
    const v = diffView(a, b, trimmedCanonicalDiff(a, b));
    expect(units(v.segments)).toBeLessThanOrEqual(MAX_VIEW_UNITS);
    const parts = v.segments.flatMap((s) => (s.kind === "delete" || s.kind === "insert" ? [s] : []));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((s) => s.clipped)).toBe(true);
  });

  it("grows linearly with the document", () => {
    const make = (n: number) => {
      const a = Array.from({ length: n }, (_, i) => `row ${i}`).join("\n");
      const b = a.replace(/row (\d*7)\b/g, "ROW $1");
      return { a, b, changes: exactCanonicalDiff(a, b) };
    };
    const run = ({ a, b, changes }: ReturnType<typeof make>) => void diffView(a, b, changes);
    expect(growthExponent(measureGrowth(run, make(2_000), make(16_000)), 2_000, 16_000)).toBeLessThan(1.5);
  });
});
