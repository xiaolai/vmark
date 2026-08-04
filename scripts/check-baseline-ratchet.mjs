#!/usr/bin/env node
/**
 * Manifest-driven ratchet over EVERY committed baseline (architecture review
 * D2, WI-16).
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Each gate compares the tree against its baseline IN THE SAME COMMIT, so a
 * change can raise its own floor and pass every check: edit the offending
 * file and its baseline number together and the gate reports green. That is
 * the bypass `.claude/rules/60-ai-governance.md` §9/§10 documents as the
 * threat model, and `required_approving_review_count: 0` means no human
 * review structurally stands between it and `main`.
 *
 * This script closes the hole for all of them at once: for every baseline in
 * the manifest it loads the version at the MERGE BASE with the target branch
 * and fails on any loosening. A commit cannot move a floor it is being
 * measured against, because the measurement comes from history it did not
 * write.
 *
 * Three files, one gate:
 *   scripts/baselineRatchetManifest.mjs  WHICH baselines, and in what mode
 *   scripts/baselineRatchetModes.mjs     the pure comparison engine
 *   this file                            discovery, git, reporting, exit code
 *
 * ── Tier: CI, not check:all ──────────────────────────────────────────────
 * `pnpm check:all` deliberately does NOT run this. The comparison needs a
 * base ref, and a local checkout has no guaranteed relationship to
 * `origin/main` (detached HEAD, stale remote, shallow clone, no network).
 * A gate whose central input may be absent locally has to either skip — the
 * silent-pass failure mode this whole plan targets — or block ordinary local
 * work. So it runs in `.github/workflows/ci.yml` on `pull_request`, where the
 * base ref is a defined quantity, and it FAILS CLOSED when that ref cannot be
 * resolved. Run it locally on demand:
 *   node scripts/check-baseline-ratchet.mjs origin/main
 *   node scripts/check-baseline-ratchet.mjs --list   (coverage only, no git)
 *
 * ── Two-way staleness (the manifest is itself checked) ───────────────────
 * A manifest that silently omits a baseline is worse than no manifest: it
 * reads as coverage. So the script discovers baseline-shaped files on disk
 * and fails when one is unregistered, and fails when a manifest entry names a
 * file that no longer exists. Discovery globs, deliberately narrow and stated
 * here rather than inferred:
 *   - `scripts/*.json` and `scripts/*.ts` (TOP LEVEL only) whose basename
 *     contains `baseline`, `allowlist`, or `budget`, case-insensitively
 *   - repository-root `*known-violations*.json`
 * Excluded by construction: `*.test.*` (tests about baselines are not
 * baselines), subdirectories of `scripts/` (fixtures and helpers live there),
 * `.mjs` (that extension is the checkers, not their data), and application
 * source such as `src/utils/htmlAllowlists.ts` (a sanitizer allowlist is
 * runtime data, not a gate floor). `.tokenize/` belongs to an external plugin
 * that no `check:all` gate consults.
 *
 * ── Identity beats counts ────────────────────────────────────────────────
 * Prefer an `identity` baseline over a count wherever the underlying checker
 * can emit one. A count permits a like-for-like swap — drop one baselined
 * violation, add a different one, total unchanged, gate silent — which is the
 * exact defect this gate exists to kill. Modes and their schema are documented
 * in the manifest module.
 *
 * NEW KEYS/ENTRIES are reported loudly but allowed unless the check sets
 * `onAdd: "fail"`. That is a judgement, not an oversight: a new baselined
 * violation is an ADDITION in the diff, legible to any reader, whereas a
 * raised number and an identity swap are the invisible moves. Lists whose own
 * headers forbid additions get `onAdd: "fail"`.
 *
 * @coordinates-with .github/workflows/ci.yml — the `pull_request` step that runs this
 * @coordinates-with scripts/check-file-size.mjs — one of the same-commit halves
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST } from "./baselineRatchetManifest.mjs";
import { evaluateCheck, reconcileAllowRaise } from "./baselineRatchetModes.mjs";

// ─── Discovery ───

const BASELINE_NAME = /(baseline|allowlist|budget)/i;
const BASELINE_EXTS = [".json", ".ts"];
const ROOT_KNOWN_VIOLATIONS = /known-violations.*\.json$/i;

/** Baseline-shaped files on disk, per the globs documented in the header. */
function discoverBaselineFiles(root) {
  const found = [];
  const scriptsDir = path.join(root, "scripts");
  if (existsSync(scriptsDir)) {
    for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (name.includes(".test.")) continue;
      if (!BASELINE_EXTS.some((e) => name.endsWith(e))) continue;
      if (!BASELINE_NAME.test(name)) continue;
      found.push(`scripts/${name}`);
    }
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && ROOT_KNOWN_VIOLATIONS.test(entry.name)) found.push(entry.name);
  }
  return found.sort();
}

