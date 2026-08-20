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

import { render, buildSeries, FONT_FAMILY } from "./gen-star-history.mjs";

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
    // the star is still THERE — as filled geometry
    expect(svg).toMatch(/<path d="M[^"]*Z"\s+fill="[^"]*"\s+class="star"/);
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
 * What makes a CURVE read as hand-drawn — and why the previous test here passed
 * while it did not.
 *
 * That test asserted a mean local deviation above 0.35px and was named "draws a
 * visibly hand-drawn line". 0.35px is a quarter of the stroke's own half-width:
 * the wobble it certified was drawn INSIDE the line and could not be seen. The
 * chart shipped with hand-drawn axes and a data line that read as plotted, and
 * every test was green. It also pinned the subdivision COUNT (`> 50`), which is
 * an implementation detail — tuning the wobble coarser broke the test without
 * changing the property.
 *
 * The mechanism it missed: wobble is only perceivable against a known-ideal
 * shape. The axes have one — the eye holds a perfect straight line to compare
 * against, so a fraction of a pixel of tremor is obvious. A data curve has no
 * such reference, so any deviation reads as "the data did that" and raising the
 * amplitude only misstates the numbers. What no plotter produces is TWO
 * nearly-parallel strokes that separate and rejoin, which is why rough.js draws
 * everything twice and why this now does too.
 *
 * So the assertions below are about the doubling and whether it escapes the
 * stroke body — measurable things that track what the eye actually sees.
 */
describe("wobble", () => {
  /** The accent-coloured data strokes, as point arrays. */
  const dataStrokes = (svg) =>
    [...svg.matchAll(/<path d="(M[^"]+)" fill="none" stroke="#3b82f6"/g)]
      .map((m) => [...m[1].matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((p) => [+p[1], +p[2]]));

  it("draws the data line as two independently wobbled strokes", () => {
    const [a, b] = dataStrokes(render(seriesOf(600)));
    expect(a.length).toBeGreaterThan(2);
    expect(b).toHaveLength(a.length);
    // Independent draws, not one path reused at a second width — a copy would
    // render as a single thicker line and lose the entire effect.
    expect(b).not.toEqual(a);
  });

  it("separates the two strokes by more than the stroke's own half-width", () => {
    // The threshold is not a taste call: the wider stroke is 2.2px, so a
    // separation under 1.1px keeps the second stroke buried inside the first and
    // the doubling is invisible. Measured mean separation is ~1.39px, stable at
    // 120 / 522 / 600 / 2000 stars — this asserts the mechanism survives, not a
    // lucky number.
    for (const n of [120, 600, 2000]) {
      const [a, b] = dataStrokes(render(seriesOf(n)));
      const sep = a.map(([ax, ay], i) => Math.hypot(ax - b[i][0], ay - b[i][1]));
      const mean = sep.reduce((s, v) => s + v, 0) / sep.length;
      expect(mean, `mean stroke separation at n=${n}`).toBeGreaterThan(1.1);
    }
  });

  it("keeps the drawing within 2% of the y-range of the truth", () => {
    // The other side of the same knob: this chart may look hand-drawn, but it
    // still reports real numbers. `HAND.mag` is 5px against a 304px plot.
    const [a] = dataStrokes(render(seriesOf(600)));
    const ys = a.map(([, y]) => y);
    const dev = ys.slice(1, -1).map((y, i) => Math.abs(y - (ys[i] + ys[i + 2]) / 2));
    expect(Math.max(...dev)).toBeLessThan(0.02 * 304);
  });

  it("pins the markers to the drawn line, not to the ideal one", () => {
    // A dot at the true position sits visibly beside a stroke wobbled this far,
    // which reads as a rendering bug rather than as a marker.
    const svg = render(seriesOf(600));
    const [a] = dataStrokes(svg);
    const onStroke = new Set(a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`));
    const dots = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => `${m[1]},${m[2]}`);
    expect(dots.length).toBeGreaterThan(5);
    expect(dots.filter((d) => !onStroke.has(d))).toEqual([]);
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
