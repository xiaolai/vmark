// @vitest-environment node
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

  it("uses ONE grapheme even when initials collide", () => {
    // The rail is 30px. A second or third character makes the glyph smaller and
    // harder to read to buy uniqueness the rail does not actually need — colour,
    // tooltip and accessible name each already carry the full workspace name.
    expect(workspaceRailGlyphs([inst("a", "alpha"), inst("b", "apex")])).toEqual({
      a: "A",
      b: "A",
    });
  });

  it("never lengthens a glyph to disambiguate, at any collision depth", () => {
    expect(
      workspaceRailGlyphs([inst("z", "zulu"), inst("a", "alpha"), inst("b", "apex")]),
    ).toEqual({ z: "Z", a: "A", b: "A" });
    expect(workspaceRailGlyphs([inst("a", "abcx"), inst("b", "abcy")])).toEqual({
      a: "A",
      b: "A",
    });
  });

  it("keeps a ZWJ emoji sequence whole instead of splitting it", () => {
    // Array.from() is code-point-safe but NOT grapheme-safe: it would take the
    // first code point of 👨‍👩‍👧 and render a lone 👨, silently showing a
    // different emoji than the folder name has.
    expect(workspaceRailGlyphs([inst("a", "👨‍👩‍👧 family")]).a).toBe("👨‍👩‍👧");
  });

  it("keeps a skin-tone modifier attached to its base emoji", () => {
    expect(workspaceRailGlyphs([inst("a", "👍🏽 approved")]).a).toBe("👍🏽");
  });

  it("keeps a decomposed accent attached to its base letter", () => {
    // "e" + U+0301 combining acute — splitting these renders a bare "E" plus a
    // stray floating accent.
    expect(workspaceRailGlyphs([inst("a", "école")]).a).toBe("É");
  });

  it("emits exactly ONE grapheme, not one UTF-16 unit", () => {
    // The old assertion was `g.length <= 3`, a leftover from when glyphs grew to
    // disambiguate. It measured UTF-16 units, so it passed trivially for ASCII
    // and would have MIS-described a ZWJ emoji (length 11) as over-long while
    // calling a 3-letter glyph acceptable. Grapheme count is what the rail shows.
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const glyphs = workspaceRailGlyphs([
      inst("a", "alpha"),
      inst("b", "🚀 rocket"),
      inst("c", "👨‍👩‍👧 family"),
      inst("d", "école"),
      inst("e", "日本語"),
    ]);
    for (const g of Object.values(glyphs)) {
      expect([...seg.segment(g)]).toHaveLength(1);
    }
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
    // A naive `name[0]` yields a lone high surrogate here. Exact equality is the
    // assertion that catches it — an earlier `includes("�")` check was
    // vacuous, since a lone surrogate is not literally U+FFFD in a JS string.
    expect(workspaceRailGlyphs([inst("a", "🚀rocket")]).a).toBe("🚀");
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
