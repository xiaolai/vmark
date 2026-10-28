// WI-AL0.7 — agent-edit-ledger phase and slice gates: self-contained (never read the plan), phase 0 fails independently per missing or stale spike artifact, linked tests are discovered by header and actually run
/**
 * Runs the REAL `scripts/check-al-phase.sh` and `scripts/check-al-slice.sh`
 * against fixture trees (`--root`), house pattern of the other phase-checker
 * self-tests. The fixture's `bin/` is put first on PATH with stub `pnpm` and
 * `cargo` that log their argv and exit 0 — the boundary is the external tool,
 * so the gate's own logic (discovery, routing, cargo filters, the zero-tests
 * guard) runs for real while the test stays fast. `SHIM_FAIL=<substring>` makes
 * a stub fail for matching argv; `SHIM_CARGO_ZERO=1` makes cargo report 0 tests.
 *
 * @coordinates-with scripts/check-al-phase.sh — the phase gate under test
 * @coordinates-with scripts/check-al-slice.sh — the slice gate under test
 * @coordinates-with scripts/lib/al-gate.sh — their shared helpers
 * @module scripts/check-al-phase.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BACKEND_CRASH_CASES } from "./lib/alSpikeBackendVerdict.mjs";
import { SPIKE_INPUTS, spikeFingerprint } from "./lib/alSpikeFingerprint.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const PHASE = path.join(REPO, "scripts", "check-al-phase.sh");
const SLICE = path.join(REPO, "scripts", "check-al-slice.sh");
const GRILLS = "dev-docs/grills/agent-edit-ledger";
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function write(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

const STUB = `#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$STUB_LOG"
if [[ -n "\${SHIM_FAIL:-}" && "$*" == *"$SHIM_FAIL"* ]]; then echo "stub failure"; exit 1; fi
if [[ "$(basename "$0")" == cargo ]]; then
  if [[ -n "\${SHIM_CARGO_ZERO:-}" ]]; then echo "test result: ok. 0 passed; 0 failed"; else echo "test result: ok. 3 passed; 0 failed"; fi
fi
exit 0
`;

/** An empty fixture root with the pnpm/cargo stubs installed. */
function emptyRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "al-gate-"));
  made.push(root);
  for (const tool of ["pnpm", "cargo"]) {
    write(root, `bin/${tool}`, STUB);
    chmodSync(path.join(root, "bin", tool), 0o755);
  }
  return root;
}

