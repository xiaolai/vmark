#!/usr/bin/env node
/**
 * Header-reference gate (WI-FL0.2) — every file header that names another file
 * must name one that exists.
 *
 * Headers carry three reference grammars and nothing resolved any of them:
 * `@coordinates-with <target>` (a sibling, a tree-relative path, a repo path,
 * a glob, or a Rust `a::b` module path), `@module <path>` (the file's OWN path
 * relative to its tree root, extension dropped) and `Plan: <file>`. A target
 * that moved, was renamed or was deleted kept reading as documentation: the
 * 2026-09-07 inspection (feature ledger F4) found `@coordinates-with
 * closeDecision.ts` with no such file under `src/`, two `@module utils/…`
 * headers on files living in `services/ime/`, and a Rust header pointing at a
 * TypeScript hook that no longer exists. Rule 22 asks for headers to be kept
 * in sync; this is the check that notices when they are not.
 *
 * How it fails: an unresolved reference that is not in the identity baseline
 * fails, and so does a baseline entry that no longer occurs — two-way, the
 * house standard, so a fixed header must be recorded as a win rather than
 * silently becoming headroom. The baseline is MEASURED (`--update`), never
 * prescribed, and only ratchets down: `scripts/baselineRatchetManifest.mjs`
 * registers it with `onAdd: "fail"`. A missing or malformed baseline fails
 * closed. `dev-docs/` targets are maintainer-local: verified where the
 * directory exists, and neither a finding nor a stale entry where it is not,
 * so public CI never fails on a file it cannot see.
 *
 * Usage: node scripts/check-header-references.mjs [--update] [--report] [--root=<dir>]
 *   exit 0  every reference resolves or is baselined, and every entry still occurs
 *   exit 1  an unlisted finding, a stale entry, or an unreadable baseline
 *   exit 64 bad invocation
 *
 * The grammar and resolution live in `scripts/lib/headerReferences.mjs`; this
 * file is the CLI over them and re-exports them for the self-test.
 *
 * @coordinates-with scripts/lib/headerReferences.mjs — extraction, resolution, comparison
 * @coordinates-with scripts/header-references-baseline.json — the measured identity list
 * @coordinates-with scripts/baselineRatchetManifest.mjs — registers the baseline (onAdd: fail)
 * @coordinates-with scripts/check-header-references.test.mjs — the self-test
 * @coordinates-with .claude/rules/22-comment-maintenance.md — the rule this enforces
 * @module scripts/check-header-references
 */
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  KINDS,
  collectFindings,
  compareWithBaseline,
  extractReferences,
  formatBaseline,
  isMaintainerLocalKey,
  resolveReference,
  validateBaseline,
} from "./lib/headerReferences.mjs";

export { collectFindings, compareWithBaseline, extractReferences, resolveReference };

export const BASELINE_PATH = "scripts/header-references-baseline.json";
const USAGE = "Usage: node scripts/check-header-references.mjs [--update] [--report] [--root=<dir>]";

/** Parse argv; throws on an unknown flag or a `--root` that is not a directory. */
export function parseArgs(argv, defaultRoot) {
  const opts = { update: false, report: false, root: defaultRoot };
  // `path.resolve("")` is the CWD, so a bare `--root=` used to silently scan
  // wherever the caller happened to stand instead of the tree it named — the
  // difference between "checked nothing" and "checked something else" is
  // invisible in the output (audit R2 #51).
  const root = (raw, spelling) => {
    if (raw.trim() === "") throw new Error(`${spelling} needs a directory path\n${USAGE}`);
    return path.resolve(raw);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--update") opts.update = true;
    else if (a === "--report") opts.report = true;
    else if (a.startsWith("--root=")) opts.root = root(a.slice("--root=".length), "--root=");
    else if (a === "--root" && i + 1 < argv.length) opts.root = root(argv[++i], "--root");
    else throw new Error(`unknown argument ${JSON.stringify(a)}\n${USAGE}`);
  }
  const s = statSync(opts.root, { throwIfNoEntry: false });
  if (!s?.isDirectory()) throw new Error(`--root is not a directory: ${opts.root}\n${USAGE}`);
  return opts;
}

function readBaseline(file) {
  return validateBaseline(JSON.parse(readFileSync(file, "utf8")), path.basename(file));
}

function printReport(findings, stats) {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, findings.filter((f) => f.kind === k)]));
  for (const kind of KINDS) {
    console.log(`\n## ${kind} — ${byKind[kind].length} finding(s) of ${stats.references[kind]} reference(s)`);
    for (const f of byKind[kind]) console.log(`  ${f.file}:${f.line}  ${f.target}\n      ${f.reason}`);
  }
  console.log(`\nℹ️  ${stats.files} source files scanned; ${stats.generatedSkipped} generated file(s) skipped.`);
  const via = stats.resolvedVia;
  console.log(`ℹ️  Resolved ${via.location} from the referencing location, ${via.tail} by path suffix only, ${via.dependency} as declared dependencies.`);
  console.log(
    stats.devDocsPresent
      ? `ℹ️  dev-docs/ present: ${stats.maintainerLocalChecked} maintainer-local reference(s) verified.`
      : `ℹ️  dev-docs/ absent: ${stats.maintainerLocalSkipped} maintainer-local reference(s) skipped, never a failure here.`,
  );
}

