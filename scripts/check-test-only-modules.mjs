#!/usr/bin/env node
/**
 * Production-reachability gate (WI-FL0.1) — a module that only its tests import
 * is dead in production, and knip's default mode cannot see it.
 *
 * Why: `pnpm knip` treats every test file as an ENTRY (knip.json), so a module
 * reachable only from a test counts as used. The 2026-09-07 feature ledger found
 * 14 such modules by hand (finding F1). A direct-importer rule ("does any
 * non-test file import it?") was rejected in review: it is fooled by dead→dead
 * chains — GhaWorkflowPanel imports WorkflowPanelShell, and nothing imports
 * GhaWorkflowPanel — and by import cycles.
 *
 * What it does: runs knip in PRODUCTION mode against scripts/knip-production.json,
 * whose entry and project patterns carry knip's `!` production marker. Roots are
 * src/main.tsx, scripts/*.{ts,mjs}, .claude/hooks/*.mjs and the two server
 * packages' cli/index, so the result is reachability from real roots, following
 * static imports, dynamic import(), re-exports and the `@/` alias (knip resolves
 * tsconfig paths). Every file knip reports as unused is unreachable from every
 * root. Test-support modules (src/test/, __tests__/, *.testUtils.ts, src/bench/,
 * a `testX.ts` helper) are legitimately test-only; isTestSupport() names the
 * convention and they are not findings.
 *
 * Measured on adoption: 71 unreachable files, 41 of them test support, so 30
 * findings (the ledger had found 14 by hand) — frozen in scripts/test-only-modules-baseline.json as an IDENTITY
 * list. Two-way, the house standard: an unlisted finding fails, and so does a
 * listed module that is no longer a finding (record the win by deleting the
 * entry, or `--update`). Phase 3 of the plan drives the list to zero.
 *
 * Fails closed: knip missing or crashing (anything but its "issues found" exit
 * 1), a non-JSON reply or one whose shape is not the reporter's, an exit status
 * that DISAGREES with the report (exit 1 with no unused file listed, or exit 0
 * with one), a malformed baseline, a baseline that cannot be written, or a
 * production ENTRY that no longer exists on disk — a literal file, or a glob
 * that matches nothing — each exit 2 with a loud message. The entry check
 * matters: renaming src/main.tsx would otherwise empty the graph and report
 * every module as a finding — visible while the baseline is non-empty (every
 * entry turns stale) and invisible once it reaches zero, so the roots are
 * asserted directly.
 *
 * `--update` re-measures, and REFUSES to grow an existing baseline — including
 * one that has reached zero; only a baseline that does not exist yet is
 * written unconditionally: entries only leave (wire the module, delete it, or
 * move it under a test-support path). `--allow-growth` overrides that for a
 * declared re-measurement — one the ratchet manifest (`onAdd: "fail"`) must
 * also be told about.
 *
 * Exit codes: 0 clean, 1 findings or stale entries, 2 gate failure, 64 usage.
 * Self-tested by scripts/check-test-only-modules.test.mjs.
 *
 * @coordinates-with scripts/knip-production.json — the production graph definition
 * @coordinates-with scripts/test-only-modules-baseline.json — the identity baseline
 * @coordinates-with scripts/baselineRatchetManifest.mjs — registers the baseline
 * @coordinates-with knip.json — the default-mode config this gate does NOT use
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(import.meta.dirname, "..");
export const CONFIG_PATH = "scripts/knip-production.json";
export const BASELINE_PATH = "scripts/test-only-modules-baseline.json";

const USAGE = "usage: node scripts/check-test-only-modules.mjs [--update [--allow-growth]] [--report]";

/**
 * Modules that legitimately live only in the test graph. A path matching one of
 * these is test support, not a finding. The convention is deliberately narrow:
 * a production-looking module under a production directory that only tests
 * import is exactly the defect this gate exists to report.
 */
/**
 * Test-support modules a directory or suffix convention does not reach, named
 * one by one. This was a `test[A-Z]\w*` FILENAME pattern, which is a claim
 * about every future file too: `testConnection.ts`, `testHarness.ts`,
 * `testRenderer.ts` are ordinary production names, and one of them going dead
 * would have been excluded from the measurement rather than reported
 * (audit R2 #83). Measured 2026-09-08 across `src/`, `scripts/`, `server/` and
 * `e2e/`: the pattern matched exactly three files, two of them already covered
 * by the `__tests__/` rule, so the whole heuristic was carrying ONE entry.
 * The self-test asserts every entry still exists in THIS repository (it cannot
 * live in the gate itself, which also runs against fixture trees), so the list
 * cannot rot into an exclusion of nothing.
 */