const now = Date.now();
/** A sound R24 oracle tally: required-zero counters 0, nontrivial successes > 0. */
const SOUND = { nontrivial: 3, wrong: 0, spanMismatch: 0, requiredMissed: 0, snapshotApplied: 0 };
/** The revert spike's deadline self-test stability record (30 sequential + 10 loaded runs, none failed). */
const STABLE = { suite: "test/deadlineCheck.probe.mjs", sequentialRuns: 30, loadedRuns: 10, loadWorkers: 10, testsPerRun: 37, failedRuns: 0, failures: [] };
const ROW = { passed: 1, failed: 0, skipped: 0 };
/** Caller-measured worker timings (ms) under the 200 ms deadline, and full-sync appends under 25 ms on the provenance path. */
const wall = (p95) => ({ n: 20, p50: p95 - 1, p95, max: p95 });
const PERF = {
  workerDeadline1MB: { edits40: { wall: wall(14), modes: { exact: 20 }, minHunkCount: 40, maxHunkCount: 40 }, edits600: { wall: wall(22), modes: { exact: 20 }, minHunkCount: 600, maxHunkCount: 600 } },
  workerTerminationPathological: { wall: wall(182), modes: { coarse: 20 } },
  consecutiveTimeouts: { timeouts: 10, respawns: 10, killWall: { ...wall(182), n: 10 }, afterKillWall: { ...wall(16), n: 10 }, afterKillModes: { exact: 10 }, afterKillMinHunkCount: 40, afterKillMaxHunkCount: 40 },
  nativeBudgetPathological: { wall: wall(213), modes: { exact: 8 } },
  nativeBudgetRealistic40: { wall: wall(16), modes: { exact: 20 }, minHunkCount: 40, maxHunkCount: 40 },
};
/** Every required crash case, recovered as crash.rs records a pass. */
const CRASH_CASES = BACKEND_CRASH_CASES.map((c) => ({ ...c, observed: c.expected, invariantsOk: true, killedBySigkill: c.boundary !== "none", pass: true }));
/** A one-mutant run list, killed by a named test. */
const KILLED = [{ mutant: "k0", file: "m.ts", killed: true, failing: ["t0"] }];
const append = (op) => ({ sync: "full", op, provenance: true, liveSpans: 600, runs: 60, p50Ms: 9, p95Ms: 10 });
/** The smallest passing document per area (the full verdict table lives in check-al-spike-results.test.mjs). */
const SPIKE_DOCS = {
  revert: {
    workItems: ["WI-AL0.4"], recommendation: { library: "diff-match-patch" }, deadlineSelfTest: STABLE, environment: { cores: 10 },
    libraries: { dmp: { package: "diff-match-patch", verdict: { admissibleViaWorkerTermination: true }, fixtures: { pass: 41, total: 41 }, perf: PERF,
      revertOracleFuzz: { minimal: { summary: SOUND }, mixed: { summary: SOUND } }, revertSeedSweep: { summary: SOUND } } },
  },
  backend: { workItems: ["WI-AL0.5"], recommendation: { backend: "JSONL", arm: "jsonlPacked" }, admissibility: { jsonlPacked: { admissible: true } }, crashInjection: { cases: CRASH_CASES, total: CRASH_CASES.length, failed: 0, failures: [] } },
  txn: { workItems: ["WI-AL0.8"], schemaVersion: 2, gates: { testExit: 0, clippyExit: 0, measureExit: 0 },
    measurements: { captureLatency: [append("observe"), append("linearize")] }, tests: { byArea: { provenance: { run: 1, passed: 1 } }, total: { run: 1, passed: 1 } }, mutationChecks: { killed: 1, survived: 0, mutants: KILLED } },
  anchor: {
    workItem: "WI-AL0.9", totals: { fixtures: 2, exact: 1, widened: 1, failed: 0 },
    blockProvenance: { totals: { cases: 4, pass: 4 }, parts: {
      constructs: { cases: [{ pass: true }] }, serialization: { cases: [{ pass: true }] }, widen: { cases: [{ pass: true }] }, history: { cases: [{ pass: true }] }, lifecycle: { cases: [{ pass: true }] }, attach: { cases: [{ pass: true }] }, rebuild: { cases: [{ pass: true }] },
      perf: { cases: [{ pass: true }], oneMiB: { observeUs: { n: 100, p50: 20, p95: 35, max: 40 } } }, mutants: { total: 1, killed: 1, unexplainedSurvivors: 0, mutants: KILLED },
    } },
  },
  review: {
    workItems: ["WI-AL0.6 (budgets)"], status: "pass", totals: { passed: 4, failed: 0, skipped: 0 },
    testsPerArea: { "sourceProvenance.probe.ts": ROW, "budgets.probe.ts": ROW, "barriers.probe.ts": ROW, "ambiguousRevert.probe.ts": ROW },
    measurements: {
      sourceProvenance: { transactions: 9, spansChecked: 9, kinds: { undo: 1, redo: 1, compose: 1, netZero: 1 } },
      budgets: { cap: 8, session: { observeCpuMs: { n: 9, p95: 0.01 }, captureCpuMs: { n: 9, p95: 0.1 } },
        nearCap: { peakEntries: 8, observeCpuMs: { n: 9, p95: 0.1 }, observeCpuMsNearCap: { n: 9, p95: 0.1 }, captureCpuMs: { n: 9, p95: 0.1 } } },
      barriers: { capOverflow: { cap: 8, ops: 8 } },
      ambiguousRevert: { ledgerOracleFuzz: { byShapeAndMode: { "ab8/mixed": SOUND } }, regressions: { r: { status: "applied", text: "a", expected: "a", ambiguous: 0, wrong: 0, spanMismatch: 0, requiredMissed: 0 } } },
    },
  },
};
const AREAS = Object.keys(SPIKE_DOCS);
/** The files the txn and review verdicts derive their required parity areas and probes from. */
const DERIVED = { txn: ["tests/provenance.rs"], review: Object.keys(SPIKE_DOCS.review.testsPerArea).map((f) => `probes/${f}`) };
/** One area's declared inputs: a file for a dotted basename, else a folder with a probe, plus its derived files. Idempotent. */
function writeInputs(root, spike) {
  for (const rel of SPIKE_INPUTS[spike].inputs) {
    if (path.basename(rel).includes(".")) write(root, rel, `${rel}\n`);
    else write(root, `${rel}/probe.mjs`, "// probe\n");
  }
  for (const rel of DERIVED[spike] ?? []) write(root, `${GRILLS}/${spike}/${rel}`, `// ${rel}\n`);
}
/** One area's results, fingerprinted from inputs already on disk (areas share inputs, so write them all first). */
function writeSpike(root, spike, doc = { ...SPIKE_DOCS[spike], generatedAt: new Date(now - 60_000).toISOString() }) {
  write(root, `${GRILLS}/${spike}/results.json`, JSON.stringify({ ...doc, fingerprint: spikeFingerprint(root, spike) }));
}

