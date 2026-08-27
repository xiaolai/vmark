// @vitest-environment node
/**
 * fontStacks — pure font-stack resolution tests
 *
 *   - Latin / CJK / mono stack resolution and fallbacks
 *   - Trailing-generic stripping so the CJK Font setting takes effect (#1056)
 *   - No `ui-*` generic reaches Linux, where WebKitGTK resolves them to the
 *     proportional GTK UI font (#1334)
 */

import { describe, it, expect } from "vitest";
import { buildFontStack, fontStacks, resolveMonoFontStack } from "./fontStacks";
import type { RuntimePlatform } from "./platform";

const PLATFORMS: RuntimePlatform[] = ["macos", "windows", "linux"];

describe("buildFontStack", () => {
  it("resolves known latin font to its stack", () => {
    const result = buildFontStack("athelas", "system", "system", "macos");
    expect(result.sans).toContain("Athelas");
  });

  it("resolves known CJK font into the sans stack", () => {
    const result = buildFontStack("system", "songti", "system", "macos");
    expect(result.sans).toContain("Songti SC");
  });

  it("resolves known mono font", () => {
    const result = buildFontStack("system", "system", "jetbrains", "macos");
    expect(result.mono).toContain("JetBrains Mono");
  });

  it("falls back to system for unknown latin font key", () => {
    const result = buildFontStack("nonexistent", "system", "system", "macos");
    expect(result.sans).toContain("system-ui");
  });

  it("falls back to system for unknown CJK font key", () => {
    const result = buildFontStack("system", "nonexistent", "system", "macos");
    expect(result.sans).toContain("PingFang SC");
  });

  it("falls back to system for unknown mono font key", () => {
    const result = buildFontStack("system", "system", "nonexistent", "macos");
    expect(result.mono).toContain("ui-monospace");
  });

  it("combines latin and CJK in the sans stack", () => {
    const result = buildFontStack("georgia", "kaiti", "system", "macos");
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
    const result = buildFontStack("athelas", "songti", "system", "macos");
    const cjkIdx = result.sans.indexOf("Songti SC");
    // No "serif"/"sans-serif" token may appear before the first CJK font.
    const head = result.sans.slice(0, cjkIdx);
    expect(head).not.toMatch(/(^|,\s*)(serif|sans-serif)\s*(,|$)/);
  });

  it("keeps the CJK stack's trailing generic as the overall fallback", () => {
    const result = buildFontStack("athelas", "songti", "system", "macos");
    // Songti's stack ends in `serif`; that becomes the final fallback.
    expect(result.sans.trim().endsWith("serif")).toBe(true);
  });

  it("lets the CJK font category survive a serif Latin choice", () => {
    // Latin=Athelas (serif) must not force a sans-serif CJK font to serif.
    const result = buildFontStack("athelas", "sourcehans", "system", "macos");
    const cjkIdx = result.sans.indexOf("Source Han Sans SC");
    const head = result.sans.slice(0, cjkIdx);
    expect(head).not.toContain("serif");
    // The sans-serif fallback from the CJK stack is preserved at the tail.
    expect(result.sans.trim().endsWith("sans-serif")).toBe(true);
  });

  it("still resolves the Latin font for a system CJK selection", () => {
    // Stripping the trailing generic must not drop the named Latin fonts.
    const result = buildFontStack("georgia", "system", "system", "macos");
    expect(result.sans).toContain("Georgia");
    expect(result.sans).toContain("PingFang SC");
  });
});

describe("resolveMonoFontStack", () => {
  it("resolves a known mono font key to its stack", () => {
    expect(resolveMonoFontStack("jetbrains", "macos")).toContain("JetBrains Mono");
  });

  it("falls back to the platform default for an unknown key", () => {
    // Same result the "system" key gives — the pre-#1334 behaviour, which
    // resolved an unknown key through `fontStacks.mono.system`.
    for (const platform of PLATFORMS) {
      expect(resolveMonoFontStack("nonexistent", platform)).toBe(
        resolveMonoFontStack("system", platform),
      );
    }
  });

  it("matches the mono stack buildFontStack produces for the same key", () => {
    for (const platform of PLATFORMS) {
      expect(resolveMonoFontStack("sfmono", platform)).toBe(
        buildFontStack("system", "system", "sfmono", platform).mono,
      );
    }
  });

  // #1334: `ui-monospace` is not implemented on WebKitGTK — it returns the GTK
  // *UI* font (proportional) for every ui-* generic, and a generic always
  // matches, so it wins the cascade. xterm.js then sizes its character cell
  // from a proportional 'W' and the whole grid renders spaced out.
  it("emits no ui-* generic on linux, for any mono key", () => {
    for (const key of Object.keys(fontStacks.mono)) {
      expect(resolveMonoFontStack(key, "linux")).not.toMatch(/\bui-[a-z]+\b/);
    }
  });

  it("still ends in a monospace generic on linux, for any mono key", () => {
    // Losing ui-monospace must not leave the stack without a fallback: the
    // generic is the only reliable monospace on WebKitGTK, and it is what
    // honours the desktop's own monospace choice.
    for (const key of Object.keys(fontStacks.mono)) {
      expect(resolveMonoFontStack(key, "linux")).toMatch(/(^|,\s*)monospace$/);
    }
  });

  it("keeps ui-monospace on macOS — the only way to reach SF Mono in WebKit", () => {
    // "SF Mono" and SFMono-Regular do not match by family name in WebKit (the
    // real family is the hidden ".SF NS Mono"), so dropping ui-monospace
    // everywhere would silently regress the primary platform to Menlo.
    expect(resolveMonoFontStack("system", "macos")).toContain("ui-monospace");
    expect(resolveMonoFontStack("sfmono", "macos")).toContain("ui-monospace");
  });

  it("keeps the chosen family ahead of the platform fallback", () => {
    for (const platform of PLATFORMS) {
      const stack = resolveMonoFontStack("jetbrains", platform);
      expect(stack.indexOf("JetBrains Mono")).toBeLessThan(stack.indexOf("monospace"));
    }
  });

  it("offers mono families that exist on a stock Linux desktop (#1334)", () => {
    // Before this, every named option was macOS- or Windows-only or a font the
    // user had to install, so a Linux user had nothing in the list to pick.
    expect(fontStacks.mono).toHaveProperty("dejavu");
    expect(fontStacks.mono).toHaveProperty("liberation");
    expect(fontStacks.mono).toHaveProperty("ubuntumono");
    expect(fontStacks.mono).toHaveProperty("notosansmono");
    expect(fontStacks.mono).toHaveProperty("notosansmonocjk");
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
