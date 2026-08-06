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

/**
 * RULE-LEVEL EXEMPTIONS, counted.
 *
 * The known-violations list was never the whole ceiling. A `pathNot` entry in
 * `.dependency-cruiser.cjs` removes a path from a rule's SCOPE, so its
 * violations never reach the known list at all — the headline said 7 while 24
 * exemptions masked roughly 198 more. Exemptions are rule config, so no
 * ratchet read them and four new ones landed unnoticed; the budget file's own
 * note said "22 pathNot entries … ~194 violations" and both numbers were
 * already wrong when written.
 *
 * Counting them here does not fix the coupling. It makes ADDING an exemption a
 * visible bump in a committed number rather than one more line in a config
 * diff, which is the difference between debt and drift.
 */
const exemptionBudget = budget.maxRuleExemptions;
if (exemptionBudget && typeof exemptionBudget === "object") {
  const { forbidden } = await import(join(root, ".dependency-cruiser.cjs"))
    .then((m) => m.default ?? m);
  const counted = {};
  for (const rule of forbidden ?? []) {
    const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
    const n = list(rule.from?.pathNot).length + list(rule.to?.pathNot).length;
    if (n > 0) counted[rule.name] = n;
  }

  const problems = [];
  for (const [name, allowed] of Object.entries(exemptionBudget)) {
    const found = counted[name] ?? 0;
    if (found > allowed) {
      problems.push(`   ${name}: ${found} exemptions, budget ${allowed} — an exemption was ADDED.`);
    } else if (found < allowed) {
      problems.push(`   ${name}: only ${found} exemptions but budget says ${allowed} — lower it to lock the win in.`);
    }
  }
  for (const name of Object.keys(counted)) {
    if (!(name in exemptionBudget)) {
      problems.push(`   ${name}: ${counted[name]} exemptions and NO budget entry — add one.`);
    }
  }

  if (problems.length) {
    console.error("\n❌ Rule-exemption budget:\n" + problems.join("\n") + "\n");
    console.error(
      "   A pathNot entry removes paths from a rule's SCOPE, so its violations\n" +
        "   never reach the known-violations list. Ratchets DOWN only.\n",
    );
    process.exit(1);
  }
  const total = Object.values(counted).reduce((a, b) => a + b, 0);
  console.log(`✅ Rule-exemption budget held (${total} pathNot entries across ${Object.keys(counted).length} rules).`);
}

console.log(
  `✅ Extension-boundary budget held (${actual}/${limit} known violations).`,
);
