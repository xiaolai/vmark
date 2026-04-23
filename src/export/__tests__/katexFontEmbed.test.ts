/**
 * Tests for katexFontEmbed — ensures the CSS rewrite replaces every
 * @font-face src with an inlined woff2 data URI and drops the woff/ttf
 * fallbacks (keeping output size bounded).
 */

import { describe, it, expect } from "vitest";
import { embedKatexFonts, EMBEDDED_FONT_FILENAMES } from "../katexFontEmbed";

describe("embedKatexFonts", () => {
  it("ships embeddings for every font KaTeX declares in its CSS", () => {
    // 20 woff2 fonts total in katex 0.16.28 — regression guard if KaTeX ships more
    expect(EMBEDDED_FONT_FILENAMES.length).toBeGreaterThanOrEqual(20);
  });

  it("replaces a woff2 url with a data URI and strips woff/ttf fallbacks", () => {
    const input =
      '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}';
    const output = embedKatexFonts(input);
    expect(output).toMatch(/url\(data:[^)]*;base64,[^)]+\)\s*format\("woff2"\)/);
    expect(output).not.toContain(".woff)");
    expect(output).not.toContain(".ttf)");
  });

  it("leaves unknown font filenames untouched as a last-resort fallback", () => {
    const input =
      '@font-face{src:url(fonts/Unknown-Font.woff2) format("woff2")}';
    const output = embedKatexFonts(input);
    expect(output).toContain("url(fonts/Unknown-Font.woff2)");
    expect(output).not.toContain("data:");
  });

  it("is idempotent-safe: already-embedded data URIs are not corrupted", () => {
    // After the first pass, the CSS contains data: URIs. A defensive second
    // call should not introduce malformed output, because the regex only
    // matches relative url(fonts/...) patterns.
    const input =
      '@font-face{src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}';
    const once = embedKatexFonts(input);
    const twice = embedKatexFonts(once);
    expect(twice).toBe(once);
  });
});
