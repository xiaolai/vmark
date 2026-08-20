/**
 * Star-history chart generator — rendering contract.
 *
 * Unlike its neighbours here, this suite imports the subject IN-PROCESS rather
 * than spawning it: the interesting surface is `render()`, a pure function of a
 * (timestamp, count) series. That is only importable because the module guards
 * its `gh`-shelling main behind an entry-point check — without the guard, merely
 * importing it would hit the network. That guard is a tested property below.
 *
 * The properties that matter, and why:
 *
 *   - The font is EMBEDDED, not named. Referencing `'Comic Sans MS'` by name
 *     renders correctly only on machines that happen to have it; measured in
 *     headless Chromium with the SVG loaded through `<img>` (exactly how GitHub
 *     serves it), a named-only stack falls back to Times. A `data:` URI
 *     `@font-face` renders identically everywhere, so the chart must carry one.
 *   - No glyph outside the subset may appear as TEXT. The committed subset
 *     covers ASCII printable plus the em dash; `★` (U+2605) is in no candidate
 *     font — not even star-history.com's own xkcd Script — so it is drawn as a
 *     path. A literal `★` in a <text> node would silently fall back to a system
 *     font and undo the whole point.
 *   - Byte-identical output for identical input. The refresh workflow commits
 *     only when the file changed; a non-deterministic wobble would produce a
 *     commit every week forever.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { render, buildSeries, projectSeries, FONT_FAMILY } from "./gen-star-history.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;

/** A plausible growth series: `n` stars accruing one per day from a fixed epoch. */
const seriesOf = (n, from = Date.UTC(2026, 0, 20)) =>
  buildSeries(Array.from({ length: n }, (_, i) => from + i * DAY));

describe("font embedding", () => {
  it("embeds the subset font as a data: URI @font-face", () => {
    const svg = render(seriesOf(500));
    expect(svg).toMatch(/@font-face\s*\{/);
    expect(svg).toContain("src:url(data:font/woff2;base64,");
    expect(svg).toContain(`font-family:'${FONT_FAMILY}'`);
  });

  it("carries the real committed font bytes, not a placeholder", () => {
    const woff2 = readFileSync(resolve(HERE, "assets/comic-neue-subset.woff2"));
    expect(woff2.subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(render(seriesOf(120))).toContain(woff2.toString("base64"));
  });

  it("names the embedded family first, so the embed wins over any local font", () => {
    const svg = render(seriesOf(120));
    const family = /font-family="([^"]*)"/.exec(svg)?.[1] ?? "";
    expect(family.startsWith(`'${FONT_FAMILY}'`)).toBe(true);
  });
});

