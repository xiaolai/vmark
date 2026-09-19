// @vitest-environment node
/**
 * customFont — the `custom:<family>` encoding and its validator (#1429).
 *
 * This is the security half of custom fonts: the family name ends up inside a
 * CSS declaration VMark emits, and it arrives from persisted settings. Most of
 * what follows is the refusal list.
 */

import { describe, it, expect } from "vitest";
import { customFontValue, parseCustomFont, sanitizeCustomFontFamily } from "./customFont";

describe("sanitizeCustomFontFamily", () => {
  it("accepts an ordinary family name", () => {
    expect(sanitizeCustomFontFamily("LXGW WenKai")).toBe("LXGW WenKai");
  });

  it("accepts a CJK family name", () => {
    expect(sanitizeCustomFontFamily("霞鹜文楷")).toBe("霞鹜文楷");
  });

  it("accepts the punctuation real family names use", () => {
    expect(sanitizeCustomFontFamily("Noto Sans CJK SC")).toBe("Noto Sans CJK SC");
    expect(sanitizeCustomFontFamily("IBM Plex Mono")).toBe("IBM Plex Mono");
    expect(sanitizeCustomFontFamily("Source Han Serif")).toBe("Source Han Serif");
    expect(sanitizeCustomFontFamily("PT Sans-Caption")).toBe("PT Sans-Caption");
    expect(sanitizeCustomFontFamily("M+ 1p")).toBe("M+ 1p");
    expect(sanitizeCustomFontFamily("Iosevka Term SS08")).toBe("Iosevka Term SS08");
  });

  it("trims and collapses whitespace", () => {
    expect(sanitizeCustomFontFamily("  LXGW   WenKai \n")).toBe("LXGW WenKai");
  });

  it("refuses anything that could end the CSS declaration", () => {
    // The value is written verbatim into `--font-sans`. Every one of these
    // escapes the quoted family and injects a declaration of its own.
    for (const hostile of [
      'X"; color: red; --a: "',
      "X'; color: red; --a: '",
      "X; color: red",
      "X} body {color:red",
      "X/*comment*/",
      "X\\27",
      "url(evil)",
      "X, Y",
      "X<script>",
      "expression(alert(1))",
    ]) {
      expect(sanitizeCustomFontFamily(hostile)).toBeNull();
    }
  });

  it("refuses control characters and newlines", () => {
    expect(sanitizeCustomFontFamily("X\u0000Y")).toBeNull();
    expect(sanitizeCustomFontFamily("X\u001bY")).toBeNull();
    expect(sanitizeCustomFontFamily("X\u007fY")).toBeNull();
  });

  it("refuses invisible format characters", () => {
    // A pasted name can carry these, and nobody can see where it ends.
    expect(sanitizeCustomFontFamily("Menlo\u200b")).toBeNull();
    expect(sanitizeCustomFontFamily("Men\u200elo")).toBeNull();
  });

  it("refuses empty and over-long input", () => {
    expect(sanitizeCustomFontFamily("")).toBeNull();
    expect(sanitizeCustomFontFamily("   ")).toBeNull();
    expect(sanitizeCustomFontFamily("A".repeat(65))).toBeNull();
    expect(sanitizeCustomFontFamily("A".repeat(64))).toBe("A".repeat(64));
  });
});

describe("parseCustomFont", () => {
  it("reads the family out of a custom value", () => {
    expect(parseCustomFont("custom:LXGW WenKai")).toBe("LXGW WenKai");
  });

  it("answers null for a curated key", () => {
    expect(parseCustomFont("athelas")).toBeNull();
    expect(parseCustomFont("system")).toBeNull();
  });

  it("answers null for a custom value that does not survive sanitizing", () => {
    expect(parseCustomFont("custom:")).toBeNull();
    expect(parseCustomFont('custom:X"; color: red')).toBeNull();
  });

  it("round-trips through customFontValue", () => {
    expect(parseCustomFont(customFontValue("霞鹜文楷"))).toBe("霞鹜文楷");
  });
});
