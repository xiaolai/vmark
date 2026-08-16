// @vitest-environment node
// WI-PDF1.3 — the geometry the backend receives, and its agreement with the CSS.
import { describe, it, expect } from "vitest";
import { PAGE_SIZE_PT, buildPageSpec } from "./pageSpec";
import { PAGE_SIZE_KEYWORDS } from "./pdfHtmlTemplate";

describe("buildPageSpec", () => {
  it("returns portrait dimensions unchanged", () => {
    expect(buildPageSpec("a4", "portrait")).toEqual({ widthPt: 595.28, heightPt: 841.89 });
    expect(buildPageSpec("letter", "portrait")).toEqual({ widthPt: 612, heightPt: 792 });
  });

  // Landscape is a SWAP, not a flag. Windows ignored the orientation enum
  // while explicit width/height were set and produced a portrait MediaBox, so
  // a spec that merely carried a flag would silently do nothing there.
  it("expresses landscape as a width/height swap", () => {
    expect(buildPageSpec("a4", "landscape")).toEqual({ widthPt: 841.89, heightPt: 595.28 });
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

  it("carries no margins — they are CSS-driven (ADR-PDF1a)", () => {
    // Measured on both platforms: API margins changed the page count not at
    // all. A margin field here would read as authoritative and do nothing.
    expect(Object.keys(buildPageSpec("a4", "portrait")).sort()).toEqual(["heightPt", "widthPt"]);
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
