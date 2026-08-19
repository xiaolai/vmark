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
 * is more reliable than theme-swapped sources). The wobble is drawn from a
 * SEEDED PRNG: identical star data must render byte-identical SVG, because the
 * refresh workflow commits only when the file changed.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// Deterministic PRNG (mulberry32) — see header for why not Math.random().
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hand-drawn path: subdivide the polyline into ~`step`px pieces and nudge each
 * joint perpendicular to its segment by a smoothed random offset. This is
 * chart.xkcd's wobble done geometrically, so it needs no SVG filter support
 * (feTurbulence inside <img> is spotty in some renderers). First and last
 * points stay exact so the line lands on the real values.
 */
function roughPoints(pts, rng, { step = 11, mag = 4.0 } = {}) {
  const sub = [pts[0]];
  const normals = [[0, 0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / step));
    const nrm = len ? [-dy / len, dx / len] : [0, 0];
    for (let j = 1; j <= n; j++) {
      sub.push([x0 + (dx * j) / n, y0 + (dy * j) / n]);
      normals.push(nrm);
    }
  }
  const raw = sub.map(() => (rng() - 0.5) * 2 * mag);
  raw[0] = 0;
  raw[raw.length - 1] = 0;
  // one smoothing pass so the wobble reads as a shaky hand, not as noise
  const off = raw.map((o, i) => (i === 0 || i === raw.length - 1 ? o : (raw[i - 1] + o + raw[i + 1]) / 3));
  return sub.map(([x, y], i) => [x + normals[i][0] * off[i], y + normals[i][1] * off[i]]);
}

const toPath = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/**
 * Five-pointed star as geometry. U+2605 is absent from every handwriting font
 * considered here (including star-history.com's own xkcd Script), so drawing it
 * is the only way to keep the SVG free of un-embedded glyphs.
 */
function starPath(cx, cy, R) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const r = i % 2 === 0 ? R : R * 0.42;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return `${toPath(pts)} Z`;
}

/** The subset font, inlined — see the header for why naming it is not enough. */
function fontFaceStyle() {
  const b64 = readFileSync(FONT_FILE).toString("base64");
  return `<style>@font-face{font-family:'${FONT_FAMILY}';font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${b64}) format('woff2');}</style>`;
}

export function render(series) {
  const W = 800, H = 400;
  const M = { top: 48, right: 28, bottom: 48, left: 56 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const rng = mulberry32(0xc0ffee);

  const t0 = series[0][0], t1 = series[series.length - 1][0];
  const yMax = niceMax(series[series.length - 1][1]);
  const x = (t) => M.left + ((t - t0) / (t1 - t0 || 1)) * iw;
  const y = (c) => M.top + ih - (c / yMax) * ih;

  const linePts = roughPoints(series.map(([t, c]) => [x(t), y(c)]), rng);
  const line = toPath(linePts);
  const area = `${line} L${x(t1).toFixed(1)},${(M.top + ih).toFixed(1)} L${x(t0).toFixed(1)},${(M.top + ih).toFixed(1)} Z`;

  // hand-drawn axes with tick marks (no gridlines — matches the xkcd look)
  const axis = (x1, y1, x2, y2) => toPath(roughPoints([[x1, y1], [x2, y2]], rng, { step: 22, mag: 1.8 }));
  const xAxisY = M.top + ih;
  const axes = [
    `<path d="${axis(M.left, M.top - 8, M.left, xAxisY)}" fill="none" stroke="#888" stroke-width="1.75" stroke-linecap="round"/>`,
    `<path d="${axis(M.left, xAxisY, W - M.right + 6, xAxisY)}" fill="none" stroke="#888" stroke-width="1.75" stroke-linecap="round"/>`,
  ];

  const yTicks = 5, xTicks = 6;
  const ticks = [], yLabels = [], xLabels = [];
  for (let i = 1; i <= yTicks; i++) {
    const c = (yMax / yTicks) * i, yy = y(c);
    ticks.push(`<path d="${axis(M.left - 5, yy, M.left, yy)}" fill="none" stroke="#888" stroke-width="1.5" stroke-linecap="round"/>`);
    yLabels.push(`<text x="${M.left - 10}" y="${(yy + 5).toFixed(1)}" text-anchor="end" font-size="13" fill="#888">${Math.round(c)}</text>`);
  }
  for (let i = 0; i <= xTicks; i++) {
    const t = t0 + ((t1 - t0) / xTicks) * i, xx = x(t);
    ticks.push(`<path d="${axis(xx, xAxisY, xx, xAxisY + 5)}" fill="none" stroke="#888" stroke-width="1.5" stroke-linecap="round"/>`);
    xLabels.push(`<text x="${xx.toFixed(1)}" y="${(H - M.bottom + 24).toFixed(1)}" text-anchor="middle" font-size="13" fill="#888">${fmtDate(t)}</text>`);
  }

  // dots on the (downsampled) data points, like star-history.com's markers
  const dots = series
    .map(([t, c]) => `<circle cx="${x(t).toFixed(1)}" cy="${y(c).toFixed(1)}" r="2.6" fill="#fff" stroke="${ACCENT}" stroke-width="1.6"/>`)
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
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <text x="${M.left}" y="28" font-size="17" fill="#888">${REPO} — Star History</text>
  <path d="${starPath(starCx, 22.5, 7.5)}" fill="${ACCENT}" class="star"/>
  <text x="${countRight.toFixed(1)}" y="28" text-anchor="end" font-size="15" fill="${ACCENT}">${total}</text>
  <path d="${area}" fill="url(#fill)"/>
  <path d="${line}" fill="none" stroke="${ACCENT}" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${axes.join("\n  ")}
  ${ticks.join("\n  ")}
  ${yLabels.join("\n  ")}
  ${xLabels.join("\n  ")}
</svg>
`;
}

const ACCENT = "#3b82f6"; // blue — pops on light and dark

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