function printFailures({ unlisted, stale }, findings) {
  const byKey = new Map(findings.map((f) => [f.key, f]));
  if (unlisted.length > 0) {
    console.error(`\n❌ ${unlisted.length} header reference(s) do not resolve and are not baselined:\n`);
    for (const key of unlisted) {
      const f = byKey.get(key);
      console.error(`   ${f.file}:${f.line}  [${f.kind}] ${f.target}\n       ${f.reason}`);
    }
    console.error(
      "\n   Fix the header: the target moved, was renamed or was deleted (rule 22).\n" +
        `   Do NOT append to ${BASELINE_PATH} — it only ratchets down.\n`,
    );
  }
  if (stale.length > 0) {
    console.error(`\n❌ ${stale.length} baselined finding(s) no longer occur — record the win:\n`);
    for (const key of stale) console.error(`   ${key}`);
    console.error(
      `\n   Delete these entries from ${BASELINE_PATH} so the improvement cannot\n` +
        "   silently become headroom (or run --update, which rewrites the list).\n",
    );
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), path.resolve(import.meta.dirname, ".."));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(64);
  }
  const baselinePath = path.join(opts.root, BASELINE_PATH);
  let collected;
  try {
    collected = collectFindings(opts.root);
  } catch (error) {
    // A manifest that cannot be parsed, or an unreadable tree: the gate cannot
    // measure, so it says why and fails rather than reporting a clean tree.
    console.error(`❌ Cannot scan header references under ${opts.root}: ${error.message}`);
    process.exit(1);
  }
  const { findings, stats } = collected;
  const total = Object.values(stats.references).reduce((a, b) => a + b, 0);
  if (opts.report) printReport(findings, stats);

  if (opts.update) {
    let previous = [];
    try {
      previous = readBaseline(baselinePath).entries;
    } catch (error) {
      // Only a MISSING baseline is the first-measurement case. A malformed or
      // unreadable one is a defect to look at, never something to overwrite.
      if (error?.code !== "ENOENT") {
        console.error(`❌ Cannot read header-reference baseline (${baselinePath}): ${error.message}`);
        console.error("   --update refuses to overwrite a baseline it cannot parse; fix or delete it first.");
        process.exit(1);
      }
    }
    // Entries that cannot be verified here (dev-docs/ absent) are kept, not dropped:
    // rewriting the list on a machine that cannot see them is not a re-measurement.
    const kept = stats.devDocsPresent ? [] : previous.filter(isMaintainerLocalKey);
    const next = [...new Set([...findings.map((f) => f.key), ...kept])].sort();
    // Written through a sibling temp file and RENAMED into place, the way
    // scripts/gen-feature-ledger.mjs writes the ledger: a direct write
    // TRUNCATES first, so an interruption or a full disk leaves a partial
    // baseline. A write failure is reported here rather than escaping as an
    // unhandled stack trace with no mention of --update (audit R2 #53).
    const tmpPath = `${baselinePath}.tmp-${process.pid}`;
    try {
      writeFileSync(tmpPath, formatBaseline(next));
      renameSync(tmpPath, baselinePath);
    } catch (error) {
      rmSync(tmpPath, { force: true });
      console.error(`❌ Cannot write the header-reference baseline (${baselinePath}): ${error.message}`);
      console.error("   Nothing was changed — the previous baseline is intact.");
      process.exit(1);
    }
    const added = next.filter((k) => !previous.includes(k)).length;
    const removed = previous.filter((k) => !next.includes(k)).length;
    console.log(`✍️  Wrote ${next.length} entr${next.length === 1 ? "y" : "ies"} to ${baselinePath} (+${added} / -${removed}).`);
    if (added > 0 && previous.length > 0) {
      console.log("⚠️  The list grew. The ratchet manifest refuses additions in CI unless this is a declared re-measurement.");
    }
    return;
  }

  let baseline;
  try {
    baseline = readBaseline(baselinePath);
  } catch (error) {
    // --report has already printed; the verdict is still the documented one.
    console.error(`❌ Cannot read header-reference baseline (${baselinePath}): ${error.message}`);
    console.error("   The gate fails closed — measure one with --update, never skip the check.");
    process.exit(1);
  }
  const result = compareWithBaseline(findings, baseline, { devDocsPresent: stats.devDocsPresent });
  if (result.unlisted.length === 0 && result.stale.length === 0) {
    const ignored = result.ignored.length > 0 ? `; ${result.ignored.length} dev-docs/ entr${result.ignored.length === 1 ? "y" : "ies"} unverifiable here` : "";
    console.log(`✅ Header references: ${total} checked across ${stats.files} files; ${findings.length} known-stale, all baselined${ignored}.`);
    return;
  }
  printFailures(result, findings);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