export const TEST_SUPPORT_FILES = new Set(["src/utils/markdownPipeline/testSchema.ts"]);

export function isTestSupport(path) {
  const p = path.replace(/\\/g, "/");
  return (
    /(^|\/)(__tests__|__mocks__|__acceptance__)\//.test(p) ||
    /^src\/(test|bench)\//.test(p) ||
    /^scripts\/__tests__\//.test(p) ||
    /^e2e\//.test(p) ||
    /\.(test|spec|testUtils|bench)\.[cm]?[jt]sx?$/.test(p) ||
    TEST_SUPPORT_FILES.has(p)
  );
}

/**
 * Unused-file paths out of knip's JSON reporter output; both shapes it has
 * used (a root `files` array, and knip 6's `issues[].files[]`). Every record
 * is validated — a string, or an object with a string `name` — because a
 * report of unknown shape read as empty would be a measurement of nothing
 * that looks like a clean tree.
 */
export function parseKnipFiles(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`knip did not return JSON: ${err.message}\n--- output starts ---\n${String(jsonText).slice(0, 400)}`);
  }
  if (!parsed || typeof parsed !== "object" || (!Array.isArray(parsed.issues) && !Array.isArray(parsed.files))) {
    throw new Error("knip JSON has neither an `issues` array nor a `files` array");
  }
  const names = new Set();
  const record = (f, where) => {
    if (typeof f === "string" && f !== "") return names.add(f);
    if (f && typeof f === "object" && typeof f.name === "string" && f.name !== "") return names.add(f.name);
    throw new Error(`knip JSON: ${where} holds a file record of unknown shape: ${JSON.stringify(f)}`);
  };
  for (const f of parsed.files ?? []) record(f, "files[]");
  // EVERY issue record must carry a `files` array. Accepting one without it
  // meant a reporter-schema change could drop findings while the rest of the
  // report kept the run looking valid — a partial measurement that reads as a
  // clean tree (audit R2 #84). Measured against knip's real production output
  // on 2026-09-08: 58 of 58 records carry it, so this refuses nothing that
  // ships. The pre-knip-6 shape (a ROOT `files` array) is still accepted, and
  // then `issues` is not the carrier.
  const rootFiles = Array.isArray(parsed.files);
  (parsed.issues ?? []).forEach((issue, i) => {
    if (!issue || typeof issue !== "object") throw new Error(`knip JSON: issues[${i}] is not an issue record`);
    if (!Array.isArray(issue.files)) {
      if (rootFiles) return;
      throw new Error(
        `knip JSON: issues[${i}] carries no \`files\` array (keys: ${Object.keys(issue).join(", ") || "none"}) — ` +
          "a report this gate only half understands is not a measurement",
      );
    }
    for (const f of issue.files) record(f, `issues[${i}].files[]`);
  });
  return [...names].map((n) => n.replace(/\\/g, "/")).sort();
}

/** Production entry patterns declared by the config: `{ dir, pattern, isGlob }`, pattern relative to `dir`. */
export function productionEntries(config) {
  const out = [];
  for (const [dir, ws] of Object.entries(config.workspaces ?? {})) {
    for (const pattern of ws.entry ?? []) {
      if (!pattern.endsWith("!")) continue;
      const bare = pattern.slice(0, -1);
      // The character class must match what globToRegExp UNDERSTANDS: `[`/`]`
      // are refused there, so classifying them as glob syntax here would turn a
      // literal path into a glob that matches nothing (audit R2 #85).
      out.push({ dir, pattern: bare, isGlob: /[*?{}]/.test(bare) });
    }
  }
  return out;
}

/**
 * knip's entry-glob dialect as a RegExp over a `/`-joined relative path: `*`,
 * `**`, `?` and `{a,b}` — and NOTHING else, stated by refusing the rest.
 *
 * An unmatched `{` set `i = pattern.indexOf("}", i)` to -1, the loop's `i++`
 * made it 0, and the scan restarted from the beginning: a HANG, in a gate, on
 * a one-character typo (audit R2 #85). A bracket expression is refused for the
 * matching reason — the converter escapes `[` and `]` as literals, so a
 * `[abc]` pattern would be classified as a glob and then matched literally,
 * quietly matching nothing.
 */
