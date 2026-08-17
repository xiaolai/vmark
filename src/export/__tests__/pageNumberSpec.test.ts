// @vitest-environment node
/**
 * The page-number spec sent to the backend.
 *
 * Page numbers are STAMPED onto the finished PDF rather than laid out in CSS,
 * because they belong in `@page` margin boxes and WebKit does not implement
 * those — a CSS approach would have worked on Chromium alone. So the geometry
 * the backend needs has to be computed here, in the units it expects.
 */

import { describe, it, expect } from "vitest";
import { buildPageNumberSpec, type PdfOptions } from "../pdfOptions";

function options(overrides: Partial<PdfOptions> = {}): PdfOptions {
  return {
    pageSize: "a4",
    orientation: "portrait",
    marginTop: 25.4,
    marginRight: 25.4,
    marginBottom: 25.4,
    marginLeft: 25.4,
    fontSize: 11,
    lineHeight: 1.6,
    cjkLetterSpacing: "0.05em",
    latinFont: "system",
    cjkFont: "system",
    useEditorTheme: false,
    pageNumberPosition: "bottom-center",
    pageNumberFormat: "plain",
    pageNumberSkipFirst: false,
    ...overrides,
  };
}

const TEMPLATE = "Page {n} of {total}";

describe("buildPageNumberSpec", () => {
  it("returns null when the user turned page numbers off", () => {
    // null rather than a spec with position "none": the command argument is
    // optional, so the backend can skip the whole post-processing step instead
    // of loading and re-saving the PDF to draw nothing.
    expect(buildPageNumberSpec(options({ pageNumberPosition: "none" }), TEMPLATE)).toBeNull();
  });

  it("converts margins from millimetres to points", () => {
    const spec = buildPageNumberSpec(options(), TEMPLATE)!;
    expect(spec.bottomMarginPt).toBeCloseTo(72, 5);
    expect(spec.sideMarginPt).toBeCloseTo(72, 5);
  });

  it("takes the bottom margin for vertical placement and the right for horizontal", () => {
    // Asymmetric on purpose — the `wide` preset has different side margins, and
    // swapping these would push a right-aligned number off the page.
    const spec = buildPageNumberSpec(
      options({ marginBottom: 10, marginRight: 40 }),
      TEMPLATE,
    )!;
    expect(spec.bottomMarginPt).toBeCloseTo((10 * 72) / 25.4, 5);
    expect(spec.sideMarginPt).toBeCloseTo((40 * 72) / 25.4, 5);
  });

  it("scales the number with body text rather than fixing it", () => {
    const small = buildPageNumberSpec(options({ fontSize: 9 }), TEMPLATE)!;
    const large = buildPageNumberSpec(options({ fontSize: 20 }), TEMPLATE)!;
    expect(large.fontSizePt).toBeGreaterThan(small.fontSizePt);
    expect(large.fontSizePt).toBeCloseTo(17, 5);
  });

  it("floors the size so it stays legible under a tiny body size", () => {
    // fontSize is user-settable; 0.85 x 4pt would be a 3.4pt footer nobody can
    // read, and it would still consume a line of the margin.
    const spec = buildPageNumberSpec(options({ fontSize: 4 }), TEMPLATE)!;
    expect(spec.fontSizePt).toBe(7);
  });

  it("passes position, format and skip through unchanged", () => {
    const spec = buildPageNumberSpec(
      options({
        pageNumberPosition: "bottom-right",
        pageNumberFormat: "with-total",
        pageNumberSkipFirst: true,
      }),
      TEMPLATE,
    )!;
    expect(spec.position).toBe("bottom-right");
    expect(spec.format).toBe("with-total");
    expect(spec.skipFirst).toBe(true);
  });

  it("carries the localized template for the backend to substitute", () => {
    // The page COUNT is unknown until the render finishes, so the frontend
    // sends a template rather than a finished string.
    const spec = buildPageNumberSpec(options(), "Página {n} de {total}")!;
    expect(spec.verboseTemplate).toBe("Página {n} de {total}");
    expect(spec.verboseTemplate).toContain("{n}");
    expect(spec.verboseTemplate).toContain("{total}");
  });

  it("emits exactly the wire fields the Rust struct declares", () => {
    // The two sides are joined by serde field names, which no compiler checks.
    expect(Object.keys(buildPageNumberSpec(options(), TEMPLATE)!).sort()).toEqual([
      "bottomMarginPt",
      "fontSizePt",
      "format",
      "position",
      "sideMarginPt",
      "skipFirst",
      "verboseTemplate",
    ]);
  });
});
