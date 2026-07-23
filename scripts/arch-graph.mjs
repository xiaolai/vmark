#!/usr/bin/env node
/**
 * Generates `dev-docs/architecture-graph.md` — the current `src/<top-level>`
 * dependency graph, computed from the real import graph by dependency-cruiser
 * (node_modules, tests, and benches excluded). This is the COMPUTED counterpart
 * to the hand-authored `architecture.md` C4 map; when they disagree, this is the
 * ground truth (hand docs drift — the 2026-07-22 ADR audit proved it).
 *
 * Regenerate: `pnpm arch:graph`. Do not hand-edit the output.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const mermaid = execFileSync(
  "node_modules/.bin/depcruise",
  [
    "src",
    "--config",
    ".dependency-cruiser.cjs",
    "--exclude",
    "node_modules|\\.test\\.|\\.bench\\.|\\.stories\\.",
    "--collapse",
    "^src/[^/]+/",
    "--output-type",
    "mermaid",
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
).trim();

const doc = `# VMark architecture — dependency graph (generated)

Computed from the real import graph by \`dependency-cruiser\`, collapsed to
\`src/<top-level>\` (node_modules, tests, and benches excluded). The COMPUTED
counterpart to the hand-authored \`architecture.md\` C4 map — when they disagree,
**this is the ground truth**. Regenerate with \`pnpm arch:graph\`; do not hand-edit.

\`\`\`mermaid
${mermaid}
\`\`\`
`;

writeFileSync("dev-docs/architecture-graph.md", doc);
console.log("wrote dev-docs/architecture-graph.md");
