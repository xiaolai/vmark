#!/usr/bin/env node
/**
 * Generates `dev-docs/architecture-metrics.md` — coupling & instability from
 * dependency-cruiser, bounded to the actionable view: every top-level `src`
 * folder, plus the most-coupled individual modules (the god-module watch list).
 *
 * Metrics: Ca = afferent coupling (who depends on it), Ce = efferent coupling
 * (what it depends on), I = instability Ce/(Ca+Ce) (0% = stable/depended-on,
 * 100% = unstable/leaf). High Ca + low I = a load-bearing hub to change with
 * care; high Ce = a module reaching into many others.
 *
 * Regenerate: `pnpm arch:metrics`. Do not hand-edit the output.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const raw = execFileSync(
  "node_modules/.bin/depcruise",
  [
    "src",
    "--config",
    ".dependency-cruiser.cjs",
    "--exclude",
    "node_modules|\\.test\\.|\\.bench\\.|\\.stories\\.",
    "--output-type",
    "metrics",
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const num = (s) => Number(String(s).replace(/,/g, "")) || 0;
const rows = [];
for (const line of raw.split("\n")) {
  const p = line.trim().split(/\s+/);
  if ((p[0] !== "folder" && p[0] !== "module") || !p[1]) continue;
  rows.push({ type: p[0], name: p[1], ca: num(p[3]), ce: num(p[4]), i: p[5] });
}

const topFolders = rows
  .filter((r) => r.type === "folder" && /^src\/[^/]+$/.test(r.name))
  .sort((a, b) => b.ca + b.ce - (a.ca + a.ce));
const topModules = rows
  .filter((r) => r.type === "module")
  .sort((a, b) => b.ca + b.ce - (a.ca + a.ce))
  .slice(0, 30);

const tbl = (list) =>
  [
    "| Module | Ca (used by) | Ce (uses) | I (instability) |",
    "|---|--:|--:|--:|",
    ...list.map((r) => `| \`${r.name}\` | ${r.ca} | ${r.ce} | ${r.i} |`),
  ].join("\n");

const doc = `# VMark architecture — coupling metrics (generated)

Computed by \`dependency-cruiser\`. **Ca** = afferent (who depends on it),
**Ce** = efferent (what it depends on), **I** = instability \`Ce/(Ca+Ce)\`
(0% = stable core, 100% = unstable leaf). Regenerate with \`pnpm arch:metrics\`;
do not hand-edit. See \`architecture-graph.md\` for the visual.

## Top-level \`src\` folders (by total coupling)

${tbl(topFolders)}

## Most-coupled modules (top 30 — the change-with-care / god-module watch list)

High **Ca** with low **I** = a hub many modules depend on. High **Ce** = a
module reaching broadly. Either is a signal to keep the file small and stable.

${tbl(topModules)}
`;

writeFileSync("dev-docs/architecture-metrics.md", doc);
console.log("wrote dev-docs/architecture-metrics.md");