export function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") { re += "(?:.*)"; i++; if (pattern[i + 1] === "/") { re += "\\/?"; i++; } }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) throw new Error(`knip-production.json: unterminated \`{\` in the entry pattern ${JSON.stringify(pattern)}`);
      re += `(?:${pattern.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
      i = end;
    }
    else if (c === "[" || c === "]") throw new Error(`knip-production.json: bracket expressions are not supported in the entry pattern ${JSON.stringify(pattern)} — this converter would match them literally`);
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Files under `root/dir` matching a knip entry glob (vendored and build dirs skipped). */
export function globMatches(root, dir, pattern) {
  const re = globToRegExp(pattern);
  const skip = new Set(["node_modules", "dist", "target", ".git", "coverage"]);
  const hits = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(abs, entry.name), childRel);
      else if (re.test(childRel)) hits.push(childRel);
    }
  };
  const base = join(root, dir);
  if (existsSync(base)) walk(base, "");
  return hits.sort();
}

/** Every entry/project pattern must carry the `!` marker, or production mode has no graph. */
export function unmarkedPatterns(config) {
  const out = [];
  for (const [dir, ws] of Object.entries(config.workspaces ?? {})) {
    for (const key of ["entry", "project"]) {
      for (const pattern of ws[key] ?? []) if (!pattern.endsWith("!")) out.push(`${dir}: ${key} ${pattern}`);
    }
  }
  return out;
}

export function readConfig(root = ROOT) {
  return JSON.parse(readFileSync(join(root, CONFIG_PATH), "utf8"));
}

/** Throws when the production graph cannot be trusted; the gate exits 2 on it. */
export function assertGraphDefinition(config, root = ROOT) {
  const unmarked = unmarkedPatterns(config);
  if (unmarked.length) {
    throw new Error(`knip-production.json: patterns without the \`!\` production marker (the graph would be empty):\n  ${unmarked.join("\n  ")}`);
  }
  const entries = productionEntries(config);
  if (!entries.some((e) => !e.isGlob)) throw new Error("knip-production.json declares no literal production entry file");
  // A literal entry must exist; a glob entry must match at least one file —
  // an unmatched root (`scripts/*.mjs` after a rename) silently shrinks the
  // graph, and everything only that root reached turns into a finding.
  const missing = entries
    .filter((e) => (e.isGlob ? globMatches(root, e.dir, e.pattern).length === 0 : !existsSync(join(root, e.dir, e.pattern))))
    .map((e) => `${e.dir === "." ? "" : `${e.dir}/`}${e.pattern}${e.isGlob ? " (glob matches no file)" : ""}`);
  if (missing.length) {
    throw new Error(`production entry file(s) missing on disk — the graph would report everything unreachable:\n  ${missing.join("\n  ")}`);
  }
}

