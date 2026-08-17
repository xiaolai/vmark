// @vitest-environment node
// WI-PDF1.3 — the geometry the backend receives, and its agreement with the CSS.
import { describe, it, expect } from "vitest";
import { PAGE_SIZE_PT, buildPageSpec } from "./pageSpec";
import { PAGE_SIZE_KEYWORDS } from "./pdfHtmlTemplate";

describe("buildPageSpec", () => {
  it("returns portrait dimensions unchanged", () => {
    expect(buildPageSpec("a4", "portrait")).toMatchObject({ widthPt: 595.28, heightPt: 841.89 });
    expect(buildPageSpec("letter", "portrait")).toMatchObject({ widthPt: 612, heightPt: 792 });
  });

  // Landscape is a SWAP, not a flag. Windows ignored the orientation enum
  // while explicit width/height were set and produced a portrait MediaBox, so
  // a spec that merely carried a flag would silently do nothing there.
  it("expresses landscape as a width/height swap", () => {
    expect(buildPageSpec("a4", "landscape")).toMatchObject({ widthPt: 841.89, heightPt: 595.28 });
    const p = buildPageSpec("legal", "portrait");
    const l = buildPageSpec("legal", "landscape");
    expect(l.widthPt).toBe(p.heightPt);
    expect(l.heightPt).toBe(p.widthPt);
  });

  it("is wider than tall in landscape for every size", () => {
    for (const size of Object.keys(PAGE_SIZE_PT)) {
      const l = buildPageSpec(size, "landscape");
      expect(l.widthPt).toBeGreaterThan(l.heightPt);
    }
  });

  it("falls back to A4 for an unknown size, exactly as the CSS builder does", () => {
    expect(buildPageSpec("nonsense", "portrait")).toEqual(buildPageSpec("a4", "portrait"));
  });

  // This test used to assert the OPPOSITE — that the spec carries no margins,
  // "measured" from a probe that read margins off the PAGE COUNT. That signal
  // cannot see the horizontal axis at all, and Linux was in fact printing edge
  // to edge on all four sides. The contract changed on evidence; see pageSpec.ts.
  it("carries all four margins, because Linux cannot get them from CSS", () => {
    expect(Object.keys(buildPageSpec("a4", "portrait")).sort()).toEqual([
      "heightPt",
      "marginBottomPt",
      "marginLeftPt",
      "marginRightPt",
      "marginTopPt",
      "widthPt",
    ]);
  });
});

describe("the two geometry sources cannot drift", () => {
  // The CSS keeps using CSS keywords and the backend needs points, so there
  // are necessarily two tables. They are keyed on the same option value, and
  // adding a size to one alone is the drift this catches.
  it("every CSS page-size keyword has a points entry", () => {
    expect(Object.keys(PAGE_SIZE_KEYWORDS).sort()).toEqual(Object.keys(PAGE_SIZE_PT).sort());
  });

  it("every size is positive, finite and portrait-shaped in the table", () => {
    for (const [id, { width, height }] of Object.entries(PAGE_SIZE_PT)) {
      expect(Number.isFinite(width) && width > 0, `${id} width`).toBe(true);
      expect(Number.isFinite(height) && height > 0, `${id} height`).toBe(true);
      expect(height, `${id} is stored portrait`).toBeGreaterThan(width);
    }
  });
});

describe("buildPageSpec — margins", () => {
  it("converts millimetres to points", () => {
    const s = buildPageSpec("a4", "portrait", { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 });
    expect(s.marginTopPt).toBeCloseTo(72, 6);
    expect(s.marginLeftPt).toBeCloseTo(72, 6);
  });

  it("keeps each margin on its own edge when the sheet turns", () => {
    // The PAPER rotates; a left margin does not become a top margin. Swapping
    // these with width/height would silently transpose the user's asymmetric
    // margins (the `wide` preset is 38.1mm left/right, 25.4 top/bottom).
    const m = { top: 10, right: 20, bottom: 30, left: 40 };
    const portrait = buildPageSpec("a4", "portrait", m);
    const landscape = buildPageSpec("a4", "landscape", m);
    expect(landscape.marginTopPt).toBeCloseTo(portrait.marginTopPt, 6);
    expect(landscape.marginLeftPt).toBeCloseTo(portrait.marginLeftPt, 6);
    expect(landscape.widthPt).toBeCloseTo(portrait.heightPt, 6);
  });

  it("defaults to zero margins when none are supplied", () => {
    const s = buildPageSpec("a4", "portrait");
    expect(s.marginTopPt).toBe(0);
    expect(s.marginRightPt).toBe(0);
    expect(s.marginBottomPt).toBe(0);
    expect(s.marginLeftPt).toBe(0);
  });
});