/** Both directions: unregistered files on disk, registered files that vanished. */
function auditManifestCoverage(manifest, onDisk, root) {
  const registered = new Set(manifest.entries.map((e) => e.path));
  const failures = [];
  for (const p of onDisk) {
    if (!registered.has(p)) {
      failures.push(
        `${p} looks like a committed baseline but is absent from the ratchet manifest ` +
          "(scripts/baselineRatchetManifest.mjs) — register it, with its comparison mode.",
      );
    }
  }
  for (const e of manifest.entries) {
    if (!existsSync(path.join(root, e.path))) {
      failures.push(`${e.path} is in the ratchet manifest but does not exist — remove its entry.`);
    }
  }
  return failures;
}

// ─── Git + reporting shell ───

function parseArgs(argv) {
  const opts = { baseRef: "origin/main", root: null, manifest: null, list: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") opts.root = argv[++i];
    else if (argv[i] === "--manifest") opts.manifest = argv[++i];
    else if (argv[i] === "--list") opts.list = true;
    else positional.push(argv[i]);
  }
  if (positional.length > 0) opts.baseRef = positional[0];
  return opts;
}

function loadManifest(manifestPath) {
  if (!manifestPath) return MANIFEST;
  const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  return { entries: raw.entries ?? [], allowRaise: raw.allowRaise ?? [] };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = loadManifest(opts.manifest);

  const onDisk = discoverBaselineFiles(root);
  const coverage = auditManifestCoverage(manifest, onDisk, root);

  if (opts.list) {
    const registered = new Set(manifest.entries.map((e) => e.path));
    for (const p of onDisk) console.log(`${registered.has(p) ? "registered  " : "UNREGISTERED"} ${p}`);
    for (const e of manifest.entries) {
      if (!existsSync(path.join(root, e.path))) console.log(`MISSING      ${e.path}`);
    }
    process.exit(coverage.length > 0 ? 1 : 0);
  }

  let mergeBase;
  try {
    mergeBase = execFileSync("git", ["merge-base", opts.baseRef, "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    console.error(
      `❌ Cannot resolve the merge-base of HEAD with "${opts.baseRef}" — the ratchet has nothing to ` +
        "compare against and will not pass by default.\n" +
        "   In CI, check the checkout's fetch-depth (0) and that the base ref was fetched.\n" +
        "   Locally: git fetch origin main.",
    );
    process.exit(1);
  }

  const failures = [...coverage];
  const notices = [];
  const raises = [];

  for (const entry of manifest.entries) {
    if (!existsSync(path.join(root, entry.path))) continue; // already reported by coverage

    let baseRaw;
    try {
      baseRaw = execFileSync("git", ["show", `${mergeBase}:${entry.path}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      notices.push(`${entry.path}: added since the merge base — its contents are the new frozen reality`);
      continue;
    }

    const headRaw = readFileSync(path.join(root, entry.path), "utf8");
    let baseDoc;
    let headDoc;
    if (entry.format === "text") {
      baseDoc = baseRaw;
      headDoc = headRaw;
    } else {
      try {
        baseDoc = JSON.parse(baseRaw);
      } catch (error) {
        failures.push(`${entry.path}@merge-base: cannot parse JSON — ${error.message}`);
        continue;
      }
      try {
        headDoc = JSON.parse(headRaw);
      } catch (error) {
        failures.push(`${entry.path}: cannot parse JSON — ${error.message}`);
        continue;
      }
    }

    for (const check of entry.checks) {
      try {
        const r = evaluateCheck(check, baseDoc, headDoc, entry.path);
        failures.push(...r.failures);
        notices.push(...r.notices);
        raises.push(...r.raises);
      } catch (error) {
        failures.push(`${entry.path}: ${error.message}`);
      }
    }
  }

  const reconciled = reconcileAllowRaise(manifest.allowRaise ?? [], raises);
  failures.push(...reconciled.failures);
  notices.push(...reconciled.notices);
  for (const r of reconciled.unexplained) {
    failures.push(`${r.path}: ${r.key} raised ${r.from} → ${r.to} — baselines only ratchet DOWN.`);
  }

  for (const n of notices) console.log(n.startsWith("    ") ? n : `ℹ️  ${n}`);

  if (failures.length > 0) {
    console.error(`\n❌ Baselines loosened relative to merge-base ${mergeBase.slice(0, 8)}:`);
    for (const f of failures) console.error(f.startsWith("    ") ? f : `  ${f}`);
    console.error(
      "\n  Fix the code and lower the number, or — if a gate was genuinely re-measured — add an\n" +
        "  allowRaise entry to the manifest with a reason. It expires by itself.",
    );
    process.exit(1);
  }

  console.log(
    `✅ Baseline ratchet held: ${manifest.entries.length} baselines compared against merge-base ` +
      `${mergeBase.slice(0, 8)}.`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
