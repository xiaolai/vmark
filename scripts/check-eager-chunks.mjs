#!/usr/bin/env node
/**
 * Eager-chunk regression gate (audit 20260612 H9).
 *
 * "Lazy chunk became eager" regressions were previously invisible: a stray
 * static import drags a heavyweight chunk onto the cold-start
 * modulepreload list and nothing fails. This script parses dist/index.html
 * after a build and fails when a denylisted chunk family appears there.
 *
 * Run after `pnpm build` (wired into check:all as lint:eager).
 */

import { readFileSync, existsSync } from "node:fs";

// Chunk families that must NEVER be preloaded at cold start.
const DENYLIST = ["vendor-mermaid", "vendor-graph", "vendor-export"];

const INDEX = "dist/index.html";
if (!existsSync(INDEX)) {
  console.error(`check-eager-chunks: ${INDEX} not found — run pnpm build first.`);
  process.exit(64);
}

const html = readFileSync(INDEX, "utf8");
const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)]
  .map((m) => m[1]);
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const eager = [...preloads, ...scripts];

const offenders = eager.filter((href) =>
  DENYLIST.some((name) => href.includes(name))
);

if (offenders.length > 0) {
  console.error("❌ Lazy chunks regressed to eager (cold-start preload):");
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    "\nA static import somewhere now reaches these chunks. Find it with:\n" +
      "  pnpm size:why\nand convert it back to `await import(...)`."
  );
  process.exit(1);
}

console.log(
  `✅ Eager-chunk check passed (${eager.length} preloaded chunks, none denylisted).`
);
