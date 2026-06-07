#!/usr/bin/env node
/**
 * Open-Latency Measurement Harness — RW-10 (L19)
 *
 * Purpose: Measure the markdown parse / pipeline latency across the large-file
 * corpus and print a `size → ms` table referenced against the thresholds in
 * `dev-docs/plans/20260422-large-file-open-ux.md`. This is the "Harness"
 * deliverable of the Cross-phase § perf harness — it makes the plan's
 * acceptance numbers reproducible instead of aspirational.
 *
 * What this measures (and what it does NOT):
 *   - MEASURES: markdown → ProseMirror parse + serialize latency, isolated in
 *     `src/bench/largeFile.bench.ts`. Per the plan's baseline (§ Measured
 *     baseline), parse is only ~5% of the real 15.5 s open block — the rest is
 *     ProseMirror `EditorView` construction + the decoration pass, which only
 *     exist when an editor is mounted in the running webview.
 *   - DOES NOT MEASURE: true app-open latency (IPC → first paint → content
 *     rendered → typeable). That requires a running Tauri webview and is the
 *     **manual Tauri MCP gate** documented at the end of this file and in
 *     `scripts/perf/README.md` (`measure-webview.js`). Never use Chrome
 *     DevTools MCP — VMark is a Tauri app (see AGENTS.md).
 *
 * How it works: for each corpus file, it spawns `vitest bench
 * src/bench/largeFile.bench.ts` with `VMARK_BENCH_LARGE_FILE` set (the bench
 * already honors this env var), then reads vitest's JSON output. Spawning
 * vitest reuses the exact Vite transform + `@/` alias resolution the app uses,
 * which a bare-Node import of the (Vite-coupled) pipeline cannot.
 *
 * Usage:
 *   # 1) generate a corpus (see gen-large-file-corpus.mjs)
 *   node scripts/gen-large-file-corpus.mjs > tmp/corpus-manifest.json
 *   # 2) measure it
 *   node scripts/measure-open-latency.mjs --manifest tmp/corpus-manifest.json
 *
 *   # or point at a directory of *.md fixtures directly:
 *   node scripts/measure-open-latency.mjs --dir tmp/large-file-corpus
 *
 *   # or measure explicit files:
 *   node scripts/measure-open-latency.mjs a.md b.md
 *
 * @coordinates-with scripts/gen-large-file-corpus.mjs — produces the corpus.
 * @coordinates-with src/bench/largeFile.bench.ts — the measured bench.
 * @coordinates-with scripts/perf/README.md — the real-webview manual gate.
 * @coordinates-with dev-docs/plans/20260422-large-file-open-ux.md — thresholds.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const BENCH_FILE = "src/bench/largeFile.bench.ts";

// Plan thresholds (bytes) — mirror of src/utils/fileSizeThresholds.ts. Used
// only to annotate the report rows with the tier each file would route to.
const KB = 1024;
const MB = 1024 * KB;
const THRESHOLDS = {
  SHOW_PROGRESS_BYTES: 300 * KB,
  SOURCE_MODE_DEFAULT_BYTES: 1 * MB,
  WARN_BEFORE_OPEN_BYTES: 5 * MB,
  HARD_REFUSE_BYTES: 50 * MB,
};

function classifyTier(bytes) {
  if (bytes >= THRESHOLDS.HARD_REFUSE_BYTES) return "refused";
  if (bytes >= THRESHOLDS.WARN_BEFORE_OPEN_BYTES) return "huge";
  if (bytes >= THRESHOLDS.SOURCE_MODE_DEFAULT_BYTES) return "large";
  return "small";
}

function formatSize(bytes) {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(2)} MB`;
}

// ─── Resolve the list of fixture files ───────────────────────────────────────
function parseArgs(argv) {
  const out = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") out.manifest = argv[++i];
    else if (a === "--dir") out.dir = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else out.files.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(
    "measure-open-latency — RW-10 (L19)\n\n" +
      "  --manifest <json>  manifest from gen-large-file-corpus.mjs\n" +
      "  --dir <dir>        directory of *.md fixtures\n" +
      "  <files...>         explicit fixture paths\n\n" +
      "Measures parse/serialize latency per fixture; prints a size→ms table.\n" +
      "Full app-open latency is the manual Tauri MCP gate (see footer).\n",
  );
  process.exit(0);
}

let fixtures = [];
if (args.manifest) {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, args.manifest), "utf8"));
  fixtures = manifest.files.map((f) => f.path);
} else if (args.dir) {
  const dir = resolve(ROOT, args.dir);
  fixtures = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(dir, f));
} else if (args.files.length > 0) {
  fixtures = args.files.map((f) => resolve(ROOT, f));
}

if (fixtures.length === 0) {
  process.stderr.write(
    "error: no fixtures. Pass --manifest, --dir, or explicit file paths.\n" +
      "Hint: node scripts/gen-large-file-corpus.mjs > tmp/corpus-manifest.json\n",
  );
  process.exit(1);
}

fixtures = fixtures.filter((f) => {
  if (existsSync(f)) return true;
  process.stderr.write(`  skip (missing): ${f}\n`);
  return false;
});

if (fixtures.length === 0) {
  process.stderr.write("error: no existing fixtures to measure.\n");
  process.exit(1);
}

// ─── Run the bench per fixture, collect results ──────────────────────────────
const VITEST = resolve(ROOT, "node_modules/.bin/vitest");
const tmpRoot = mkdtempSync(join(tmpdir(), "vmark-openlat-"));

/** Extract a benchmark's mean/p99 (ms) by name from vitest's JSON report. */
function extractBench(report, name) {
  for (const file of report.files ?? []) {
    for (const group of file.groups ?? []) {
      for (const b of group.benchmarks ?? []) {
        if (b.name === name) return { mean: b.mean, p99: b.p99 };
      }
    }
  }
  return null;
}