describe("no un-embedded glyphs", () => {
  it("draws the star as a path, never as a text glyph", () => {
    const svg = render(seriesOf(522));
    expect(svg).not.toContain("★");
    // the star is still THERE — as geometry, drawn by the same hand as the rest
    expect(svg).toMatch(/<path class="star" d="M/);
    expect(svg).toMatch(/<path class="star-fill" d="M/);
  });

  it("emits only subset-covered characters inside <text> nodes", () => {
    const svg = render(seriesOf(1200));
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      for (const ch of t) {
        const cp = ch.codePointAt(0);
        const covered = (cp >= 0x20 && cp <= 0x7e) || cp === 0x2014;
        expect(covered, `U+${cp.toString(16).toUpperCase()} (${ch}) is outside the subset`).toBe(true);
      }
    }
  });
});

describe("determinism", () => {
  it("renders byte-identical SVG for identical input", () => {
    const s = seriesOf(400);
    expect(render(s)).toBe(render(s));
  });

  it("renders different SVG when the data actually changed", () => {
    expect(render(seriesOf(400))).not.toBe(render(seriesOf(401)));
  });
});

describe("buildSeries", () => {
  it("downsamples to at most maxPoints but keeps the true final total", () => {
    const times = Array.from({ length: 5000 }, (_, i) => Date.UTC(2026, 0, 20) + i * 3600_000);
    const s = buildSeries(times, 30);
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s[s.length - 1]).toEqual([times[4999], 5000]);
  });

  it("passes short series through untouched", () => {
    const times = [1, 2, 3].map((d) => Date.UTC(2026, 0, d));
    expect(buildSeries(times, 30)).toEqual([
      [times[0], 1],
      [times[1], 2],
      [times[2], 3],
    ]);
  });

  it.each([1, 2])("renders a repo with only %i star(s)", (n) => {
    const svg = render(seriesOf(n));
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});

describe("import safety", () => {
  it("does not shell out to gh on import (main is entry-point guarded)", () => {
    const src = readFileSync(resolve(HERE, "gen-star-history.mjs"), "utf8");
    // the fetch must sit behind a guard, not at module top level
    expect(src).toMatch(/if\s*\(\s*isEntryPoint\s*\)/);
    expect(src).toMatch(/const isEntryPoint\s*=/);
  });
});

describe("y-axis headroom", () => {
  /** Largest y tick the chart prints. */
  const topLabel = (svg) =>
    Math.max(...[...svg.matchAll(/text-anchor="end" font-size="13"[^>]*>(\d+)</g)].map((m) => +m[1]));

  it.each([100, 101, 250, 499, 522, 750, 999, 1001, 4200])(
    "keeps the axis just above %i, never wastes half the plot",
    (total) => {
      const top = topLabel(render(seriesOf(total)));
      expect(top).toBeGreaterThanOrEqual(total);
      // 522 stars used to print a 1000 axis, squashing the curve into the
      // bottom half the moment the repo crossed 500.
      expect(top).toBeLessThanOrEqual(Math.ceil(total * 1.35));
    },
  );
});

/**
 * What makes a CURVE read as hand-drawn — and the two attempts that did not.
 *
 * ATTEMPT 1 shook a polyline with a hand-rolled PRNG, and the test here asserted
 * a mean local deviation above 0.35px while calling itself "draws a visibly
 * hand-drawn line". 0.35px is a quarter of the stroke's own half-width: the
 * wobble it certified was drawn INSIDE the line, where it cannot be seen.
 *
 * ATTEMPT 2 drew that polyline twice. Measurably doubled, still not art — a
 * chart made of straight segments with kinks at every data point, which is the
 * one thing a hand never produces.
 *
 * Both failed the same way: they measured a proxy (deviation, separation) that a
 * plotted-looking chart can satisfy. The chart is now drawn by rough.js, and
 * these assertions are about the properties that actually distinguish a drawing
 * from a plot:
 *
 *   - the data line is CUBIC BÉZIERS with no straight segments at all;
 *   - it is multi-stroked (rough.js draws each shape more than once);
 *   - the area is HACHURE — a bundle of ruled pen strokes, not a gradient;
 *   - the markers are sketched circles, not perfect ones;
 *   - and the whole thing still reports the real numbers, within a bound.
 *
 * Selection is by semantic CLASS, never by stroke colour: the hachure strokes
 * the area in the accent colour too, so a colour-based selector would silently
 * start measuring the shading instead of the line.
 */
describe("hand-drawn rendering", () => {
  const pathOf = (svg, cls) =>
    new RegExp(`<path class="${cls}" d="([^"]+)"`).exec(svg)?.[1] ?? "";
  const countOf = (svg, cls) => [...svg.matchAll(new RegExp(`class="${cls}"`, "g"))].length;

  it("draws the data line as curves, with no straight segments", () => {
    const d = pathOf(render(seriesOf(600)), "line");
    expect(d).not.toBe("");
    // `L` is the tell of a polyline. A hand does not draw those.
    expect(d).not.toMatch(/L/);
    expect((d.match(/C/g) ?? []).length).toBeGreaterThan(20);
  });

  it("multi-strokes the data line, as a pen retracing it would", () => {
    // rough.js emits each pass as its own subpath inside one OpSet, so the
    // number of `M` commands is the number of strokes.
    const d = pathOf(render(seriesOf(600)), "line");
    expect((d.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("shades the area with hachure strokes rather than a gradient", () => {
    const svg = render(seriesOf(600));
    expect(svg).not.toContain("linearGradient");
    const hachure = pathOf(svg, "area-hachure");
    // A bundle of separate ruled strokes — dozens of subpaths, not one shape.
    expect((hachure.match(/M/g) ?? []).length).toBeGreaterThan(20);
  });

  it("sketches the markers instead of stamping perfect circles", () => {
    const svg = render(seriesOf(600));
    expect(svg).not.toMatch(/<circle/);
    expect(countOf(svg, "dot")).toBeGreaterThan(5);
    expect(pathOf(svg, "dot")).toMatch(/C/);
  });

  it("draws the axes and ticks by the same hand", () => {
    const svg = render(seriesOf(600));
    expect(countOf(svg, "axis")).toBe(2);
    expect(countOf(svg, "tick")).toBeGreaterThan(5);
  });

  it("keeps the drawing within 1% of the y-range of the truth", () => {
    // The other side of the style knob: this may look drawn, but it still
    // reports real numbers. `projectSeries` is where the data really sits;
    // the markers cannot stand in for it, because a sketched circle's path
    // starts on its outline rather than at its centre (a 5.9px error that
    // looks exactly like a real one — this test asserted that by mistake).
    const s = seriesOf(600);
    const drawn = [...pathOf(render(s), "line").matchAll(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g)]
      .map((m) => [+m[1], +m[2]]);
    const { pts, ih } = projectSeries(s);
    const worst = Math.max(
      ...pts.map(([px, py]) => Math.min(...drawn.map(([qx, qy]) => Math.hypot(px - qx, py - qy)))),
    );
    expect(worst).toBeLessThan(0.01 * ih);
  });
});

describe("weights actually shipped", () => {
  it("never requests a font-weight the embedded face does not provide", () => {
    const svg = render(seriesOf(522));
    const declared = /@font-face\{[^}]*font-weight:(\d+)/.exec(svg)?.[1];
    expect(declared).toBe("400");
    // Asking for 600 against a 400-only face leaves each renderer to decide
    // whether to synthesize bold — the one thing embedding a font is meant to
    // stop. Ship one weight, request one weight.
    const requested = [...svg.matchAll(/font-weight="(\d+)"/g)].map((m) => m[1]);
    expect(requested.filter((w) => w !== "400")).toEqual([]);
  });
});
