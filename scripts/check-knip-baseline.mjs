#!/usr/bin/env node
/**
 * Knip ratchet.
 *
 * `knip.json` runs six rule families at `warn` — `exports`, `nsExports`,
 * `types`, `nsTypes`, `duplicates`, `enumMembers`. Warnings print and knip
 * still exits 0, so 78 findings were being reported inside a green
 * `check:all` with nothing to stop a 79th. Every other gate in this repo
 * (file size, store coupling, bespoke buttons, shell slots, extension budget)
 * ratchets against a committed number; knip was the one that did not, and
 * unlike them it had no stated reason — just bare JSON with no comment.
 *
 * Flipping the families to `error` outright would fail the build on 78
 * pre-existing findings, several of which are deliberate API surface. So this
 * mirrors the sibling pattern instead: freeze today's counts, fail on growth,
 * and fail on an un-recorded shrink so a win cannot be quietly reabsorbed.
 *
 * Usage: node scripts/check-knip-baseline.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts", "knip-baseline.json");

/** Rule families knip reports as warnings — the ones this gate counts. */
const WARN_FAMILIES = [
  "exports",
  "nsExports",
  "types",
  "nsTypes",
  "duplicates",
  "enumMembers",
];

function readBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    console.error(`❌ Cannot read ${baselinePath}: ${error.message}`);
    process.exit(1);
  }
}

function runKnip() {
  let raw;
  try {
    raw = execFileSync("npx", ["knip", "--reporter", "json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // knip exits non-zero when an `error`-tier rule fires. Its JSON is still
    // on stdout, and those rules are gated by `pnpm knip` itself — this script
    // only counts the warn tier, so parse what we got rather than double-fail.
    raw = error.stdout ?? "";
    if (!raw) {
      console.error(`❌ knip produced no output: ${error.message}`);
      process.exit(1);
    }
  }

  const start = raw.indexOf("{");
  if (start < 0) {
    console.error("❌ knip produced no JSON object.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch (error) {
    console.error(`❌ Cannot parse knip JSON: ${error.message}`);
    process.exit(1);
  }

  const counts = Object.fromEntries(WARN_FAMILIES.map((f) => [f, 0]));
  for (const issue of parsed.issues ?? []) {
    for (const family of WARN_FAMILIES) {
      const found = issue[family];
      if (Array.isArray(found)) counts[family] += found.length;
    }
  }
  return counts;
}

const baseline = readBaseline();
const counts = runKnip();

const problems = [];
for (const family of WARN_FAMILIES) {
  const allowed = baseline[family];
  if (typeof allowed !== "number") {
    problems.push(`   ${family}: no baseline entry — add one.`);
    continue;
  }
  const found = counts[family];
  if (found > allowed) {
    problems.push(`   ${family}: ${found} findings, baseline ${allowed} — new dead code.`);
  } else if (found < allowed) {
    problems.push(
      `   ${family}: only ${found} findings but baseline says ${allowed} — lower it to lock the win in.`
    );
  }
}

if (problems.length) {
  console.error("\n❌ Knip baseline:\n" + problems.join("\n") + "\n");
  console.error(
    "   These families run at `warn`, so knip itself exits 0 and would have\n" +
      "   reported the change inside a green gate. Ratchets DOWN only.\n"
  );
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`✅ Knip baseline held (${total} warn-tier findings across ${WARN_FAMILIES.length} families).`);
