#!/usr/bin/env node
/**
 * Doc-join gate (WI-FL0.3–0.6) — the website's factual claims are joined to the
 * code that makes them true, in the GATES tier so a docs-only PR still runs it.
 *
 * Why here and not an app-tier test: ci.yml skips fe-test on docs-only PRs
 * (README.md and website/**\/*.md count as prose), so a test under src/ that read
 * a guide page would be skipped on exactly the PR that edits the page.
 * check:static always runs, and this script lives there.
 *
 * Four joins, one module each under scripts/lib/docJoins/ — every module has the
 * same contract, `{ id, DEFAULT_PATHS, run({ root, paths }) → { findings, info } }`,
 * and its own fixture-driven self-test:
 *
 *   lint-table         website/guide/lint.md ↔ src/lib/lintEngine/ruleMeta.ts
 *                      (rule ids, severities, titles, both directions) and the
 *                      documented trigger ↔ the validateMarkdown default chord
 *   settings-defaults  website/guide/settings.md + website/guide/terminal.md
 *                      Default columns ↔ src/stores/settingsStore/defaults.ts,
 *                      both directions; an unmapped Default row fails closed
 *   readme-claims      README.md ↔ src-tauri/src/mcp_config/providers.rs (the
 *                      non-legacy MCP targets), shortcutDefinitions.ts (a numeric
 *                      shortcut claim must equal the count), LanguageSettings.tsx
 *                      (the language list), themes + themeAvailability (a
 *                      platform-qualified theme claim)
 *   journey-inventory  e2e/README.md ↔ e2e/journeys discovered exactly the way
 *                      e2e/run-journeys.mjs discovers them (default { name, run })
 *
 * A join that throws is a FINDING, not a crash: a page that fails to parse is
 * drift too. Exit 0 clean, 1 findings, 64 usage. Self-tested by
 * scripts/check-doc-joins.test.mjs.
 *
 * @coordinates-with scripts/lib/docJoins/lintTable.mjs
 * @coordinates-with scripts/lib/docJoins/settingsDefaults.mjs
 * @coordinates-with scripts/lib/docJoins/readmeClaims.mjs
 * @coordinates-with scripts/lib/docJoins/journeyInventory.mjs
 * @coordinates-with .github/workflows/ci.yml — the docs-only filter this gate sidesteps
 */
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as lintTable from "./lib/docJoins/lintTable.mjs";
import * as settingsDefaults from "./lib/docJoins/settingsDefaults.mjs";
import * as readmeClaims from "./lib/docJoins/readmeClaims.mjs";
import * as journeyInventory from "./lib/docJoins/journeyInventory.mjs";

export const ROOT = resolve(import.meta.dirname, "..");

/**
 * One descriptor per join: the module (imported STATICALLY on purpose — the
 * production-reachability gate, check-test-only-modules.mjs, follows knip's
 * graph from `scripts/*.mjs`, so a join dropped from this list but left on
 * disk is reported as unreachable instead of lingering) paired with its
 * repo-relative path for the report and the contract test. ONE list, so a
 * path cannot drift from its module and nothing zips two arrays by position.
 */
export const JOIN_REGISTRY = [
  ["scripts/lib/docJoins/lintTable.mjs", lintTable],
  ["scripts/lib/docJoins/settingsDefaults.mjs", settingsDefaults],
  ["scripts/lib/docJoins/readmeClaims.mjs", readmeClaims],
  ["scripts/lib/docJoins/journeyInventory.mjs", journeyInventory],
];
export const JOIN_MODULES = JOIN_REGISTRY.map(([rel]) => rel);

const USAGE = "usage: node scripts/check-doc-joins.mjs [--report]";

/** Throws unless `mod` honours the doc-join module contract. */
function assertJoinContract(rel, mod) {
  for (const key of ["id", "DEFAULT_PATHS", "run"]) {
    if (!(key in mod)) throw new Error(`${rel} does not export \`${key}\` (doc-join module contract)`);
  }
  if (typeof mod.id !== "string" || mod.id === "") throw new Error(`${rel}: \`id\` is not a non-empty string`);
  if (typeof mod.run !== "function") throw new Error(`${rel}: \`run\` is not a function`);
}

/** Findings are tagged by join id, so two joins sharing one would be unattributable — refuse. */
function assertUniqueIds(joins) {
  const seen = new Map();
  for (const j of joins) {
    if (seen.has(j.id)) throw new Error(`doc-join id "${j.id}" is used by both ${seen.get(j.id)} and ${j.rel}`);
    seen.set(j.id, j.rel);
  }
}

/** Import every join module by path and verify it honours the contract. */
export async function loadJoins(root = ROOT, modulePaths = JOIN_MODULES) {
  const joins = [];
  for (const rel of modulePaths) {
    const mod = await import(pathToFileURL(resolve(root, rel)).href);
    assertJoinContract(rel, mod);
    joins.push({ rel, ...mod });
  }
  assertUniqueIds(joins);
  return joins;
}

/** The statically imported joins, contract-checked and unique by id — what the gate runs. */
export function registeredJoins(registry = JOIN_REGISTRY) {
  const joins = registry.map(([rel, mod]) => {
    assertJoinContract(rel, mod);
    return { rel, ...mod };
  });
  assertUniqueIds(joins);
  return joins;
}

/**
 * Run every join against the tree. Each finding is tagged with its join id; a
 * join that throws contributes one finding carrying the error, so a broken
 * parser cannot look like a clean page. The result's SHAPE is checked before
 * either list is read: a string where the `findings` array belongs must not be
 * emitted character by character, and a missing `info` is a contract
 * violation too, not a silent nothing.
 */
export async function runJoins(joins, { root = ROOT } = {}) {
  const findings = [];
  const info = [];
  for (const join of joins) {
    let result;
    try {
      result = await join.run({ root, paths: join.DEFAULT_PATHS });
    } catch (err) {
      findings.push({ join: join.id, message: `join threw: ${err?.message ?? err}` });
      continue;
    }
    const missing = ["findings", "info"].filter((key) => !Array.isArray(result?.[key]));
    if (missing.length > 0) {
      findings.push({ join: join.id, message: `join returned no ${missing.map((k) => `\`${k}\``).join(" / ")} array (contract violation)` });
      continue;
    }
    for (const f of result.findings) findings.push({ join: join.id, message: f });
    for (const i of result.info) info.push({ join: join.id, message: i });
  }
  return { findings, info };
}

async function main(argv) {
  const report = argv.includes("--report");
  for (const a of argv) if (a !== "--report") { console.error(USAGE); return 64; }
  let joins;
  try {
    joins = registeredJoins();
  } catch (err) {
    console.error(`✗ check-doc-joins: ${err.message}`);
    return 1;
  }
  const { findings, info } = await runJoins(joins);
  if (report) for (const i of info) console.log(`  · ${i.join}: ${i.message}`);
  for (const f of findings) console.log(`✗ ${f.join}: ${f.message}`);
  if (findings.length) {
    console.log(`\n${findings.length} doc-join finding(s). Docs follow code: fix the page, or the code if the page is the truth.`);
    return 1;
  }
  console.log(`✓ check-doc-joins: ${joins.length} joins clean (${joins.map((j) => j.id).join(", ")})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // exitCode, not exit(): a report piped into a pager must not be cut off by
  // exiting before stdout drains.
  process.exitCode = await main(process.argv.slice(2));
}
