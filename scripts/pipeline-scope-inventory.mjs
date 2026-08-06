#!/usr/bin/env node
/**
 * Markdown-pipeline scope inventory — WI-1.6.
 *
 * Replaces the withdrawn "~700 of ~2,600 lines are document-scoped" premise
 * (both numbers were wrong — the pipeline is ~4,994 non-test lines, and the 700
 * was never derived) with a measurement anyone can re-run.
 *
 * Phase 2 inverts per-node serialization. This reports what CANNOT become a
 * per-node function, split by why, because "document-scoped" conflates four
 * different situations:
 *
 *   preprocess  whole-STRING passes, before/after any tree exists. Not per-node,
 *               but relocatable — remark already models this shape, so these can
 *               become registry-1 contributions rather than staying central.
 *   algorithm   needs whole-DOCUMENT or sibling-array context. Stays central,
 *               but contributed handlers may still call it.
 *   state       per-document state threaded through conversion. Needs a context
 *               object, which is a parameter, not a barrier.
 *
 * Fails if a named symbol disappears, so the inventory cannot silently rot the
 * way the figures it replaces did.
 *
 * Usage: node scripts/pipeline-scope-inventory.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipeline = join(root, "src/utils/markdownPipeline");

/** Whole files that are document-scoped end to end. */
const WHOLE_FILES = [
  { file: "parser/escapeMarkers.ts", category: "preprocess", why: "PUA placeholder pre/post pass over the raw markdown string" },
  { file: "parser/listNormalization.ts", category: "preprocess", why: "bare-marker normalization + spread cleanup over the raw string" },
  { file: "blankLineCapture.ts", category: "algorithm", why: "top-level blank-line runs, captured by position across the whole doc" },
];

/** Individual functions inside otherwise per-node files. */
const SYMBOLS = [
  { file: "pmInlineConverters.ts", symbol: "function groupInlineItems", category: "algorithm", why: "factors mark runs across ALL marks at once; cannot split per mark" },
  { file: "mdastToProseMirror.ts", symbol: "function mergeInlineHtmlTags", category: "algorithm", why: "reconstructs paired inline HTML over sibling arrays" },
  { file: "serializer.ts", symbol: "function applyCosmeticPass", category: "algorithm", why: "verified unescape; re-parses the whole document to confirm safety" },
  { file: "mdastToProseMirror.ts", symbol: "private usedSlugs", category: "state", why: "heading-slug uniqueness across the document" },
];

function lines(text) {
  return text.split("\n").length;
}

/**
 * Measure a symbol's extent by brace matching from its first occurrence.
 *
 * The match is word-bounded: a plain `indexOf` would treat a renamed
 * `groupInlineItemsRenamed` as still present, defeating the rot check.
 */
function measureSymbol(source, symbol) {
  const pattern = new RegExp(
    `${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`,
  );
  const match = pattern.exec(source);
  if (match === null) return null;
  const start = match.index;
  const from = source.lastIndexOf("\n", start) + 1;
  let depth = 0;
  let seenBrace = false;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
      seenBrace = true;
    } else if (ch === "}") {
      depth--;
      if (seenBrace && depth <= 0) {
        return lines(source.slice(from, i + 1));
      }
    } else if (ch === "\n" && seenBrace && depth <= 0) {
      return lines(source.slice(from, i));
    }
  }
  return seenBrace ? null : 1;
}

function nonTestLineTotal(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      total += nonTestLineTotal(full);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      total += lines(readFileSync(full, "utf8"));
    }
  }
  return total;
}

const rows = [];
let failed = false;

for (const entry of WHOLE_FILES) {
  const path = join(pipeline, entry.file);
  let count;
  try {
    count = lines(readFileSync(path, "utf8"));
  } catch {
    console.error(`❌ Missing file: ${relative(root, path)}`);
    failed = true;
    continue;
  }
  rows.push({ ...entry, name: entry.file, count });
}

for (const entry of SYMBOLS) {
  const path = join(pipeline, entry.file);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    console.error(`❌ Missing file: ${relative(root, path)}`);
    failed = true;
    continue;
  }
  const count = measureSymbol(source, entry.symbol);
  if (count === null) {
    console.error(
      `❌ Symbol not found: \`${entry.symbol}\` in ${entry.file}.\n` +
        `   It was renamed or removed — update scripts/pipeline-scope-inventory.mjs\n` +
        `   so this inventory does not rot the way the numbers it replaced did.`,
    );
    failed = true;
    continue;
  }
  rows.push({ ...entry, name: `${entry.file} → ${entry.symbol}`, count });
}

if (failed) process.exit(1);

const total = nonTestLineTotal(pipeline);
const byCategory = {};
for (const row of rows) {
  byCategory[row.category] = (byCategory[row.category] ?? 0) + row.count;
}
const scoped = rows.reduce((sum, r) => sum + r.count, 0);

console.log(`\nMarkdown-pipeline scope inventory (${total} non-test lines total)\n`);
for (const category of ["preprocess", "algorithm", "state"]) {
  const items = rows.filter((r) => r.category === category);
  if (!items.length) continue;
  console.log(`  ${category} — ${byCategory[category]} lines`);
  for (const item of items) {
    console.log(`    ${String(item.count).padStart(4)}  ${item.name}`);
    console.log(`          ${item.why}`);
  }
  console.log("");
}
const pct = ((scoped / total) * 100).toFixed(1);
console.log(`  NOT per-node decomposable: ${scoped} / ${total} lines (${pct}%)`);
console.log(
  `  Of that, only ${byCategory.algorithm ?? 0} lines are genuinely whole-document\n` +
    `  algorithms; ${byCategory.preprocess ?? 0} are relocatable whole-string passes and\n` +
    `  ${byCategory.state ?? 0} is threadable state.\n`,
);
