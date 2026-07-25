#!/usr/bin/env node
/**
 * Extension-boundary budget gate — WI-1.8.
 *
 * `plugin-isolation` is now severity `error`, with today's violations frozen in
 * `.dependency-cruiser-known-violations.json` so the gate can fail on anything
 * NEW while the existing debt is paid down.
 *
 * That file alone is not a ratchet: regenerating it after adding violations
 * would silently raise the ceiling — exactly how `plugin-isolation` sat at
 * `warn` with 22 rule-level exemptions masking 194 violations for months. This
 * script pins the ceiling in a separate committed number that may only go down.
 *
 * Mirrors the `scripts/check-file-size.mjs` pattern: the baseline ratchets
 * down only. Lower the budget when you fix violations; never raise it.
 *
 * Usage: node scripts/check-extension-budget.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const knownPath = join(root, ".dependency-cruiser-known-violations.json");
const budgetPath = join(root, "scripts", "extension-budget.json");

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`❌ Cannot read ${label} (${path}): ${error.message}`);
    process.exit(1);
  }
}

const known = readJson(knownPath, "known-violations file");
const budget = readJson(budgetPath, "budget file");

if (!Array.isArray(known)) {
  console.error("❌ known-violations file must contain an array.");
  process.exit(1);
}

const limit = budget.maxKnownViolations;
if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
  console.error("❌ extension-budget.json needs an integer `maxKnownViolations`.");
  process.exit(1);
}

const actual = known.length;

if (actual > limit) {
  console.error(
    `\n❌ Extension-boundary budget exceeded: ${actual} known violations, budget is ${limit}.\n`,
  );
  console.error(
    "   A new cross-plugin import was baselined instead of fixed. Either remove\n" +
      "   the import, or route it through plugins/shared/ or the plugin registry.\n" +
      "   The budget ratchets DOWN only — never raise this number.\n",
  );
  process.exit(1);
}

if (actual < limit) {
  console.error(
    `\n❌ Budget is stale: only ${actual} known violations remain but the budget says ${limit}.\n` +
      `   Lower \`maxKnownViolations\` to ${actual} in scripts/extension-budget.json to lock the win in.\n`,
  );
  process.exit(1);
}

console.log(
  `✅ Extension-boundary budget held (${actual}/${limit} known violations).`,
);
