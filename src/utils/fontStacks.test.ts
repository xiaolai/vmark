/**
 * fontStacks — pure font-stack resolution tests
 *
 *   - Latin / CJK / mono stack resolution and fallbacks
 *   - Trailing-generic stripping so the CJK Font setting takes effect (#1056)
 */

import { describe, it, expect } from "vitest";
import { buildFontStack, fontStacks, resolveMonoFontStack } from "./fontStacks";

describe("buildFontStack", () => {
  it("resolves known latin font to its stack", () => {
    const result = buildFontStack("athelas", "system", "system");
    expect(result.sans).toContain("Athelas");
  });

  it("resolves known CJK font into the sans stack", () => {
    const result = buildFontStack("system", "songti", "system");
    expect(result.sans).toContain("Songti SC");
  });

  it("resolves known mono font", () => {
    const result = buildFontStack("system", "system", "jetbrains");
    expect(result.mono).toContain("JetBrains Mono");
  });

  it("falls back to system for unknown latin font key", () => {
    const result = buildFontStack("nonexistent", "system", "system");
    expect(result.sans).toContain("system-ui");
  });

  it("falls back to system for unknown CJK font key", () => {
    const result = buildFontStack("system", "nonexistent", "system");
    expect(result.sans).toContain("PingFang SC");
  });

  it("falls back to system for unknown mono font key", () => {
    const result = buildFontStack("system", "system", "nonexistent");
    expect(result.mono).toContain("ui-monospace");
  });

  it("combines latin and CJK in the sans stack", () => {
    const result = buildFontStack("georgia", "kaiti", "system");
    // Latin comes first, then CJK
    const latinIdx = result.sans.indexOf("Georgia");
    const cjkIdx = result.sans.indexOf("Kaiti SC");
    expect(latinIdx).toBeLessThan(cjkIdx);
  });

  // Issue #1056: a generic family (serif/sans-serif) at the END of the Latin
  // stack intercepts CJK character resolution before the browser ever reaches
  // the CJK stack. The Latin stack's trailing generic must be stripped so the
  // CJK fonts (and their own trailing generic) actually take effect.
  it("does not place a generic family between the Latin and CJK fonts", () => {
    const result = buildFontStack("athelas", "songti", "system");
    const cjkIdx = result.sans.indexOf("Songti SC");
    // No "serif"/"sans-serif" token may appear before the first CJK font.
    const head = result.sans.slice(0, cjkIdx);
    expect(head).not.toMatch(/(^|,\s*)(serif|sans-serif)\s*(,|$)/);
  });

  it("keeps the CJK stack's trailing generic as the overall fallback", () => {
    const result = buildFontStack("athelas", "songti", "system");
    // Songti's stack ends in `serif`; that becomes the final fallback.
    expect(result.sans.trim().endsWith("serif")).toBe(true);
  });

  it("lets the CJK font category survive a serif Latin choice", () => {
    // Latin=Athelas (serif) must not force a sans-serif CJK font to serif.
    const result = buildFontStack("athelas", "sourcehans", "system");
    const cjkIdx = result.sans.indexOf("Source Han Sans SC");
    const head = result.sans.slice(0, cjkIdx);
    expect(head).not.toContain("serif");
    // The sans-serif fallback from the CJK stack is preserved at the tail.
    expect(result.sans.trim().endsWith("sans-serif")).toBe(true);
  });

  it("still resolves the Latin font for a system CJK selection", () => {
    // Stripping the trailing generic must not drop the named Latin fonts.
    const result = buildFontStack("georgia", "system", "system");
    expect(result.sans).toContain("Georgia");
    expect(result.sans).toContain("PingFang SC");
  });
});

describe("resolveMonoFontStack", () => {
  it("resolves a known mono font key to its stack", () => {
    expect(resolveMonoFontStack("jetbrains")).toContain("JetBrains Mono");
  });

  it("falls back to the system mono stack for an unknown key", () => {
    expect(resolveMonoFontStack("nonexistent")).toBe(fontStacks.mono.system);
    expect(resolveMonoFontStack("nonexistent")).toContain("ui-monospace");
  });

  it("matches the mono stack buildFontStack produces for the same key", () => {
    expect(resolveMonoFontStack("sfmono")).toBe(buildFontStack("system", "system", "sfmono").mono);
  });
});

describe("fontStacks", () => {
  it("has latin, cjk, and mono categories", () => {
    expect(fontStacks).toHaveProperty("latin");
    expect(fontStacks).toHaveProperty("cjk");
    expect(fontStacks).toHaveProperty("mono");
  });

  it("has system as a key in each category", () => {
    expect(fontStacks.latin).toHaveProperty("system");
    expect(fontStacks.cjk).toHaveProperty("system");
    expect(fontStacks.mono).toHaveProperty("system");
  });
});
