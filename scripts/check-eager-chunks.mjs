#!/usr/bin/env node
/**
 * Eager-chunk regression gate (audit 20260612 H9).
 *
 * "Lazy chunk became eager" regressions were previously invisible: a stray
 * static import drags a heavyweight chunk onto the cold-start
 * modulepreload list and nothing fails. This script parses dist/index.html
 * after a build and fails when a denylisted chunk family appears there.
 *
 * Parsing is attribute-order and quote-style agnostic (Codex audit: a
 * rel/href reorder or quote change in Vite's output must not silently
 * disable the gate). Both `<link rel=modulepreload href>` and
 * `<script src>` (the eager entry module) are considered cold-start eager.
 *
 * Run after `pnpm build` (wired into check:all as lint:eager).
 * Parsing helpers are exported for scripts/check-eager-chunks.test.ts.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Chunk families that must NEVER be preloaded at cold start.
export const DENYLIST = [
  "vendor-mermaid",
  "vendor-graph",
  "vendor-graphviz",
  "vendor-export",
];

/**
 * Parse one HTML tag's attributes into a lowercase-keyed map.
 * Handles double-quoted, single-quoted, and unquoted values in any order.
 */
function parseAttributes(tag) {
  const attrs = {};
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const m of tag.matchAll(re)) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

/** True when a rel attribute's space-separated token list contains `token`. */
function relContains(rel, token) {
  return (rel ?? "").toLowerCase().split(/\s+/).includes(token);
}

/**
 * Collect every asset URL the document loads eagerly at cold start:
 * modulepreload link hrefs first, then script srcs (matches the original
 * reporting order).
 */
export function collectEagerAssets(html) {
  const preloads = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    if (relContains(attrs.rel, "modulepreload") && attrs.href) {
      preloads.push(attrs.href);
    }
  }
  const scripts = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    if (attrs.src) scripts.push(attrs.src);
  }
  return [...preloads, ...scripts];
}

/** Filter eager asset URLs down to those in a denylisted chunk family. */
export function findOffenders(eager, denylist = DENYLIST) {
  return eager.filter((href) => denylist.some((name) => href.includes(name)));
}

function main() {
  const INDEX = "dist/index.html";
  if (!existsSync(INDEX)) {
    console.error(`check-eager-chunks: ${INDEX} not found — run pnpm build first.`);
    process.exit(64);
  }

  const html = readFileSync(INDEX, "utf8");
  const eager = collectEagerAssets(html);
  const offenders = findOffenders(eager);

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
}

// CLI entry — run only when invoked directly, never when imported by tests.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
