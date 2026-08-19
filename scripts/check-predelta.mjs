#!/usr/bin/env node
/**
 * Pre-push DELTA gate — runs, in parallel and collecting ALL failures, exactly
 * the `check:all` gates that `check:fast` does NOT see, WITHOUT the full app
 * test-coverage suite.
 *
 * WHY THIS EXISTS. `check:fast` (typecheck + eslint + tests related to the diff)
 * is the inner loop; it is structurally blind to a whole class of gates —
 * baseline/ratchet lints, the sidecar's build+coverage (including the spawned
 * `dist/cli.js` that alone catches a missing ESM `.js` extension), the
 * production build's `size-limit`, and the app tests that read files at runtime
 * so the `--changed` import graph never selects them. Those only fail under
 * `check:all`, which is a ~15-minute run that EXITS ON THE FIRST FAILURE — so it
 * surfaces one problem per run and turns a batch of independent issues into a
 * batch of sequential 15-minute cycles. Using a slow gate that way is discovery,
 * not confirmation; the house rule (`AGENTS.md`, CLAUDE.md "never use a slow gate
 * as an instrument of discovery") is to enumerate the failure class first. This
 * script IS that enumeration, made a command: run every delta gate at once, in
 * ~2–4 minutes, and report EVERY failure together.
 *
 * WHAT IT RUNS — derived from `package.json`, not hardcoded, so it cannot drift:
 *   - every leaf gate in `check:static` except `lint` (already in check:fast),
 *   - `check:servers` and `check:build` as units (their internal order — build
 *     before size/coverage — is a real dependency, so within-unit exit-on-first
 *     is correct, not hiding),
 *   - the runtime-file app tests the `--changed` graph misses (discovered by
 *     scanning app-tier test files for `readFileSync`/`readdirSync`).
 *
 * WHAT IT DELIBERATELY SKIPS, printed loudly every run so a green result is
 * never mistaken for `check:all` green: the full instrumented app coverage suite
 * (`test:coverage`), and check:fast's own steps (typecheck, eslint,
 * changed-tests). The intended flow is `check:fast` while you work → `check:predelta`
 * before you push → one confirming `check:all`.
 *
 * NOT a CI gate. It is a developer/pre-push convenience (like the offline
 * pre-push gate), so it is intentionally absent from `check:all` — enforced by
 * `check-predelta.test.mjs`, which also pins the derivation and the
 * collect-all-failures behaviour so this gate cannot itself become the silent
 * one it exists to prevent.
 *
 * @coordinates-with scripts/lib/packageScripts.mjs — invokedScripts (the derivation)
 * @coordinates-with package.json — check:fast / check:static / check:servers / check:build
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokedScripts } from "./lib/packageScripts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The composition names — run their leaves individually, never as a unit. */
export const CI_GROUPS = ["check:static", "test:coverage", "check:servers", "check:build"];
/** What check:fast already covers, so the delta excludes it. */
export const FAST_STEPS = ["typecheck", "lint", "test:changed"];
/** Units whose internal ordering is a real dependency (build → size/coverage). */
export const UNIT_GATES = ["check:servers", "check:build"];

/**
 * The npm gate names predelta runs INDIVIDUALLY (in parallel) — every leaf of
 * `check:static` except `lint`. Derived, so a gate added to `check:static` is
 * picked up automatically.
 */
export function individualGates(scripts) {
  return invokedScripts(scripts, "check:static").filter(
    (g) => g !== "lint" && !CI_GROUPS.includes(g),
  );
}

/**
 * The full plan: `{ gates: [{name, argv}], skipped: string[] }`. `argv` is an
 * execFile-style array (no shell), so a gate name can never be a shell-injection
 * vector.
 */
export function computePlan(scripts, runtimeTestFiles) {
  const gates = [
    ...individualGates(scripts).map((name) => ({ name, argv: ["pnpm", name] })),
    ...UNIT_GATES.map((name) => ({ name, argv: ["pnpm", name] })),
  ];
  if (runtimeTestFiles.length > 0) {
    gates.push({
      name: "runtime-file app tests",
      argv: ["pnpm", "exec", "vitest", "run", ...runtimeTestFiles],
    });
  }
  const skipped = ["test:coverage (full instrumented app suite)", ...FAST_STEPS];
  return { gates, skipped };
}

/**
 * App-tier test files that read files at runtime (so `vitest --changed` never
 * selects them). `entries` is `[{ path, readsFiles }]`. Excludes the soak and
 * WebKit tiers — they are not part of the `check:all` app suite.
 */
export function discoverRuntimeFileTests(entries) {
  return entries
    .filter((e) => e.readsFiles)
    .filter((e) => !/\.(soak|webkit)\.test\.[cm]?tsx?$/.test(e.path))
    .map((e) => e.path)
    .sort();
}

/** Scan `src/` for app test files, flagging which read files at runtime. */
function scanRuntimeFileTests(root = ROOT) {
  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === "node_modules") continue;
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (/\.(test|spec)\.[cm]?tsx?$/.test(name)) {
        const body = readFileSync(full, "utf8");
        entries.push({
          path: full.slice(root.length + 1),
          readsFiles: /\breadFileSync\b|\breaddirSync\b|\bglobSync\b/.test(body),
        });
      }
    }
  };
  walk(join(root, "src"));
  return discoverRuntimeFileTests(entries);
}

/** Run one gate, capturing combined output. Never throws. */
function runGate(gate, spawnFn = spawn) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawnFn(gate.argv[0], gate.argv.slice(1), { cwd: ROOT, env: process.env });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", (e) => resolve({ name: gate.name, ok: false, code: -1, out: String(e), ms: Date.now() - started }));
    child.on("close", (code) => resolve({ name: gate.name, ok: code === 0, code: code ?? -1, out, ms: Date.now() - started }));
  });
}

/**
 * Run every gate with bounded concurrency, collecting ALL results — a failure
 * never short-circuits the rest. This is the whole point: independent gates fail
 * independently, and the pre-push run must surface every one at once.
 */
export async function runAll(gates, { spawnFn = spawn, concurrency = Math.max(1, cpus().length - 2) } = {}) {
  const results = [];
  let next = 0;
  async function worker() {
    for (let i = next++; i < gates.length; i = next++) {
      results[i] = await runGate(gates[i], spawnFn);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, gates.length) }, worker));
  return results;
}

/** A pass/fail summary of the results. */
export function summarize(results) {
  const failed = results.filter((r) => !r.ok);
  return { total: results.length, failed: failed.length, failures: failed };
}

async function main() {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
  const runtimeTests = scanRuntimeFileTests();
  const { gates, skipped } = computePlan(scripts, runtimeTests);

  console.error(`▶ check:predelta — ${gates.length} delta gate(s), in parallel, all failures collected.`);
  console.error(`  Skipped (run \`pnpm check:all\` for these): ${skipped.join(", ")}.\n`);

  const results = await runAll(gates);
  const { failed, total, failures } = summarize(results);

  for (const r of results) {
    console.error(`  ${r.ok ? "✅" : "❌"} ${r.name}  (${(r.ms / 1000).toFixed(1)}s)`);
  }
  if (failed > 0) {
    for (const f of failures) {
      console.error(`\n──────── ❌ ${f.name} (exit ${f.code}) ────────`);
      console.error(f.out.trimEnd());
    }
    console.error(`\n❌ check:predelta: ${failed}/${total} delta gate(s) failed. Fix all, then \`pnpm check:all\`.`);
    process.exit(1);
  }
  console.error(`\n✅ check:predelta: all ${total} delta gates passed. Confirm with \`pnpm check:all\` before pushing.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
