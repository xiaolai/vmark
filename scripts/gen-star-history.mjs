#!/usr/bin/env node
/**
 * Generate a self-hosted Star History chart as a static, theme-neutral SVG.
 *
 * Why: the live star-history.com embed (api.star-history.com/chart) server-renders
 * the SVG and consistently times out for this repo, so the README image 404/500s.
 * This fetches the real stargazer timestamps via the authenticated `gh` CLI and
 * renders a committed SVG that always loads and never depends on that service.
 *
 * Run: node scripts/gen-star-history.mjs   (requires `gh auth login`)
 * Output: .github/star-history.svg
 *
 * Colors are mid-tone so the chart reads on both light and dark GitHub themes
 * (GitHub sanitizes SVG <style>/prefers-color-scheme, so a single neutral asset
 * is more reliable than theme-swapped sources).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "xiaolai/vmark";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".github", "star-history.svg");

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
function buildSeries(times, maxPoints = 60) {
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

function niceMax(v) {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function render(series) {
  const W = 800, H = 400;
  const M = { top: 44, right: 28, bottom: 44, left: 56 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;

  const t0 = series[0][0], t1 = series[series.length - 1][0];
  const yMax = niceMax(series[series.length - 1][1]);
  const x = (t) => M.left + ((t - t0) / (t1 - t0 || 1)) * iw;
  const y = (c) => M.top + ih - (c / yMax) * ih;

  const line = series.map(([t, c], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${(M.top + ih).toFixed(1)} L${x(t0).toFixed(1)},${(M.top + ih).toFixed(1)} Z`;

  // gridlines + labels
  const yTicks = 5, xTicks = 6;
  const grid = [], yLabels = [], xLabels = [];
  for (let i = 0; i <= yTicks; i++) {
    const c = (yMax / yTicks) * i, yy = y(c);
    grid.push(`<line x1="${M.left}" y1="${yy.toFixed(1)}" x2="${(W - M.right).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#888" stroke-opacity="0.18"/>`);
    yLabels.push(`<text x="${M.left - 10}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#888">${Math.round(c)}</text>`);
  }
  for (let i = 0; i <= xTicks; i++) {
    const t = t0 + ((t1 - t0) / xTicks) * i, xx = x(t);
    xLabels.push(`<text x="${xx.toFixed(1)}" y="${(H - M.bottom + 20).toFixed(1)}" text-anchor="middle" font-size="12" fill="#888">${fmtDate(t)}</text>`);
  }

  const total = series[series.length - 1][1];
  const accent = "#3b82f6"; // blue — pops on light and dark
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <text x="${M.left}" y="26" font-size="16" font-weight="600" fill="#888">${REPO} — Star History</text>
  <text x="${(W - M.right).toFixed(1)}" y="26" text-anchor="end" font-size="14" fill="${accent}" font-weight="600">★ ${total}</text>
  ${grid.join("\n  ")}
  <path d="${area}" fill="url(#fill)"/>
  <path d="${line}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${yLabels.join("\n  ")}
  ${xLabels.join("\n  ")}
</svg>
`;
}

const times = fetchStarredAt();
if (!times.length) {
  console.error("No stargazers fetched — is `gh` authenticated?");
  process.exit(1);
}
const svg = render(buildSeries(times));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT} — ${times.length} stars, ${fmtDate(times[0])} → ${fmtDate(times[times.length - 1])}`);