const TS_TEST = (header) => `// ${header}\nimport { it } from "vitest";\nit("pins", () => {});\n`;
const RS_TEST = (header) => `// ${header}\n#[test]\nfn pins() {}\n`;

/** Every phase-0 deliverable, satisfied. */
function phase0Root() {
  const root = emptyRoot();
  for (const spike of AREAS) writeInputs(root, spike);
  for (const spike of AREAS) writeSpike(root, spike);
  write(root, "src-tauri/src/lib.rs", "mod mcp_bridge;\n");
  write(root, "src-tauri/src/mcp_bridge/mod.rs", "mod attribution;\nmod types;\n");
  write(root, "src-tauri/src/mcp_bridge/attribution.rs",
    'pub(crate) enum PrincipalWire { Anonymous }\npub(crate) struct McpAttribution {}\n#[cfg(test)]\n#[path = "attribution.test.rs"]\nmod tests;\n');
  write(root, "src-tauri/src/mcp_bridge/attribution.test.rs", RS_TEST("WI-AL0.3 — fixture"));
  write(root, "src-tauri/src/mcp_bridge/types.rs", "pub struct McpRequestEvent {\n    pub attribution: McpAttribution,\n}\n");
  write(root, "src/services/mcpBridge/attribution.ts",
    "export const MAX_SESSION_LABEL_BYTES = 128;\nexport function parseMcpAttribution(raw: unknown) { return raw ? null : null; }\n");
  write(root, "src/services/mcpBridge/attribution.test.ts", TS_TEST("WI-AL0.3 — fixture"));
  write(root, "src/services/mcpBridge/types.ts", "export interface McpRequestEvent {\n  attribution: McpAttribution;\n}\n");
  write(root, "src/test/fixtures/mcpRequestEnvelope.json", "{}\n");
  write(root, "src/test/mcpAttributionFixture.ts", "export const x = 1;\n");
  write(root, "scripts/check-al-phase.sh", "#!/usr/bin/env bash\n");
  write(root, "scripts/check-al-slice.sh", "#!/usr/bin/env bash\n");
  write(root, "scripts/lib/al-gate.sh", "#!/usr/bin/env bash\n");
  write(root, "scripts/check-al-spike-results.mjs", "// checker\n");
  write(root, "scripts/lib/alSpikeFingerprint.mjs", "// fingerprint\n");
  write(root, "scripts/lib/alSpikeVerdicts.mjs", "// verdicts\n");
  write(root, "scripts/lib/alSpikeImportGraph.mjs", "// import graph\n");
  write(root, "scripts/check-al-phase.test.mjs", TS_TEST("WI-AL0.7 — fixture"));
  write(root, "scripts/check-al-spike-results.test.mjs", TS_TEST("WI-AL0.7 — fixture"));
  return root;
}

function run(script, root, args, env = {}) {
  const log = path.join(root, "exec.log");
  const r = spawnSync("bash", [script, ...args, `--root=${root}`], {
    encoding: "utf8",
    cwd: REPO,
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}`, STUB_LOG: log, ...env },
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout}${r.stderr}`, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}
const phase = (root, p, env, ...extra) => run(PHASE, root, [p, ...extra], env);
const slice = (root, s, env, ...extra) => run(SLICE, root, [s, ...extra], env);

describe("check-al-phase.sh 0 — green", () => {
  it("passes with all five fresh artifacts and the WI-AL0.3 deliverables, running their tests", () => {
    const r = phase(phase0Root(), "0");
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toMatch(/✗/);
    expect(r.log).toContain("pnpm vitest run src/services/mcpBridge/attribution.test.ts");
    expect(r.log).toContain("cargo test --manifest-path src-tauri/Cargo.toml --lib -- mcp_bridge::attribution::");
    expect(r.log).toContain("pnpm vitest run --config vitest.gates.config.ts scripts/check-al-phase.test.mjs scripts/check-al-spike-results.test.mjs");
  });

  it("--no-exec leaves the run assertions UNVERIFIED and the phase red", () => {
    const r = phase(phase0Root(), "0", {}, "--no-exec");
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/UNVERIFIED/);
    expect(r.out).not.toMatch(/✗/);
    expect(r.log).toBe("");
  });
});

