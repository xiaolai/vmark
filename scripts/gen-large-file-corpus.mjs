#!/usr/bin/env node
/**
 * Large-File Corpus Generator — RW-10 (L19)
 *
 * Purpose: Produce deterministic markdown fixtures that straddle the byte
 * thresholds in `src/utils/fileSizeThresholds.ts`, so the perf harness
 * (`scripts/measure-open-latency.mjs`) can exercise the same size buckets the
 * large-file open path routes on. Implements the "Corpus generator" deliverable
 * of the Cross-phase § perf harness in
 * `dev-docs/plans/20260422-large-file-open-ux.md`.
 *
 * The corpus is intentionally NOT committed — it is large and reproducible on
 * demand. Output defaults to a gitignored `tmp/` directory.
 *
 * Determinism: content is generated from a seeded LCG (no `Math.random`), so
 * the same args always yield byte-identical files. This keeps perf comparisons
 * honest run-to-run.
 *
 * Size buckets (default) — chosen to land one file in each tier of
 * `classifyFileSize()` (small / large / huge / refused boundaries):
 *   - 1 MB   → "large"   (≥ SOURCE_MODE_DEFAULT_BYTES)
 *   - 5 MB   → "huge"    (≥ WARN_BEFORE_OPEN_BYTES)
 *   - 20 MB  → "huge"    (mid-band, between warn and refuse)
 *   - 50 MB  → "refused" (≥ HARD_REFUSE_BYTES — the liability floor)
 *
 * Usage:
 *   node scripts/gen-large-file-corpus.mjs
 *   node scripts/gen-large-file-corpus.mjs --sizes 1,5,20,50      # MB
 *   node scripts/gen-large-file-corpus.mjs --out tmp/my-corpus
 *   node scripts/gen-large-file-corpus.mjs --sizes 0.05 --seed 7  # smoke test
 *
 * Env overrides (args win over env):
 *   VMARK_CORPUS_SIZES  comma-separated MB list
 *   VMARK_CORPUS_OUT    output directory
 *   VMARK_CORPUS_SEED   integer seed
 *
 * Prints (stdout) a JSON manifest: { outDir, files: [{ path, bytes, ... }] }
 * so the measure harness can consume it directly via a pipe or a saved file.
 *
 * @coordinates-with scripts/measure-open-latency.mjs — consumes the manifest.
 * @coordinates-with src/utils/fileSizeThresholds.ts — tier boundaries.
 * @coordinates-with dev-docs/plans/20260422-large-file-open-ux.md — deliverable.
 */

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Thresholds (mirrored from src/utils/fileSizeThresholds.ts) ──────────────
// Kept inline so this script stays a leaf-pure Node module (no Vite/alias
// coupling). If the source thresholds move, update this comment + DEFAULT_SIZES.
const MB = 1024 * 1024;
const TIERS = [
  { name: "small", min: 0 },
  { name: "large", min: 1 * MB },
  { name: "huge", min: 5 * MB },
  { name: "refused", min: 50 * MB },
];

function classifyTier(bytes) {
  let tier = "small";
  for (const t of TIERS) if (bytes >= t.min) tier = t.name;
  return tier;
}

// ─── Arg / env parsing ───────────────────────────────────────────────────────
// audit-fix — validate CLI args
function takeValue(argv, i, flag) {
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("-")) {
    process.stderr.write(`error: ${flag} requires a value\n`);
    process.exit(1);
  }
  return next;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sizes") out.sizes = takeValue(argv, i++, a);
    else if (a === "--out") out.out = takeValue(argv, i++, a);
    else if (a === "--seed") out.seed = takeValue(argv, i++, a);
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(
    "gen-large-file-corpus — RW-10 (L19)\n\n" +
      "  --sizes <csv MB>   sizes in megabytes (default: 1,5,20,50)\n" +
      "  --out <dir>        output dir (default: tmp/large-file-corpus)\n" +
      "  --seed <int>       LCG seed (default: 1)\n\n" +
      "Writes deterministic markdown fixtures + prints a JSON manifest.\n",
  );
  process.exit(0);
}

const DEFAULT_SIZES_MB = [1, 5, 20, 50];
const sizesMb = (args.sizes ?? process.env.VMARK_CORPUS_SIZES)
  ? String(args.sizes ?? process.env.VMARK_CORPUS_SIZES)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  : DEFAULT_SIZES_MB;

if (sizesMb.length === 0) {
  process.stderr.write("error: no valid sizes provided\n");
  process.exit(1);
}

const outDir = resolve(
  ROOT,
  args.out ?? process.env.VMARK_CORPUS_OUT ?? "tmp/large-file-corpus",
);
// audit-fix — validate CLI args
function parseSeed(raw) {
  if (raw === undefined) return 1;
  const str = String(raw).trim();
  if (!/^[+-]?\d+$/.test(str)) {
    process.stderr.write(`error: --seed must be an integer (got "${str}")\n`);
    process.exit(1);
  }
  return Number(str) >>> 0;
}