export function runKnip(root = ROOT, exec = execFileSync) {
  const args = ["exec", "knip", "--production", "--config", CONFIG_PATH, "--include", "files", "--reporter", "json", "--no-progress"];
  let status = 0;
  let stdout;
  try {
    stdout = exec("pnpm", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // knip's exit codes: 1 = issues found (the normal path here; stdout is the
    // report), 2 = knip itself failed (bad config, crash). Only a report from
    // exit 1 is a report — JSON-shaped stdout from a crash is still a crash.
    if (err.status !== 1 || typeof err.stdout !== "string" || !err.stdout.trim().startsWith("{")) {
      throw new Error(`knip failed to run (exit ${err.status ?? "?"}): ${err.stderr || err.message}`);
    }
    status = 1;
    stdout = err.stdout;
  }
  // The exit status and the report must agree: "issues found" with no unused
  // file listed (or "clean" with one) is a report this gate did not ask for —
  // a reporter or filter drift — and is not a measurement.
  const files = parseKnipFiles(stdout);
  if (status === 1 && files.length === 0) throw new Error("knip exited 1 (issues found) but its JSON report lists no unused file — an inconsistent report is not a measurement");
  if (status === 0 && files.length > 0) throw new Error(`knip exited 0 (no issues) but its JSON report lists ${files.length} unused file(s) — an inconsistent report is not a measurement`);
  // The VALIDATED list, not the raw text. Returning the text made `measure()`
  // parse the same report a second time, so the shape this function has already
  // checked was re-derived by a second call that could drift from it — two
  // readings of one measurement (audit R3 #86).
  return files;
}

/** The baseline's sorted entries, or `null` when no baseline file exists yet — an EMPTY baseline is a baseline. */
export function readBaseline(root = ROOT) {
  const p = join(root, BASELINE_PATH);
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error(`${BASELINE_PATH}: expected an \`entries\` array`);
  const seen = new Set();
  for (const e of parsed.entries) {
    if (typeof e !== "string" || e === "") throw new Error(`${BASELINE_PATH}: entry is not a path string: ${JSON.stringify(e)}`);
    if (seen.has(e)) throw new Error(`${BASELINE_PATH}: duplicate entry ${e}`);
    seen.add(e);
  }
  return [...parsed.entries].sort();
}

export function writeBaseline(findings, root = ROOT) {
  const body = {
    "//": [
      "WI-FL0.1 — modules unreachable from every production root (scripts/knip-production.json),",
      "measured by scripts/check-test-only-modules.mjs. IDENTITY list, two-way: an unlisted",
      "finding fails the gate, and so does an entry that is no longer a finding. Entries only",
      "leave; Phase 3 of the feature-ledger plan deletes or wires each one. Never add by hand:",
      "`node scripts/check-test-only-modules.mjs --update` records the measured set.",
    ],
    entries: [...new Set(findings)].sort(),
  };
  // Written to a SIBLING temporary file and renamed into place. A direct
  // write truncates first, so an interruption or a full disk leaves a
  // half-written baseline — which the next run cannot parse, and which a
  // reviewer reads as a deliberate reset (audit R2 #87). A rename inside one
  // directory is atomic: a reader sees the old baseline or the new one.
  const target = join(root, BASELINE_PATH);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
  renameSync(tmp, target);
}

export function compareWithBaseline(findings, baseline) {
  const f = new Set(findings);
  const b = new Set(baseline);
  return {
    unlisted: findings.filter((x) => !b.has(x)).sort(),
    stale: baseline.filter((x) => !f.has(x)).sort(),
  };
}

/**
 * What `--update` may write: growth of an EXISTING baseline (`null` means none
 * exists yet) is refused unless explicitly allowed. A baseline that reached
 * zero still exists, so a regression cannot be written through it either.
 */
export function updateDecision(findings, baseline, { allowGrowth = false } = {}) {
  const { unlisted: added, stale: removed } = compareWithBaseline(findings, baseline ?? []);
  return { added, removed, refused: !allowGrowth && baseline !== null && added.length > 0 };
}

/** The measured findings on the live tree: unreachable, and not test support. */
export function measure(root = ROOT) {
  const config = readConfig(root);
  assertGraphDefinition(config, root);
  const all = runKnip(root);
  return { all, findings: all.filter((p) => !isTestSupport(p)) };
}

function main(argv) {
  const flags = new Set(argv);
  for (const a of argv) if (!["--update", "--report", "--allow-growth"].includes(a)) { console.error(USAGE); return 64; }
  if (flags.has("--allow-growth") && !flags.has("--update")) { console.error(USAGE); return 64; }
  let measured;
  let existing;
  try {
    measured = measure();
    existing = readBaseline();
  } catch (err) {
    console.error(`✗ check-test-only-modules: ${err.message}`);
    return 2;
  }
  const { all, findings } = measured;
  const baseline = existing ?? [];
  if (flags.has("--update")) {
    const { added, removed, refused } = updateDecision(findings, existing, { allowGrowth: flags.has("--allow-growth") });
    if (refused) {
      for (const p of added) console.log(`✗ would ADD to the baseline: ${p}`);
      console.log(`\n--update refused: entries only leave this baseline. Wire, delete or move the module; --allow-growth records a declared re-measurement (the ratchet manifest refuses growth in CI regardless).`);
      return 1;
    }
    try {
      writeBaseline(findings);
    } catch (err) {
      console.error(`✗ check-test-only-modules: cannot write ${BASELINE_PATH}: ${err.message}`);
      return 2;
    }
    console.log(`✓ wrote ${findings.length} entries to ${BASELINE_PATH} (+${added.length} / -${removed.length}; ${all.length - findings.length} test-support modules excluded)`);
    return 0;
  }
  const { unlisted, stale } = compareWithBaseline(findings, baseline);
  if (flags.has("--report")) {
    console.log(`production-unreachable modules: ${all.length} (${all.length - findings.length} test support, ${findings.length} findings)`);
    for (const p of findings) console.log(`  ${p}`);
  }
  for (const p of unlisted) console.log(`✗ unreachable from every production root and not in the baseline: ${p}`);
  for (const p of stale) console.log(`✗ baseline entry is no longer a finding (delete it, or --update): ${p}`);
  if (unlisted.length || stale.length) {
    console.log(`\n${unlisted.length} new, ${stale.length} stale. A new finding is a module only tests reach: wire it from a production root, delete it, or move it under a test-support path.`);
    return 1;
  }
  console.log(`✓ check-test-only-modules: ${findings.length} baselined, 0 new, 0 stale (${all.length} unreachable incl. test support)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