describe("check-al-phase.sh 0 — each spike artifact fails on its own", () => {
  it.each(AREAS)("missing %s/results.json fails and names it; the other four still pass", (spike) => {
    const root = phase0Root();
    rmSync(path.join(root, GRILLS, spike, "results.json"));
    const r = phase(root, "0");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ .*missing: ${GRILLS}/${spike}/results\\.json`));
    for (const other of AREAS.filter((s) => s !== spike)) {
      expect(r.out).toMatch(new RegExp(`✓ .*${GRILLS}/${other}/results\\.json fresh and passing`));
    }
  });

  it("all five missing are all reported before exit, one line each", () => {
    const root = phase0Root();
    for (const spike of AREAS) rmSync(path.join(root, GRILLS, spike, "results.json"));
    const r = phase(root, "0");
    expect(r.status).toBe(1);
    expect(r.out.match(/✗ .*missing: dev-docs\/grills\/agent-edit-ledger\/\w+\/results\.json/g)).toHaveLength(5);
  });

  it("a stale artifact fails", () => {
    const root = phase0Root();
    writeFileSync(path.join(root, GRILLS, "backend", "probe.mjs"), "// edited after the run\n");
    const r = phase(root, "0");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ .*backend.*stale/);
  });

  it("a shared input (golden/) makes exactly the areas that read it stale: txn and review", () => {
    const root = phase0Root();
    writeFileSync(path.join(root, GRILLS, "golden", "probe.mjs"), "// edited after the run\n");
    const r = phase(root, "0");
    expect(r.status).toBe(1);
    for (const stale of ["txn", "review"]) expect(r.out).toMatch(new RegExp(`✗ .*${stale}/results\\.json: stale`));
    for (const fresh of ["revert", "backend", "anchor"]) expect(r.out).toMatch(new RegExp(`✓ .*${fresh}/results\\.json fresh and passing`));
  });

  it("a review artifact without its provenance verdicts fails", () => {
    const root = phase0Root();
    const { measurements: _m, ...bare } = SPIKE_DOCS.review;
    writeSpike(root, "review", { ...bare, generatedAt: new Date(now - 60_000).toISOString() });
    const r = phase(root, "0");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ .*review.*sourceProvenance/);
  });

  it("a failing verdict fails", () => {
    const root = phase0Root();
    writeSpike(root, "anchor", { ...SPIKE_DOCS.anchor, totals: { fixtures: 2, exact: 1, widened: 0, failed: 1 }, generatedAt: new Date(now - 60_000).toISOString() });
    const r = phase(root, "0");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ .*anchor.*failed/);
  });
});

describe("check-al-phase.sh 0 — the WI-AL0.7 modules", () => {
  it("a missing import-graph module fails and names it", () => {
    const root = phase0Root();
    rmSync(path.join(root, "scripts/lib/alSpikeImportGraph.mjs"));
    const r = phase(root, "0");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ .*scripts\/lib\/alSpikeImportGraph\.mjs/);
  });
});

describe("check-al-phase.sh 0 — the WI-AL0.3 deliverables", () => {
  it("a missing Rust attribution module fails and names it", () => {
    const root = phase0Root();
    rmSync(path.join(root, "src-tauri/src/mcp_bridge/attribution.rs"));
    const r = phase(root, "0");
    expect(r.status).toBe(1);
    expect(r.out).toContain("src-tauri/src/mcp_bridge/attribution.rs");
  });

  it("a failing linked test fails the phase", () => {
    const r = phase(phase0Root(), "0", { SHIM_FAIL: "attribution.test.ts" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ WI-AL0\.3.*vitest/);
  });

  it("cargo running zero tests is a failure, not a pass", () => {
    const r = phase(phase0Root(), "0", { SHIM_CARGO_ZERO: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ WI-AL0\.3.*cargo/);
    expect(r.out).toMatch(/0 tests/);
  });
});

describe("check-al-phase.sh 1-4 — an unstarted phase is red", () => {
  it.each(["1", "2", "3", "4"])("phase %s on an empty tree exits 1", (p) => {
    const r = phase(emptyRoot(), p, {}, "--no-exec");
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/no test file names WI-AL/);
  });
});

describe("check-al-slice.sh", () => {
  /** Slice 1.5, satisfied: a linked two-client test and a capture that no longer hard-codes the actor. */
  function slice15Root() {
    const root = emptyRoot();
    write(root, "src/services/coherence/mcpCapture.ts", "export const actor = (id: string) => id;\n");
    write(root, "src/services/coherence/mcpCapture.reads.test.ts",
      `// WI-AL1.5 — read tracking partitioned by connection\nimport { it } from "vitest";\nit("two clients keep separate reads", () => {});\n`);
    return root;
  }

  it("slice 1.5 passes when satisfied, running its linked test", () => {
    const r = slice(slice15Root(), "1.5");
    expect(r.status, r.out).toBe(0);
    expect(r.log).toContain("pnpm vitest run src/services/coherence/mcpCapture.reads.test.ts");
  });

  it("slice 1.5 fails while capture still hard-codes \"mcp-client\"", () => {
    const root = slice15Root();
    write(root, "src/services/coherence/mcpCapture.ts", 'export const actor = () => "mcp-client";\n');
    const r = slice(root, "1.5");
    expect(r.status).toBe(1);
    expect(r.out).toContain("mcp-client");
  });

  it("slice 1.2 derives the cargo filter from the module that mounts a Rust test", () => {
    const root = emptyRoot();
    write(root, "src-tauri/src/lib.rs", "mod journal;\n");
    write(root, "src-tauri/src/journal/mod.rs", 'pub enum Record { LegacyCheckpoint }\n#[cfg(test)]\n#[path = "mod.test.rs"]\nmod tests;\n');
    write(root, "src-tauri/src/journal/mod.test.rs",
      '// WI-AL1.2 — journal store\n#[test]\nfn pins() { let _ = "crash injection, hydration gap, two-window prepare CAS (STALE_PARENT), pin projection, migration of legacyCheckpoint"; }\n');
    const r = slice(root, "1.2");
    expect(r.status, r.out).toBe(0);
    expect(r.log).toContain("cargo test --manifest-path src-tauri/Cargo.toml --lib -- journal::");
  });

  it("an empty tree fails slice 1.1 and says no test names the work item", () => {
    const r = slice(emptyRoot(), "1.1", {}, "--no-exec");
    expect(r.status).toBe(1);
    expect(r.out).toContain("no test file names WI-AL1.1");
  });

  it("discovery is exact: a WI-AL1.10 header does not link WI-AL1.1, nor does a mention past line 30", () => {
    const root = emptyRoot();
    write(root, "src/a.test.ts", TS_TEST("WI-AL1.10 — another item"));
    write(root, "src/b.test.ts", `${"// filler\n".repeat(30)}// WI-AL1.1 — too late\nimport { it } from "vitest";\nit("x", () => {});\n`);
    const r = slice(root, "1.1", {}, "--no-exec");
    expect(r.out).toContain("no test file names WI-AL1.1");
  });
});

describe("invocation", () => {
  it.each([[[]], [["5"]], [["1.1"]], [["0", "1"]], [["0", "--bogus"]]])("check-al-phase.sh %j exits 64", (args) => {
    expect(run(PHASE, emptyRoot(), args).status).toBe(64);
  });
  it.each([[[]], [["1.8"]], [["2.1"]], [["1"]], [["1.1", "1.2"]]])("check-al-slice.sh %j exits 64", (args) => {
    expect(run(SLICE, emptyRoot(), args).status).toBe(64);
  });
  it("a --root that is not a directory exits 64", () => {
    const r = spawnSync("bash", [PHASE, "0", `--root=${path.join(tmpdir(), "al-not-here-31b")}`], { encoding: "utf8" });
    expect(r.status).toBe(64);
  });
});

describe("self-contained — the gates never read the gitignored plan", () => {
  it.each([
    "scripts/check-al-phase.sh",
    "scripts/check-al-slice.sh",
    "scripts/lib/al-gate.sh",
    "scripts/lib/al-slices.sh",
    "scripts/check-al-spike-results.mjs",
    "scripts/lib/alSpikeFingerprint.mjs",
    "scripts/lib/alSpikeVerdicts.mjs",
    "scripts/lib/alSpikeImportGraph.mjs",
  ])("%s names no plan file", (rel) => {
    const src = readFileSync(path.join(REPO, rel), "utf8");
    expect(src).not.toMatch(/dev-docs\/plans/);
    expect(src).not.toMatch(/agent-edit-ledger\.md/);
    expect(src).not.toMatch(/\$PLAN\b|\bPLAN=/);
  });
});
