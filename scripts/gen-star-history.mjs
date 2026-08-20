#!/usr/bin/env node
/**
 * Generate a self-hosted Star History chart as a static, theme-neutral SVG,
 * in the hand-drawn (chart.xkcd) style of star-history.com's own charts:
 * wobbly line, handwriting font, dots on data points.
 *
 * Why self-hosted — and it is now the ONLY way this can work, not a workaround
 * for a flaky service. On 2026-06-30 GitHub restricted the stargazers API
 * (`/repos/{owner}/{repo}/stargazers`) to a repository's own admins and
 * collaborators, because the data was being harvested to spam users. Verified:
 * that endpoint returns 404 for any repo you don't own. star-history.com's
 * servers aren't a collaborator on anyone's repo, so api.star-history.com now
 * serves a byte-identical "GitHub restricted access to star data" notice for
 * EVERY repo — including nonexistent ones — under `x-chart-status: restricted`.
 * There is no chart there to link to. This script authenticates as the repo
 * owner via `gh`, which is exactly the case GitHub still permits.
 *
 * Run: node scripts/gen-star-history.mjs   (requires `gh auth login`)
 * Output: .github/star-history.svg
 *
 * Why the font is EMBEDDED rather than named: this SVG is served through an
 * <img> tag, and in that context nothing but the file itself is available.
 * Naming a stack ('Comic Sans MS', 'Chalkboard SE', cursive) renders correctly
 * only on machines that happen to have one installed — measured in headless
 * Chromium, a named-only stack falls back to TIMES. The same SVG with a
 * `data:` URI @font-face renders hand-drawn everywhere. `assets/` carries a
 * Comic Neue subset (ASCII printable + em dash) and its OFL license.
 *
 * star-history.com's own charts embed `xkcd Script`, which is CC BY-NC 3.0 and
 * therefore cannot ship inside an ISC repository: ISC grants downstream users
 * "any purpose", including commercial, which is precisely the right the NC
 * clause withholds. Comic Neue is OFL 1.1 with no Reserved Font Name.
 *
 * `★` (U+2605) is in NO candidate handwriting font — not even xkcd Script — so
 * it is drawn as a path. A literal ★ in a <text> node would fall back to a
 * system font and undo the embedding.
 *
 * Colors are mid-tone so the chart reads on both light and dark GitHub themes
 * (GitHub sanitizes SVG <style>/prefers-color-scheme, so a single neutral asset
 * is more reliable than theme-swapped sources).
 *
 * WHY ROUGH.JS AND NOT A HAND-ROLLED WOBBLE. This file used to shake a polyline
 * with its own PRNG, and the result never read as hand-drawn — the axes did,
 * because the eye holds a perfect straight line to compare them against, but the
 * data line did not, because a curve offers no such reference and every
 * deviation just reads as "the data did that". Shaking it harder only misstates
 * the numbers. Two things fix it, and both come free from rough.js:
 *
 *   1. CURVES. A hand does not draw polylines. rough.js emits cubic Béziers
 *      (`bcurveTo` ops), and multi-strokes each shape by default, which is the
 *      cue that reads as a pen on a shape with no ideal to compare against.
 *   2. HACHURE. Shading as a bundle of ruled pen strokes is something a person
 *      could have done; a smooth vertical gradient is unmistakably a machine.
 *
 * `rough.generator()` is the DOM-free entry point — `rough.canvas()`/`rough.svg()`
 * both need a document — and `opsToPath` serialises an OpSet to an SVG `d`
 * string, so this runs under plain Node with no jsdom. roughjs is MIT, which ISC
 * can carry (unlike chart.xkcd's `xkcd Script` font — see above).
 *
 * Every shape is given an explicit `seed`, reset per render: identical star data
 * must produce byte-identical SVG, because the refresh workflow commits only
 * when the file changed. Unseeded, rough.js would randomise every run and commit
 * a new chart every week forever.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import rough from "roughjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = "xiaolai/vmark";
const OUT = resolve(HERE, "..", ".github", "star-history.svg");

/** Family name written into the SVG. Matches the subset's own `name` table. */
export const FONT_FAMILY = "Comic Neue";
const FONT_FILE = resolve(HERE, "assets", "comic-neue-subset.woff2");