const rows = [];
for (const fixture of fixtures) {
  const bytes = statSync(fixture).size;
  const tier = classifyTier(bytes);
  process.stderr.write(`Measuring ${formatSize(bytes)} (${tier}) — ${fixture}\n`);

  const jsonOut = join(tmpRoot, `bench-${rows.length}.json`);
  const res = spawnSync(
    VITEST,
    ["bench", BENCH_FILE, "--run", `--outputJson=${jsonOut}`],
    {
      cwd: ROOT,
      env: { ...process.env, VMARK_BENCH_LARGE_FILE: fixture },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );

  if (res.status !== 0 || !existsSync(jsonOut)) {
    process.stderr.write(`  bench failed for ${fixture} (exit ${res.status})\n`);
    rows.push({ bytes, tier, parseMean: null, parseP99: null, serializeMean: null });
    continue;
  }

  const report = JSON.parse(readFileSync(jsonOut, "utf8"));
  const parse = extractBench(report, "parse markdown → ProseMirror");
  const ser = extractBench(report, "serialize ProseMirror → markdown");
  rows.push({
    bytes,
    tier,
    parseMean: parse?.mean ?? null,
    parseP99: parse?.p99 ?? null,
    serializeMean: ser?.mean ?? null,
  });
}

rmSync(tmpRoot, { recursive: true, force: true });

// ─── Print the report table ──────────────────────────────────────────────────
rows.sort((a, b) => a.bytes - b.bytes);

const fmt = (ms) => (ms == null ? "  —  " : `${ms.toFixed(2)} ms`);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

const W = { size: 10, tier: 9, parse: 12, p99: 12, ser: 14 };
process.stdout.write("\nOpen-Latency Report — parse/serialize pipeline (RW-10 / L19)\n");
process.stdout.write(
  "Measures markdown→ProseMirror parse only. Full app-open latency is the\n" +
    "manual Tauri MCP gate (see footer / scripts/perf/README.md).\n\n",
);
process.stdout.write(
  pad("Size", W.size) +
    pad("Tier", W.tier) +
    padL("Parse mean", W.parse) +
    padL("Parse p99", W.p99) +
    padL("Serialize", W.ser) +
    "\n",
);
process.stdout.write("-".repeat(W.size + W.tier + W.parse + W.p99 + W.ser) + "\n");
for (const r of rows) {
  process.stdout.write(
    pad(formatSize(r.bytes), W.size) +
      pad(r.tier, W.tier) +
      padL(fmt(r.parseMean), W.parse) +
      padL(fmt(r.parseP99), W.p99) +
      padL(fmt(r.serializeMean), W.ser) +
      "\n",
  );
}

// ─── Threshold annotations + manual-gate handoff ─────────────────────────────
process.stdout.write(
  "\nThreshold reference (src/utils/fileSizeThresholds.ts):\n" +
    `  small  < ${formatSize(THRESHOLDS.SOURCE_MODE_DEFAULT_BYTES)}` +
    "          → WYSIWYG (parse cost above is the dominant non-mount cost)\n" +
    `  large  ≥ ${formatSize(THRESHOLDS.SOURCE_MODE_DEFAULT_BYTES)}` +
    "          → Source mode by default (CodeMirror; sub-second open)\n" +
    `  huge   ≥ ${formatSize(THRESHOLDS.WARN_BEFORE_OPEN_BYTES)}` +
    "          → pre-open warning dialog, then Source mode\n" +
    `  refused ≥ ${formatSize(THRESHOLDS.HARD_REFUSE_BYTES)}` +
    "         → refusal dialog, no open attempt\n",
);

process.stdout.write(
  "\nMANUAL GATE (not covered above — requires a running Tauri webview):\n" +
    "  The plan's headline numbers (1.4 MB Source open < 1 s; WYSIWYG ~15 s\n" +
    "  blocked on EditorView construction) live in the real WebKit webview and\n" +
    "  CANNOT be measured here. Run the real-webview harness before shipping any\n" +
    "  open-path change:\n" +
    "    - scripts/perf/README.md  (steps: debug build → Tauri MCP → measure)\n" +
    "    - scripts/perf/measure-webview.js  (the in-webview measurement payload)\n" +
    "  Use Tauri MCP tools only — never Chrome DevTools MCP (AGENTS.md).\n",
);