const seed = parseSeed(args.seed ?? process.env.VMARK_CORPUS_SEED);

// ─── Deterministic content generation (seeded LCG, no Math.random) ───────────
// Numerical Recipes LCG constants. Stable, fast, reproducible.
function makeRng(s) {
  let state = (s || 1) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const WORDS = [
  "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "markdown",
  "editor", "prosemirror", "tiptap", "vmark", "render", "parse", "block",
  "paragraph", "heading", "table", "code", "latency", "viewport", "source",
  "wysiwyg", "threshold", "corpus", "fixture", "benchmark", "deterministic",
];

function word(rng) {
  return WORDS[Math.floor(rng() * WORDS.length)];
}

function sentence(rng, minW = 8, maxW = 18) {
  const n = minW + Math.floor(rng() * (maxW - minW));
  const parts = [];
  for (let i = 0; i < n; i++) {
    let w = word(rng);
    if (i === 0) w = w[0].toUpperCase() + w.slice(1);
    // Sprinkle deterministic inline formatting so the parse path exercises
    // marks, not just plain text.
    if (i > 0 && i % 7 === 0) w = `**${w}**`;
    else if (i > 0 && i % 11 === 0) w = `*${w}*`;
    parts.push(w);
  }
  return parts.join(" ") + ".";
}

/**
 * Append the next block to `chunks`. Cycles through a realistic block mix
 * (paragraph / heading / list / blockquote / fenced code / table) so the
 * generated doc resembles real prose, not a degenerate paragraph wall.
 */
function appendBlock(chunks, rng, i) {
  const mod = i % 24;
  if (mod === 0) {
    chunks.push(`## ${sentence(rng, 3, 6)}`);
  } else if (mod === 7) {
    chunks.push(
      `- ${sentence(rng, 4, 9)}\n- ${sentence(rng, 4, 9)}\n- ${sentence(rng, 4, 9)}`,
    );
  } else if (mod === 13) {
    chunks.push(`> ${sentence(rng, 6, 14)}`);
  } else if (mod === 19) {
    chunks.push(
      "```ts\n" +
        `const ${word(rng)} = ${Math.floor(rng() * 1000)};\n` +
        `function ${word(rng)}() { return ${word(rng)}; }\n` +
        "```",
    );
  } else if (mod === 22) {
    chunks.push(
      `| ${word(rng)} | ${word(rng)} |\n| --- | --- |\n` +
        `| ${word(rng)} | ${word(rng)} |\n| ${word(rng)} | ${word(rng)} |`,
    );
  } else {
    chunks.push(sentence(rng, 12, 28));
  }
}

/**
 * Build a markdown string of at least `targetBytes` UTF-8 bytes. Generates
 * block-by-block until the running byte total crosses the target, then stops.
 * Deterministic for a given (seed, targetBytes).
 */
function generateMarkdown(targetBytes, seedForFile) {
  const rng = makeRng(seedForFile);
  const enc = new TextEncoder();
  const chunks = [];
  let bytes = 0;
  let i = 0;
  // Each block is followed by a blank-line separator ("\n\n" = 2 bytes).
  while (bytes < targetBytes) {
    const before = chunks.length;
    appendBlock(chunks, rng, i);
    for (let k = before; k < chunks.length; k++) {
      bytes += enc.encode(chunks[k]).length + 2;
    }
    i++;
  }
  return { text: chunks.join("\n\n") + "\n", blocks: chunks.length };
}

// ─── Generate ────────────────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true });

const manifest = { outDir, seed, generatedAt: new Date().toISOString(), files: [] };

for (const mb of sizesMb) {
  const targetBytes = Math.round(mb * MB);
  // Derive a per-file seed from the base seed + target so each size is
  // independent yet fully reproducible.
  const fileSeed = (seed ^ Math.imul(targetBytes, 2654435761)) >>> 0;
  const { text, blocks } = generateMarkdown(targetBytes, fileSeed);
  const label = mb >= 1 ? `${mb}MB` : `${Math.round(mb * 1024)}KB`;
  const filePath = join(outDir, `corpus-${label}.md`);
  writeFileSync(filePath, text, "utf8");
  const actualBytes = statSync(filePath).size;
  manifest.files.push({
    path: filePath,
    label,
    requestedMb: mb,
    bytes: actualBytes,
    blocks,
    tier: classifyTier(actualBytes),
  });
  process.stderr.write(
    `  wrote ${filePath}  (${(actualBytes / MB).toFixed(2)} MB, ` +
      `${blocks} blocks, tier=${classifyTier(actualBytes)})\n`,
  );
}

// Manifest to stdout so it can be piped/redirected; progress went to stderr.
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