// --- fetch all stargazers with timestamps (paginated) ---
function fetchStarredAt() {
  const raw = execFileSync(
    "gh",
    ["api", "--paginate", "-H", "Accept: application/vnd.github.star+json", `/repos/${REPO}/stargazers?per_page=100`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  // `gh api --paginate` concatenates JSON arrays as `][` between pages; normalise.
  const json = JSON.parse("[" + raw.replace(/\]\s*\[/g, ",").replace(/^\[|\]$/g, "") + "]");
  return json
    .map((s) => new Date(s.starred_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
}

// --- build a cumulative (t, count) series, downsampled for a clean line ---
export function buildSeries(times, maxPoints = 30) {
  const n = times.length;
  const pts = times.map((t, i) => [t, i + 1]); // (timestamp, cumulative count)
  if (n <= maxPoints) return pts;
  const step = (n - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    out.push(pts[Math.min(idx, n - 1)]);
  }
  // always include the final point (today's total)
  out[out.length - 1] = pts[n - 1];
  return out;
}

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

/**
 * Smallest "round" value at or above `v`, for the y-axis top.
 *
 * The mantissa ladder is deliberately fine-grained. A coarse [1, 2, 2.5, 5, 10]
 * ladder jumps 500 → 1000, so the day this repo crossed 500 stars the curve
 * collapsed into the bottom half of the plot with the whole upper half blank.
 * Every step here is within 1.25x of the one below it, which bounds the wasted
 * headroom; `gen-star-history.test.mjs` pins that bound.
 */
function niceMax(v) {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/**
 * One rough.js generator for the whole chart. `rough.generator()` needs no DOM —
 * unlike `rough.canvas()`/`rough.svg()`, which do — so it runs under plain Node,
 * and `opsToPath` serialises its OpSets straight to an SVG `d` string.
 */
const gen = rough.generator();

/**
 * Deterministic seeds. rough.js randomises per shape unless given a `seed`, and
 * the refresh workflow commits only when the file changed — an unseeded chart
 * would produce a commit every week forever. Reset per render so output depends
 * on the DATA alone.
 */
let seedCounter = 0;
const nextSeed = () => (seedCounter += 7919);

/**
 * Every OpSet of a rough.js drawable, as SVG markup.
 *
 * Each path carries a semantic `class`, so the tests can ask for "the data line"
 * rather than matching on a stroke colour or width. Both of those are shared —
 * the hachure strokes the area in the ACCENT colour too — and a test that
 * selected by colour would silently start measuring the shading instead.
 */
function drawablePaths(drawable, cls, { stroke, strokeWidth, fill, fillOpacity = 1 }) {
  return drawable.sets
    .map((set) => {
      const d = gen.opsToPath(set);
      // Hachure/zigzag shading: a bundle of separate strokes, not a filled shape.
      if (set.type === "fillSketch") {
        return `<path class="${cls}-hachure" d="${d}" fill="none" stroke="${fill}" stroke-width="${drawable.options.fillWeight}" stroke-linecap="round" opacity="${fillOpacity}"/>`;
      }
      if (set.type === "fillPath") {
        return `<path class="${cls}-fill" d="${d}" fill="${fill}" stroke="none" opacity="${fillOpacity}"/>`;
      }
      return `<path class="${cls}" d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("\n  ");
}

/**
 * Five-pointed star, drawn by the same hand as everything else. U+2605 is absent
 * from every handwriting font considered here (including star-history.com's own
 * xkcd Script), so it has to be geometry; a literal ★ in a <text> node would
 * fall back to a system font and undo the embedding.
 */
function starDrawable(cx, cy, R) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const r = i % 2 === 0 ? R : R * 0.42;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return gen.polygon(pts, {
    seed: nextSeed(), roughness: 0.8, fill: ACCENT, fillStyle: "solid", stroke: ACCENT, strokeWidth: 1.2,
  });
}

/** The subset font, inlined — see the header for why naming it is not enough. */
function fontFaceStyle() {
  const b64 = readFileSync(FONT_FILE).toString("base64");
  return `<style>@font-face{font-family:'${FONT_FAMILY}';font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${b64}) format('woff2');}</style>`;
}

/** Plot box, in SVG units. */
export const PLOT = { W: 800, H: 400, M: { top: 48, right: 28, bottom: 48, left: 56 } };

/**
 * Project a series onto plot pixels — the TRUE positions, before any hand is
 * applied.
 *
 * Exported because it is the only thing that knows where the data really sits,
 * and the accuracy bound is worth testing. The markers cannot stand in for it:
 * a sketched circle's path starts somewhere on its outline, ~half a marker away
 * from the point it marks, which is a 5.9px error that reads as a real one.
 */
export function projectSeries(series) {
  const { W, H, M } = PLOT;
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const t0 = series[0][0], t1 = series[series.length - 1][0];
  const yMax = niceMax(series[series.length - 1][1]);
  const x = (t) => M.left + ((t - t0) / (t1 - t0 || 1)) * iw;
  const y = (c) => M.top + ih - (c / yMax) * ih;
  return { x, y, yMax, iw, ih, t0, t1, xAxisY: M.top + ih, pts: series.map(([t, c]) => [x(t), y(c)]) };
}

export function render(series) {
  const { W, H, M } = PLOT;
  seedCounter = 0; // output must depend on the data alone

  const { x, y, yMax, t0, t1, xAxisY, pts } = projectSeries(series);

  // The data line is a rough.js CURVE, so it is cubic Béziers — a polyline is
  // the one thing a hand never draws, and no amount of shaking a polyline fixes
  // that. rough.js also multi-strokes by default, which is the cue that reads as
  // pen-on-paper on a shape the eye has no ideal to compare against.
  const curve = gen.curve(pts, {
    seed: nextSeed(), roughness: HAND.roughness, bowing: HAND.bowing, strokeWidth: HAND.strokeWidth,
  });

  // Hachure, not a gradient: a bundle of ruled pen strokes is shading a person
  // could have done, and a smooth vertical gradient is unmistakably a machine.
  // Solid fill was tried and buries the chart in a block of colour.
  const area = gen.polygon([...pts, [x(t1), xAxisY], [x(t0), xAxisY]], {
    seed: nextSeed(), roughness: 1.0, fill: ACCENT, fillStyle: "hachure",
    fillWeight: HAND.fillWeight, hachureGap: HAND.hachureGap, hachureAngle: -41, stroke: "none",
  });

  // Axes: LOW bowing. `bowing: 2` over a 300px axis bends the whole line into a
  // lens — measured, and it looked like a bug rather than a hand.
  const axisOpts = { roughness: 0.9, bowing: 0.4, strokeWidth: 1.9 };
  const tickOpts = { roughness: 0.8, bowing: 0.3, strokeWidth: 1.5 };
  const inkLine = (x1, y1, x2, y2, opts, cls) =>
    drawablePaths(gen.line(x1, y1, x2, y2, { seed: nextSeed(), ...opts }), cls, { stroke: INK, strokeWidth: opts.strokeWidth });
  const axes = [
    inkLine(M.left, M.top - 8, M.left, xAxisY, axisOpts, "axis"),
    inkLine(M.left, xAxisY, W - M.right + 6, xAxisY, axisOpts, "axis"),
  ];

  const yTicks = 5, xTicks = 6;
  const ticks = [], yLabels = [], xLabels = [];
  for (let i = 1; i <= yTicks; i++) {
    const c = (yMax / yTicks) * i, yy = y(c);
    ticks.push(inkLine(M.left - 5, yy, M.left, yy, tickOpts, "tick"));
    yLabels.push(`<text x="${M.left - 10}" y="${(yy + 5).toFixed(1)}" text-anchor="end" font-size="13" fill="${INK}">${Math.round(c)}</text>`);
  }
  for (let i = 0; i <= xTicks; i++) {
    const t = t0 + ((t1 - t0) / xTicks) * i, xx = x(t);
    ticks.push(inkLine(xx, xAxisY, xx, xAxisY + 5, tickOpts, "tick"));
    xLabels.push(`<text x="${xx.toFixed(1)}" y="${(H - M.bottom + 24).toFixed(1)}" text-anchor="middle" font-size="13" fill="${INK}">${fmtDate(t)}</text>`);
  }

  // Markers, drawn by the same hand: a perfect circle beside a sketched line is
  // the tell that the "hand-drawn" chart was assembled by a machine.
  const dots = pts
    .map(([cx, cy]) =>
      drawablePaths(
        gen.circle(cx, cy, 7.5, { seed: nextSeed(), roughness: 1.0, fill: "#fff", fillStyle: "solid", strokeWidth: 1.7 }),
        "dot",
        { stroke: ACCENT, strokeWidth: 1.7, fill: "#fff" },
      ))
    .join("\n  ");

  const total = series[series.length - 1][1];
  // The count is right-aligned, so the star sits at an ESTIMATED text width to
  // its left — an SVG has no text metrics, and ~8.6px/digit measures right for
  // Comic Neue at 15px. Being a pixel off is invisible; a missing glyph is not.
  const countRight = W - M.right;
  const starCx = countRight - String(total).length * 8.6 - 11;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'${FONT_FAMILY}','Comic Sans MS',cursive">
  <defs>
    ${fontFaceStyle()}
  </defs>
  <text x="${M.left}" y="28" font-size="17" fill="${INK}">${REPO} — Star History</text>
  ${drawablePaths(starDrawable(starCx, 22.5, 7.5), "star", { stroke: ACCENT, strokeWidth: 1.2, fill: ACCENT })}
  <text x="${countRight.toFixed(1)}" y="28" text-anchor="end" font-size="15" fill="${ACCENT}">${total}</text>
  ${drawablePaths(area, "area", { fill: ACCENT, fillOpacity: HAND.fillOpacity })}
  ${drawablePaths(curve, "line", { stroke: ACCENT, strokeWidth: HAND.strokeWidth })}
  ${dots}
  ${axes.join("\n  ")}
  ${ticks.join("\n  ")}
  ${yLabels.join("\n  ")}
  ${xLabels.join("\n  ")}
</svg>
`;
}

const ACCENT = "#3b82f6"; // blue — pops on light and dark
const INK = "#8b8b8b"; // pencil grey for axes, ticks and labels

/**
 * The hand. Chosen by RENDERING candidates and looking at them, not by
 * reasoning about numbers — this is the one thing here that only the eye can
 * settle, and the previous attempt failed precisely by arguing it instead.
 *
 * `roughness`/`bowing` are rough.js's tremor and bend. `hachureGap` 13 with
 * `fillOpacity` 0.5 reads as shading; denser buries the plot, a solid fill
 * (tried) buries it completely, and much sparser stops reading as fill at all.
 *
 * Accuracy: rough.js's displacement is bounded by `roughness`, and the drawn
 * curve stays within ~2.2px of every true data point on a 304px-tall plot —
 * under 1%. A test holds that bound, because this is the one knob that trades
 * honesty about the numbers for style.
 */
const HAND = {
  roughness: 1.5,
  bowing: 1.5,
  strokeWidth: 2.6,
  fillWeight: 1.0,
  hachureGap: 13,
  fillOpacity: 0.5,
};

// Only fetch when RUN, never when imported: the test suite drives `render()`
// directly, and an unguarded top-level `gh` call would make importing this
// module hit the network.
const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  const times = fetchStarredAt();
  if (!times.length) {
    console.error("No stargazers fetched — is `gh` authenticated?");
    process.exit(1);
  }
  const svg = render(buildSeries(times));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg);
  console.log(`Wrote ${OUT} — ${times.length} stars, ${fmtDate(times[0])} → ${fmtDate(times[times.length - 1])}`);
}
