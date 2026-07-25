#!/usr/bin/env node
/**
 * Plugin→store coupling ratchet.
 *
 * A plugin that imports `@/stores/…` reaches into the app's Zustand singletons.
 * That is the property which makes it unshippable as a standalone/third-party
 * extension — you cannot hand someone a plugin that mutates your global state.
 * It is therefore the binding constraint on ADR-015's goal, not cross-plugin
 * imports.
 *
 * Why this gate exists: the 2026-07-25 goal audit
 * (`dev-docs/deep-researches/20260725-extension-goal-progress-audit.md`)
 * measured the whole extension re-architecture as a delta and found
 *
 *   cross-plugin imports  339 → 264  (−22%, and `plugin-isolation` gates it)
 *   plugin files → stores  97 →  98  (+1,  and NOTHING gated it)
 *
 * across 192 commits whose stated purpose was decoupling. The axis that
 * improved is the one dependency-cruiser could already see. This makes the
 * other axis visible.
 *
 * Why per-unit and not one global number: a bare count lets a fixed plugin pay
 * for a newly-coupled one — net zero passes while the ecosystem gets no closer
 * to extractable. Freezing per unit (the pattern of
 * `scripts/file-size-baseline.json`) fails on BOTH halves of that swap.
 *
 * The baseline ratchets DOWN only, and refuses to go stale: improving a plugin
 * fails the gate until the win is locked into the baseline file. Never raise a
 * number — decouple the file instead (move store reads to the call site, or
 * pass state in as parameters).
 *
 * Usage: node scripts/check-plugin-store-coupling.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Marker that means "this file reaches into app state". Covers both static
 *  `from "@/stores/x"` and dynamic `import("@/stores/x")` forms. */
const STORE_REF = "@/stores";

const SOURCE_EXT = /\.tsx?$/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;

/**
 * Compare measured coupling against the frozen baseline.
 *
 * Pure, so it is unit-testable without a filesystem. Both inputs map a UNIT
 * (plugin directory name, or a bare filename for loose files directly under
 * `src/plugins/`) to the number of non-test files in it that reach stores.
 *
 * A unit is a violation when it is new, grew, shrank, or disappeared — the last
 * two because an unlocked win silently becomes headroom for the next
 * regression.
 *
 * @returns violations sorted by unit name, so CI output is stable.
 */
export function findCouplingViolations(actual, baseline) {
  const units = new Set([...Object.keys(actual), ...Object.keys(baseline)]);
  const violations = [];

  for (const unit of [...units].sort()) {
    const now = actual[unit] ?? 0;
    const was = baseline[unit] ?? 0;
    if (now === was) continue;

    let kind;
    if (was === 0) kind = "new";
    else if (now === 0) kind = "fixed";
    else if (now > was) kind = "grew";
    else kind = "stale";

    violations.push({ unit, kind, actual: now, baseline: was });
  }

  return violations;
}

/** Recursively collect non-test `.ts`/`.tsx` files under `dir`. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXT.test(entry) && !TEST_FILE.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Measure current coupling.
 *
 * @returns `{ unit: coupledFileCount }` for units with at least one coupled
 *   file. Units at zero are omitted, so a fully decoupled plugin drops out of
 *   the map and surfaces as a `fixed` violation against the baseline.
 */
export function scanCoupling(pluginsRoot) {
  const counts = {};

  for (const entry of readdirSync(pluginsRoot)) {
    const full = join(pluginsRoot, entry);
    const isDir = statSync(full).isDirectory();
    if (!isDir && (!SOURCE_EXT.test(entry) || TEST_FILE.test(entry))) continue;

    const files = isDir ? sourceFiles(full) : [full];
    const coupled = files.filter((f) => readFileSync(f, "utf8").includes(STORE_REF));
    if (coupled.length > 0) counts[entry] = coupled.length;
  }

  return counts;
}

const EXPLAIN = {
  new: "is NEW to the baseline — a plugin was born coupled to app state",
  grew: "gained store coupling",
  stale: "improved; lock the win in",
  fixed: "is fully decoupled; remove it from the baseline",
};

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const baselinePath = join(root, "scripts", "plugin-store-coupling-baseline.json");

  let baselineFile;
  try {
    baselineFile = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    console.error(`❌ Cannot read baseline (${baselinePath}): ${error.message}`);
    process.exit(1);
  }

  const baseline = baselineFile.units;
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    console.error("❌ plugin-store-coupling-baseline.json needs a `units` object.");
    process.exit(1);
  }

  const actual = scanCoupling(join(root, "src", "plugins"));
  const violations = findCouplingViolations(actual, baseline);

  const total = Object.values(actual).reduce((a, b) => a + b, 0);
  const unitCount = Object.keys(actual).length;

  if (violations.length === 0) {
    console.log(
      `✅ Plugin→store coupling held (${total} files across ${unitCount} plugins).`,
    );
    return;
  }

  console.error(`\n❌ Plugin→store coupling changed in ${violations.length} unit(s):\n`);
  for (const v of violations) {
    console.error(
      `   ${v.unit} — ${EXPLAIN[v.kind]} (baseline ${v.baseline}, now ${v.actual})`,
    );
  }

  const regressions = violations.filter((v) => v.kind === "new" || v.kind === "grew");
  if (regressions.length > 0) {
    console.error(
      "\n   A plugin that imports @/stores cannot ship as a standalone extension.\n" +
        "   Read state at the call site instead, or pass it in as a parameter.\n" +
        "   This baseline ratchets DOWN only — never raise a number to pass.\n",
    );
  } else {
    console.error(
      `\n   These are IMPROVEMENTS. Update scripts/plugin-store-coupling-baseline.json\n` +
        `   to match so the win cannot silently become headroom for a regression.\n`,
    );
  }

  process.exit(1);
}

// Only run when invoked directly, so the test can import the pure helpers.
if (process.argv[1] && process.argv[1].endsWith("check-plugin-store-coupling.mjs")) {
  main();
}
