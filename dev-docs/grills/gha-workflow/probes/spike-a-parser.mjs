// Spike A — characterize @actions/workflow-parser positions for IR mapping.
//
// For every fixture, parse it and walk the resulting TemplateToken tree.
// Report:
//   1. Did parsing succeed? Errors? Warnings?
//   2. Does the root, `on`, every `jobs[*]`, every step, every `with[*]`,
//      every `strategy.matrix[*]` carry a usable TokenRange?
//   3. Edge cases: multi-doc YAML, anchors, expressions, empty values.
//
// Pass criteria: ≥95% of IR nodes we care about have non-undefined ranges.
// Fail path: some required position missing → fall back to `yaml` package
// for read.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkflow } from "@actions/workflow-parser";

const FIXTURE_DIR = "../fixtures";

// ─── Helpers ──────────────────────────────────────────────────────────────

function hasRange(token) {
  return Boolean(token?.range && token.range.start && token.range.end);
}

// Walk a MappingToken to find a key by string name. Returns the *value* token.
function getMappingValue(mapping, key) {
  if (!mapping || mapping.templateTokenType !== 2 /* Mapping */) return undefined;
  for (let i = 0; i < mapping.count; i++) {
    const pair = mapping.get(i);
    if (pair.key.assertString?.("k").value === key) return pair.value;
  }
  return undefined;
}

function asMapping(t) {
  return t?.templateTokenType === 2 ? t : undefined;
}
function asSequence(t) {
  return t?.templateTokenType === 1 ? t : undefined;
}

// ─── Probe one fixture ────────────────────────────────────────────────────

