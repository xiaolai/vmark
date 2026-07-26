/**
 * Unit tests for workspace rail identity glyphs.
 */
import { describe, it, expect } from "vitest";
import { workspaceRailGlyphs } from "./workspaceRailGlyphs";

describe("workspaceRailGlyphs", () => {
  /** Terse builder: the glyph logic only needs id + display name. */
  const inst = (workspaceInstanceId: string, displayName: string) => ({
    workspaceInstanceId,
    displayName,
    kind: "workspace" as const,
  });

  it("uses the first character of the workspace name", () => {
    expect(workspaceRailGlyphs([inst("a", "A-SCHOOL-YARD")])).toEqual({ a: "A" });
  });

  it("derives from the NAME, not the position — the whole point of the change", () => {
    const forward = workspaceRailGlyphs([inst("a", "alpha"), inst("b", "beta")]);
    const reordered = workspaceRailGlyphs([inst("b", "beta"), inst("a", "alpha")]);
    // A positional index would swap here; a name-derived glyph must not.
    expect(forward).toEqual({ a: "A", b: "B" });
    expect(reordered).toEqual({ a: "A", b: "B" });
  });

  it("extends to the shortest UNIQUE prefix when initials collide", () => {
    expect(workspaceRailGlyphs([inst("a", "alpha"), inst("b", "apex")])).toEqual({
      a: "AL",
      b: "AP",
    });
  });

  it("extends further when two characters still collide", () => {
    expect(workspaceRailGlyphs([inst("a", "abcx"), inst("b", "abcy")])).toEqual({
      a: "ABC",
      b: "ABC",
    });
  });

  it("caps the glyph length so it cannot overflow the 30px rail", () => {
    const glyphs = workspaceRailGlyphs([inst("a", "abcdefgh"), inst("b", "abcdefgi")]);
    for (const g of Object.values(glyphs)) expect(g.length).toBeLessThanOrEqual(3);
  });

  it("keeps a single character when names do not collide", () => {
    expect(workspaceRailGlyphs([inst("a", "alpha"), inst("b", "zulu")])).toEqual({
      a: "A",
      b: "Z",
    });
  });

  it("handles CJK names", () => {
    expect(workspaceRailGlyphs([inst("a", "学校院子")])).toEqual({ a: "学" });
  });

  it("handles emoji without splitting a surrogate pair", () => {
    const glyph = workspaceRailGlyphs([inst("a", "🚀rocket")]).a;
    expect(glyph).toBe("🚀");
    // A naive name[0] would yield a lone high surrogate that renders as U+FFFD.
    expect(glyph.includes("�")).toBe(false);
  });

  it("skips leading punctuation so dotfile-style roots stay meaningful", () => {
    expect(workspaceRailGlyphs([inst("a", ".config")])).toEqual({ a: "C" });
  });

  it("falls back when the name has no usable character", () => {
    expect(workspaceRailGlyphs([inst("a", "")]).a).toBe("?");
    expect(workspaceRailGlyphs([inst("a", "   ")]).a).toBe("?");
    expect(workspaceRailGlyphs([inst("a", "...")]).a).toBe("?");
  });

  it("gives loose instances no glyph — they keep their own icon", () => {
    const glyphs = workspaceRailGlyphs([
      { workspaceInstanceId: "l", displayName: "Loose Files", kind: "loose" },
      inst("a", "alpha"),
    ]);
    expect(glyphs.l).toBeUndefined();
    expect(glyphs.a).toBe("A");
  });

  it("does not let a loose instance influence workspace collisions", () => {
    // "Loose Files" starts with L; a workspace named "lima" must still get "L".
    const glyphs = workspaceRailGlyphs([
      { workspaceInstanceId: "l", displayName: "Loose Files", kind: "loose" },
      inst("a", "lima"),
    ]);
    expect(glyphs.a).toBe("L");
  });

  it("returns an empty map for no instances", () => {
    expect(workspaceRailGlyphs([])).toEqual({});
  });
});
