// @vitest-environment node
// WI-UI1.7 — reduced motion has ONE owner (D9/R10).
/**
 * The global duration-collapse block in index.css is the mechanism; per-file
 * `prefers-reduced-motion` blocks are the failure mode this replaces (28
 * existed; 18 uncovered animations lived INSIDE files that had a block for
 * other selectors). Only rules that RESTORE a resting state survive, each
 * commented at the site.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const indexCss = readFileSync("src/styles/index.css", "utf8");

/** Files whose block RESTORES a resting state — commented at each site. */
const ALLOWLIST = [
  "src/plugins/multiCursor/multi-cursor.css",
  "src/plugins/syntaxReveal/syntax-reveal.css",
  "src/components/StatusBar/StatusBar.css",
  "src/styles/index.css",
  // The export reader is a self-contained bundle outside the app cascade.
  "src/export/reader/vmark-reader.css",
];

describe("global reduced-motion collapse (D9)", () => {
  it("index.css carries the duration collapse, not animation: none", () => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(indexCss);
    expect(m, "global block present").not.toBeNull();
    const body = m![1];
    expect(body).toContain("animation-duration: 0.01ms !important");
    expect(body).toContain("animation-iteration-count: 1 !important");
    expect(body).toContain("transition-duration: 0.01ms !important");
    expect(body).toContain("scroll-behavior: auto !important");
    // A collapse preserves `forwards` end states; `animation: none` does not.
    expect(body).not.toContain("animation: none");
  });

  it("no CSS file outside the resting-state allowlist declares its own block", () => {
    const offenders = globSync("src/**/*.css")
      .filter((f) => !ALLOWLIST.includes(f))
      .filter((f) => /@media\s*\(prefers-reduced-motion/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("every allowlisted block carries the KEPT comment naming its resting state", () => {
    for (const f of ALLOWLIST) {
      if (f === "src/styles/index.css" || f.startsWith("src/export/")) continue;
      const css = readFileSync(f, "utf8");
      expect(css, f).toContain("KEPT under the global duration-collapse");
    }
  });

  it("the block is UNLAYERED so it also neutralises Tailwind animate-* utilities", () => {
    // If the block ever moves inside @layer, Tailwind's layered utilities win
    // the cascade and animate-spin ignores the preference.
    const at = indexCss.indexOf("@media (prefers-reduced-motion: reduce)");
    const before = indexCss.slice(0, at);
    const layerOpens = (before.match(/@layer[^;{]*\{/g) ?? []).length;
    const layerCloses = 0; // index.css declares no @layer blocks at all today
    expect(layerOpens).toBe(layerCloses);
  });
});