function probe(fixtureName, content) {
  const result = {
    fixture: fixtureName,
    parseOk: false,
    errorCount: 0,
    errors: [],
    coverage: {
      root: false,
      on: false,
      jobs: { total: 0, withRange: 0, steps: { total: 0, withRange: 0 } },
      withFields: { total: 0, withRange: 0 },
      matrixDims: { total: 0, withRange: 0 },
    },
  };

  const errors = [];
  const trace = {
    error: (m) => errors.push({ severity: "error", message: m }),
    info: () => {},
    verbose: () => {},
  };

  let parsed;
  try {
    parsed = parseWorkflow({ name: fixtureName, content }, trace);
  } catch (e) {
    result.errors.push(`parser threw: ${e.message}`);
    return result;
  }

  result.errorCount = parsed.context?.errors?.getErrors?.()?.length ?? errors.length;
  if (result.errorCount > 0) {
    const ctxErrors = parsed.context?.errors?.getErrors?.() ?? [];
    result.errors = ctxErrors.slice(0, 5).map((e) => `${e.code ?? "?"}: ${e.message}`);
  }

  const root = parsed.value;
  if (!root) {
    result.errors.push("parser returned no value");
    return result;
  }

  result.parseOk = true;
  result.coverage.root = hasRange(root);

  const rootMap = asMapping(root);
  if (!rootMap) return result;

  // Top-level `on:`
  const onTok = getMappingValue(rootMap, "on");
  if (onTok) result.coverage.on = hasRange(onTok);

  // jobs map
  const jobsTok = asMapping(getMappingValue(rootMap, "jobs"));
  if (!jobsTok) return result;

  for (let i = 0; i < jobsTok.count; i++) {
    const pair = jobsTok.get(i);
    const jobMap = asMapping(pair.value);
    result.coverage.jobs.total++;
    if (hasRange(pair.value)) result.coverage.jobs.withRange++;

    if (!jobMap) continue;

    // Steps array
    const stepsSeq = asSequence(getMappingValue(jobMap, "steps"));
    if (stepsSeq) {
      for (let j = 0; j < stepsSeq.count; j++) {
        const stepTok = stepsSeq.get(j);
        result.coverage.jobs.steps.total++;
        if (hasRange(stepTok)) result.coverage.jobs.steps.withRange++;

        const stepMap = asMapping(stepTok);
        const withTok = asMapping(getMappingValue(stepMap, "with"));
        if (withTok) {
          for (let k = 0; k < withTok.count; k++) {
            const withPair = withTok.get(k);
            result.coverage.withFields.total++;
            if (hasRange(withPair.value)) result.coverage.withFields.withRange++;
          }
        }
      }
    }

    // strategy.matrix dimensions
    const stratMap = asMapping(getMappingValue(jobMap, "strategy"));
    const matrixMap = asMapping(getMappingValue(stratMap, "matrix"));
    if (matrixMap) {
      for (let k = 0; k < matrixMap.count; k++) {
        const dim = matrixMap.get(k);
        if (dim.key.assertString?.("k").value === "include") continue;
        if (dim.key.assertString?.("k").value === "exclude") continue;
        result.coverage.matrixDims.total++;
        if (hasRange(dim.value)) result.coverage.matrixDims.withRange++;
      }
    }
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────

const fixtures = readdirSync(FIXTURE_DIR).filter(
  (f) => f.endsWith(".yml") || f.endsWith(".yaml"),
);

const results = [];
for (const f of fixtures) {
  const content = readFileSync(join(FIXTURE_DIR, f), "utf8");
  results.push(probe(f, content));
}

// ─── Report ───────────────────────────────────────────────────────────────

console.log("\n# Spike A — @actions/workflow-parser position coverage\n");
console.log(`Parsed ${fixtures.length} fixtures.\n`);

let agg = {
  parsed: 0,
  rootRanged: 0,
  onRanged: 0,
  jobsTotal: 0,
  jobsRanged: 0,
  stepsTotal: 0,
  stepsRanged: 0,
  withTotal: 0,
  withRanged: 0,
  mtxTotal: 0,
  mtxRanged: 0,
  errors: 0,
};

console.log("| fixture | parsed | errs | root | on | jobs (ranged/total) | steps | with | matrix |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
  if (r.parseOk) agg.parsed++;
  if (r.coverage.root) agg.rootRanged++;
  if (r.coverage.on) agg.onRanged++;
  agg.jobsTotal += r.coverage.jobs.total;
  agg.jobsRanged += r.coverage.jobs.withRange;
  agg.stepsTotal += r.coverage.jobs.steps.total;
  agg.stepsRanged += r.coverage.jobs.steps.withRange;
  agg.withTotal += r.coverage.withFields.total;
  agg.withRanged += r.coverage.withFields.withRange;
  agg.mtxTotal += r.coverage.matrixDims.total;
  agg.mtxRanged += r.coverage.matrixDims.withRange;
  agg.errors += r.errorCount;

  console.log(
    `| ${r.fixture} | ${r.parseOk ? "y" : "n"} | ${r.errorCount} | ` +
      `${r.coverage.root ? "y" : "n"} | ${r.coverage.on ? "y" : "n"} | ` +
      `${r.coverage.jobs.withRange}/${r.coverage.jobs.total} | ` +
      `${r.coverage.jobs.steps.withRange}/${r.coverage.jobs.steps.total} | ` +
      `${r.coverage.withFields.withRange}/${r.coverage.withFields.total} | ` +
      `${r.coverage.matrixDims.withRange}/${r.coverage.matrixDims.total} |`,
  );
}

const pct = (num, den) => (den === 0 ? "n/a" : `${((100 * num) / den).toFixed(1)}%`);

console.log("\n## Aggregate\n");
console.log(`- Parsed: ${agg.parsed}/${results.length}`);
console.log(`- Total parser errors across corpus: ${agg.errors}`);
console.log(`- Root token has range: ${agg.rootRanged}/${results.length} (${pct(agg.rootRanged, results.length)})`);
console.log(`- On token has range: ${agg.onRanged}/${results.length} (${pct(agg.onRanged, results.length)})`);
console.log(`- Jobs ranged: ${agg.jobsRanged}/${agg.jobsTotal} (${pct(agg.jobsRanged, agg.jobsTotal)})`);
console.log(`- Steps ranged: ${agg.stepsRanged}/${agg.stepsTotal} (${pct(agg.stepsRanged, agg.stepsTotal)})`);
console.log(`- with[*] fields ranged: ${agg.withRanged}/${agg.withTotal} (${pct(agg.withRanged, agg.withTotal)})`);
console.log(`- matrix dims ranged: ${agg.mtxRanged}/${agg.mtxTotal} (${pct(agg.mtxRanged, agg.mtxTotal)})`);

console.log("\n## Errors detail\n");
for (const r of results) {
  if (r.errorCount > 0 || r.errors.length > 0) {
    console.log(`\n### ${r.fixture}\n`);
    for (const e of r.errors) console.log(`- ${e}`);
  }
}
