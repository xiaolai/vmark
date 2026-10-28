// WI-AL0.7 — agent-edit-ledger spike artifacts: each results.json must exist, parse, name its work item, carry a passing provenance verdict, and match a sha256 fingerprint of its sources and dependency lockfiles
// WI-AL0.4 (revert), WI-AL0.5 (backend), WI-AL0.6 (review budgets), WI-AL0.9 (anchor) — each spike's acceptance verdict is pinned here
/**
 * Drives the REAL `scripts/check-al-spike-results.mjs` as a subprocess against
 * fixture spike folders in tmpdir, plus its pure `checkSpikeResult` and the
 * shared fingerprint module directly. Pinned, both directions:
 *   - a well-formed, fingerprinted, passing artifact exits 0 for each area
 *     (revert, backend, txn, anchor, review);
 *   - freshness is CONTENT, not mtime: an edited, added or removed source, a
 *     changed lockfile — the spike's own, the repo root's, or a cross-spike
 *     input (review reads revert/lib and golden/), or a src/ file a probe
 *     reaches through imports — is stale and named; an unrelated src/ file and a
 *     touched-but-unchanged file and build outputs (node_modules/, target/,
 *     review/out/, dot-files) are not;
 *   - missing, unparseable, non-object, wrong work item, bad or future
 *     `generatedAt`, no fingerprint, a missing declared input, a folder with no
 *     probe sources, and every failing verdict (R24 oracle counters, R19 cap,
 *     R20/R18 budgets, txn schema v2 + every tests/provenance*.rs parity area
 *     + each durable append's p95 ≤ 25 ms on the provenance path, revert
 *     worker p95/max ≤ 200 ms by the numbers, not the booleans) exit 1 with a
 *     reason;
 *   - an unknown area, no area, or an unusable --root exits 64.
 *
 * @coordinates-with scripts/check-al-spike-results.mjs — the checker under test
 * @coordinates-with scripts/lib/alSpikeFingerprint.mjs — the shared fingerprint the generators also call
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — the per-area verdicts
 * @module scripts/check-al-spike-results.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SPIKES, checkSpikeResult, reviewProbeFiles, txnProvenanceAreas } from "./check-al-spike-results.mjs";
import { reviewVerdict, txnVerdict, revertVerdict } from "./lib/alSpikeVerdicts.mjs";
import { BACKEND_CRASH_CASES } from "./lib/alSpikeBackendVerdict.mjs";
import { GRILLS_DIR, SPIKE_INPUTS, diffFingerprints, spikeFingerprint } from "./lib/alSpikeFingerprint.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO, "scripts", "check-al-spike-results.mjs");
const FP_CLI = path.join(REPO, "scripts", "lib", "alSpikeFingerprint.mjs");
const GRILLS = "dev-docs/grills/agent-edit-ledger";
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** One R24 oracle tally that passes: every required-zero counter 0, nontrivial successes > 0. */
const SOUND = { cases: 10, hunks: 20, applied: 18, nontrivial: 12, wrong: 0, spanMismatch: 0, requiredMissed: 0, snapshotApplied: 0 };
const fuzzed = (lib) => ({ ...lib, revertOracleFuzz: { minimal: { summary: SOUND }, mixed: { summary: SOUND } }, revertSeedSweep: { summary: SOUND } });
const PROBE_ROW = { passed: 3, failed: 0, skipped: 0 };
/** Worker-deadline timings (ms, measured by the caller from call to settle) of a library that meets 200 ms. */
const wall = (p95, max = p95) => ({ n: 20, p50: p95 - 1, p95, max });
const WORKER_PERF = {
  workerDeadline1MB: { edits40: { wall: wall(14, 16), modes: { exact: 20 }, minHunkCount: 40, maxHunkCount: 40 }, edits600: { wall: wall(22, 28), modes: { exact: 20 }, minHunkCount: 600, maxHunkCount: 600 } },
  workerTerminationPathological: { wall: wall(182.7, 182.8), modes: { coarse: 20 } },
  consecutiveTimeouts: { timeouts: 10, respawns: 10, killWall: { ...wall(182.4, 182.5), n: 10 }, afterKillWall: { ...wall(16, 16.2), n: 10 }, afterKillModes: { exact: 10 }, afterKillMinHunkCount: 40, afterKillMaxHunkCount: 40 },
  nativeBudgetPathological: { wall: wall(213, 213.3), modes: { exact: 8 } },
  nativeBudgetRealistic40: { wall: wall(16, 16.3), modes: { exact: 20 }, minHunkCount: 40, maxHunkCount: 40 },
};
/** A mutation-run list: `killed` mutants that each name a failing test, then `equivalent` survivors that each state why. */
const mutantRows = (killed, equivalent = 0) => [
  ...Array.from({ length: killed }, (_, i) => ({ mutant: `k${i}`, file: "m.ts", killed: true, failing: [`t${i}`] })),
  ...Array.from({ length: equivalent }, (_, i) => ({ mutant: `e${i}`, file: "m.ts", killed: false, failing: [], equivalentBecause: "equivalent" })),
];
/** Every required crash case, recovered as crash.rs records a pass. */
const CRASH_CASES = BACKEND_CRASH_CASES.map((c) => ({ ...c, observed: c.expected, invariantsOk: true, killedBySigkill: c.boundary !== "none", pass: true }));
/** The txn test areas that hold Rust/TS provenance parity (one per tests/provenance*.rs). */
const TXN_PROV_AREAS = ["provenance", "provenance_barriers", "provenance_epochs", "provenance_review_golden", "provenance_schema", "provenance_writer_golden"];
const TXN_BY_AREA = { races: { run: 5, passed: 5 }, ...Object.fromEntries(TXN_PROV_AREAS.map((a) => [a, { run: 4, passed: 4 }])) };
const TXN_TOTAL = { run: 5 + 4 * TXN_PROV_AREAS.length, passed: 5 + 4 * TXN_PROV_AREAS.length };
/** Durable-append latency rows on the provenance path: each append judged alone, full sync, 600 live spans. */
const latency = (op, p95Ms, extra = {}) => ({ sync: "full", op, provenance: true, liveSpans: 600, runs: 60, p50Ms: p95Ms - 2, p95Ms, ...extra });
const TXN_LATENCY = [latency("observe", 19.3), latency("linearize", 9.2)];

/** The review probe files (review/probes/*.probe.ts[x]); each must have run and passed. */
const REVIEW_PROBES = ["ambiguousRevert.probe.ts", "barriers.probe.ts", "budgets.probe.ts", "captureSession.probe.ts", "panel.probe.tsx", "pins.probe.ts", "sourceProvenance.probe.ts", "stalePlan.probe.ts"];

/** M3: the deadline self-test ran 30 times alone and 10 under full CPU load, every test passing. */
const STABLE = { suite: "test/deadlineCheck.probe.mjs", sequentialRuns: 30, loadedRuns: 10, loadWorkers: 10, testsPerRun: 37, failedRuns: 0, failures: [] };
/** A passing results document per area, in the shape each real generator writes (fingerprint added per root). */
const PASSING = {
  revert: {
    workItems: ["WI-AL0.4", "WI-AL0.6 (diff budgets only)"],
    recommendation: { library: "diff-match-patch" },
    deadlineSelfTest: STABLE,
    environment: { cores: 10 },
    libraries: {
      jsdiff: fuzzed({ package: "diff", verdict: { admissibleViaWorkerTermination: true }, fixtures: { pass: 40, total: 41 } }),
      dmp: fuzzed({ package: "diff-match-patch", verdict: { admissibleViaWorkerTermination: true, admissibleViaNativeBudget: false }, fixtures: { pass: 41, total: 41 }, perf: WORKER_PERF }),
    },
  },
  backend: {
    workItems: ["WI-AL0.5"],
    recommendation: { backend: "JSONL (packed blob layout)", arm: "jsonlPacked" },
    admissibility: { jsonlLoose: { admissible: true }, jsonlPacked: { admissible: true } },
    crashInjection: { cases: CRASH_CASES, total: CRASH_CASES.length, failed: 0, failures: [] },
  },
  txn: {
    workItems: ["WI-AL0.1", "WI-AL0.2", "WI-AL0.8 (writer half)"],
    schemaVersion: 2,
    gates: { testExit: 0, clippyExit: 0, measureExit: 0 },
    tests: { byArea: TXN_BY_AREA, total: TXN_TOTAL },
    mutationChecks: { killed: 7, survived: 0, mutants: mutantRows(7) },
    measurements: { captureLatency: TXN_LATENCY },
  },
  anchor: {
    workItem: "WI-AL0.9",
    totals: { fixtures: 45, exact: 36, widened: 9, failed: 0 },
    blockProvenance: {
      totals: { cases: 4, pass: 4 },
      parts: {
        constructs: { cases: [{ pass: true }] },
        serialization: { cases: [{ pass: true }] },
        widen: { cases: [{ pass: true }] },
        history: { cases: [{ pass: true }] },
        lifecycle: { cases: [{ pass: true }] },
        attach: { cases: [{ pass: true }] },
        rebuild: { cases: [{ pass: true }] },
        perf: { cases: [{ pass: true }], oneMiB: { observeUs: { n: 100, p50: 20, p95: 35, max: 40 } } },
        mutants: { total: 17, killed: 9, unexplainedSurvivors: 0, mutants: mutantRows(9, 8) },
      },
    },
  },
  review: {
    workItems: ["WI-AL0.4 (source provenance over CodeMirror)", "WI-AL0.8 (review half)", "WI-AL0.6 (observation, capture, provenance and journal bytes, review panel)"],
    status: "pass",
    totals: { passed: 3 * REVIEW_PROBES.length, failed: 0, skipped: 0 },
    testsPerArea: Object.fromEntries(REVIEW_PROBES.map((f) => [f, PROBE_ROW])),
    measurements: {
      sourceProvenance: { sessions: 400, transactions: 19192, spansChecked: 65562, kinds: { type: 9, undo: 3, redo: 2, compose: 4, netZero: 1 } },
      budgets: {
        cap: 16384,
        session: { observeCpuMs: { n: 1845, p95: 0.006 }, captureCpuMs: { n: 100, p95: 0.051 } },
        nearCap: { peakEntries: 15605, observeCpuMs: { n: 6667, p95: 0.089 }, observeCpuMsNearCap: { n: 756, p95: 0.102 }, captureCpuMs: { n: 20, p95: 0.055 } },
      },
      barriers: { capOverflow: { cap: 16384, ops: 16384, payloadBytes: 499 }, underCap: { ops: 4096, payloadBytes: 117744 } },
      ambiguousRevert: {
        ledgerOracleFuzz: { byShapeAndMode: { "ab8/minimal": SOUND, "ab8/mixed": SOUND } },
        regressions: {
          "aZb-delete-b": { status: "applied", text: "aZ", expected: "aZ", ambiguous: 0, wrong: 0, spanMismatch: 0, requiredMissed: 0 },
          "aZb-snapshot-only": { status: "ambiguous", text: "a", expected: "a", ambiguous: 1, wrong: 0, spanMismatch: 0, requiredMissed: 0 },
        },
      },
    },
  },
};
const AREAS = Object.keys(PASSING);

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const put = (root, rel, body) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

/** Every declared input of `spike` that is not there yet: a file for a dotted basename, else a folder with one source. */
function writeInputs(root, spike) {
  for (const rel of SPIKE_INPUTS[spike].inputs) {
    if (path.basename(rel).includes(".")) put(root, rel, `${rel}\n`);
    else put(root, `${rel}/probe.mjs`, "// probe\n");
  }
}

/**
 * A fixture root holding one area: its inputs, and a results.json stamped
 * `generatedAt` and fingerprinted from those inputs with the real module.
 */
function spikeRoot(spike, { doc, raw, source = true, fingerprint = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "al-spike-"));
  made.push(root);
  mkdirSync(path.join(root, GRILLS, spike), { recursive: true });
  if (source) writeInputs(root, spike);
  if (source && spike === "txn") for (const a of TXN_PROV_AREAS) put(root, `${GRILLS}/txn/tests/${a}.rs`, `// ${a}\n`);
  if (source && spike === "review") for (const f of REVIEW_PROBES) put(root, `${GRILLS}/review/probes/${f}`, `// ${f}\n`);
  if (raw !== undefined) put(root, `${GRILLS}/${spike}/results.json`, raw);
  else if (doc !== null) {
    const base = doc ?? { ...PASSING[spike], generatedAt: iso(NOW - 60_000) };
    const stamped = fingerprint && source ? { ...base, fingerprint: spikeFingerprint(root, spike) } : base;
    put(root, `${GRILLS}/${spike}/results.json`, JSON.stringify(stamped));
  }
  return root;
}

function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: REPO, timeout: 30_000 });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const check = (root, spike) => run(`--root=${root}`, spike);

describe("check-al-spike-results — green", () => {
  it.each(AREAS)("%s: a fingerprinted passing artifact exits 0 and names the work item", (spike) => {
    const r = check(spikeRoot(spike), spike);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(SPIKES[spike].workItem);
  });

  it("a touched source with unchanged content is still fresh (content, not mtime)", () => {
    const root = spikeRoot("revert");
    const later = new Date(NOW + 60_000);
    utimesSync(path.join(root, GRILLS, "revert", "probe.mjs"), later, later);
    expect(check(root, "revert").status).toBe(0);
  });

  it.each([
    ["backend", "backend/node_modules/late.txt"],
    ["backend", "backend/target/release/late.bin"],
    ["backend", "backend/.DS_Store"],
    ["review", "review/out/budgets.json"],
  ])("%s: a build output written after the run (%s) is not an input", (spike, rel) => {
    const root = spikeRoot(spike);
    put(root, `${GRILLS}/${rel}`, "written after the run\n");
    expect(check(root, spike).status).toBe(0);
  });

  it("a CJK-named source is fingerprinted and named when it changes", () => {
    const root = spikeRoot("revert", { doc: null });
    put(root, `${GRILLS}/revert/探针.mjs`, "// 一\n");
    put(root, `${GRILLS}/revert/results.json`, JSON.stringify({ ...PASSING.revert, generatedAt: iso(NOW - 60_000), fingerprint: spikeFingerprint(root, "revert") }));
    expect(check(root, "revert").status).toBe(0);
    put(root, `${GRILLS}/revert/探针.mjs`, "// 二\n");
    const r = check(root, "revert");
    expect(r.status).toBe(1);
    expect(r.out).toContain("探针.mjs");
  });
});

describe("check-al-spike-results — stale inputs are named", () => {
  it.each([
    ["an edited probe source", "revert", "revert/probe.mjs", "edit"],
    ["an added probe source", "revert", "revert/lib/new.mjs", "add"],
    ["a removed input file", "review", "revert/lib/probe.mjs", "remove"],
    ["the spike's own lockfile", "revert", "revert/pnpm-lock.yaml", "edit"],
    ["the spike's own Cargo.lock", "backend", "backend/Cargo.lock", "edit"],
    ["the shared crash-case manifest crash.rs compiles in", "backend", "../../../scripts/lib/alSpikeBackendCrashCases.json", "edit"],
    ["the repo lockfile, for a probe resolved from the root", "anchor", "../../../pnpm-lock.yaml", "edit"],
    ["the repo package.json, for review", "review", "../../../package.json", "edit"],
    ["revert/lib, which the review probes import", "review", "revert/lib/probe.mjs", "edit"],
    ["golden/, which the txn tests read", "txn", "golden/probe.mjs", "edit"],
    ["golden/provenance.md, which the anchor probe reads", "anchor", "golden/provenance.md", "edit"],
  ])("STALE: %s", (_name, spike, rel, how) => {
    const root = spikeRoot(spike);
    const file = path.join(root, GRILLS, rel);
    if (how === "remove") rmSync(file);
    else put(root, path.relative(root, file), "// changed after the run\n");
    const r = check(root, spike);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/stale/);
    expect(r.out).toContain(path.basename(rel));
  });
});

describe("check-al-spike-results — production code a probe imports is an input", () => {
  /** `spike` with a probe that imports src/a.ts, which imports src/b.ts; src/unrelated.ts is imported by nothing. */
  function importingRoot(spike) {
    const root = spikeRoot(spike, { doc: null });
    put(root, `${GRILLS}/${spike}/imports.probe.ts`, 'import { b } from "@/a";\n');
    put(root, "src/a.ts", 'export { b } from "./b";\n');
    put(root, "src/b.ts", "export const b = 1;\n");
    put(root, "src/unrelated.ts", "export const u = 1;\n");
    put(root, `${GRILLS}/${spike}/results.json`, JSON.stringify({ ...PASSING[spike], generatedAt: iso(NOW - 60_000), fingerprint: spikeFingerprint(root, spike) }));
    return root;
  }

  it.each(["anchor", "review"])("%s: the fingerprint lists the src/ files reached through imports, and only those", (spike) => {
    const files = Object.keys(spikeFingerprint(importingRoot(spike), spike).files);
    expect(files).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]));
    expect(files).not.toContain("src/unrelated.ts");
  });

  it.each(["anchor", "review"])("%s: STALE when a src/ file reached transitively changes", (spike) => {
    const root = importingRoot(spike);
    put(root, "src/b.ts", "export const b = 2;\n");
    const r = check(root, spike);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/stale.*changed src\/b\.ts/);
  });

  it.each(["anchor", "review"])("%s: still fresh when an unrelated src/ file changes", (spike) => {
    const root = importingRoot(spike);
    put(root, "src/unrelated.ts", "export const u = 2;\n");
    const r = check(root, spike);
    expect(r.status, r.out).toBe(0);
  });

  it("STALE when a probe newly imports another src/ file", () => {
    const root = importingRoot("anchor");
    put(root, "src/a.ts", 'export { b } from "./b";\nexport { u } from "./unrelated";\n');
    const r = check(root, "anchor");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/added src\/unrelated\.ts/);
  });

  it("an import that no longer resolves is red, naming it", () => {
    const root = importingRoot("review");
    rmSync(path.join(root, "src/b.ts"));
    const r = check(root, "review");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/cannot fingerprint inputs: cannot resolve "\.\/b" imported by src\/a\.ts/);
  });
});

describe("check-al-spike-results — every defect is red, with a reason", () => {
  it("missing results.json names the path", () => {
    const r = check(spikeRoot("txn", { doc: null }), "txn");
    expect(r.status).toBe(1);
    expect(r.out).toContain(`${GRILLS}/txn/results.json`);
    expect(r.out).toMatch(/missing/);
  });

  it("a results.json that exists but cannot be read is unreadable, not missing", () => {
    const root = spikeRoot("txn", { doc: null });
    mkdirSync(path.join(root, GRILLS, "txn", "results.json"));
    const r = check(root, "txn");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/cannot read .*txn\/results\.json: EISDIR/);
    expect(r.out).not.toMatch(/missing/);
  });

  it("a missing spike folder is missing, not a crash", () => {
    const root = mkdtempSync(path.join(tmpdir(), "al-spike-"));
    made.push(root);
    const r = check(root, "anchor");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/missing/);
  });

  it.each([
    ["unparseable JSON", "{ not json", /not valid JSON/],
    ["an empty file", "", /not valid JSON/],
    ["a JSON array", "[]", /not a JSON object/],
  ])("%s", (_name, raw, reason) => {
    const r = check(spikeRoot("anchor", { raw }), "anchor");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(reason);
  });

  it("an artifact that names another work item (a copied file)", () => {
    const doc = { ...PASSING.anchor, workItem: "WI-AL0.4", generatedAt: iso(NOW - 60_000) };
    const r = check(spikeRoot("anchor", { doc }), "anchor");
    expect(r.status).toBe(1);
    expect(r.out).toContain("WI-AL0.9");
  });

  it("a work-item prefix is not the work item (WI-AL0.40 is not WI-AL0.4)", () => {
    const doc = { ...PASSING.revert, workItems: ["WI-AL0.40"], generatedAt: iso(NOW - 60_000) };
    expect(check(spikeRoot("revert", { doc }), "revert").status).toBe(1);
  });

  it.each([
    ["absent", undefined],
    ["not a string", 1729500000],
    ["not a timestamp", "yesterday"],
    ["a date without a time", "2026-10-21"],
  ])("generatedAt %s", (_name, generatedAt) => {
    const r = check(spikeRoot("anchor", { doc: { ...PASSING.anchor, generatedAt } }), "anchor");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/generatedAt/);
  });

  it("generatedAt in the future is refused", () => {
    const r = check(spikeRoot("anchor", { doc: { ...PASSING.anchor, generatedAt: iso(NOW + 3_600_000) } }), "anchor");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/future/);
  });

  it("an artifact without a fingerprint (written before fingerprinting) is refused", () => {
    const r = check(spikeRoot("review", { fingerprint: false }), "review");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/fingerprint/);
  });

  it("a declared dependency input that is missing fails loud, naming it", () => {
    const root = spikeRoot("anchor");
    rmSync(path.join(root, "pnpm-lock.yaml"));
    const r = check(root, "anchor");
    expect(r.status).toBe(1);
    expect(r.out).toContain("pnpm-lock.yaml");
  });

  it("a folder holding only results.json has no runnable probe", () => {
    const r = check(spikeRoot("revert", { source: false }), "revert");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no probe sources|missing/);
  });
});

describe("checkSpikeResult — freshness is the fingerprint", () => {
  const files = { [`${GRILLS_DIR}/revert/run.mjs`]: "a".repeat(64), [`${GRILLS_DIR}/revert/package.json`]: "b".repeat(64) };
  const current = { algorithm: "sha256", digest: "c".repeat(64), files };
  const doc = (fingerprint) => ({ ...PASSING.revert, generatedAt: iso(NOW - 60_000), fingerprint });
  const problems = (fingerprint, cur = current) => checkSpikeResult("revert", doc(fingerprint), { current: cur, nowMs: NOW }).problems;

  it("the recomputed digest matching the recorded one is fresh", () => {
    expect(problems(current)).toEqual([]);
  });
  it.each([
    ["absent", undefined],
    ["not an object", "c".repeat(64)],
    ["a digest that is not sha256 hex", { ...current, digest: "abc" }],
    ["another algorithm", { ...current, algorithm: "md5" }],
    ["no files map", { algorithm: "sha256", digest: "c".repeat(64) }],
  ])("a fingerprint that is %s is refused", (_name, fp) => {
    expect(problems(fp).join("; ")).toMatch(/fingerprint/);
  });
  it("a different digest is stale and names the changed file", () => {
    const changed = { ...current, digest: "d".repeat(64), files: { ...files, [`${GRILLS_DIR}/revert/run.mjs`]: "e".repeat(64) } };
    const p = problems(current, changed).join("; ");
    expect(p).toMatch(/stale/);
    expect(p).toContain("revert/run.mjs");
  });
  it("an input that could not be read is reported, not thrown", () => {
    expect(problems(current, { error: "input pnpm-lock.yaml is missing" }).join("; ")).toContain("pnpm-lock.yaml");
  });
  it("a spike folder holding only a manifest and a lockfile has no probe source", () => {
    const own = { [`${GRILLS_DIR}/revert/package.json`]: "a".repeat(64), [`${GRILLS_DIR}/revert/pnpm-lock.yaml`]: "b".repeat(64), [`${GRILLS_DIR}/revert/notes.md`]: "c".repeat(64) };
    const manifestOnly = { algorithm: "sha256", digest: "d".repeat(64), files: own };
    expect(problems(manifestOnly, manifestOnly).join("; ")).toMatch(/no probe sources/);
  });
  it.each(["probe.mjs", "src/lib.rs", "probes/p.probe.tsx"])("a spike folder holding %s has a probe source", (file) => {
    const fp = { algorithm: "sha256", digest: "d".repeat(64), files: { [`${GRILLS_DIR}/revert/${file}`]: "a".repeat(64) } };
    expect(problems(fp, fp)).toEqual([]);
  });
  it.each(["types.d.ts", "lib/api.d.mts", "x.d.cts", "probes/p.d.tsx"])("a spike folder holding only the declaration file %s has no probe source", (file) => {
    const fp = { algorithm: "sha256", digest: "d".repeat(64), files: { [`${GRILLS_DIR}/revert/${file}`]: "a".repeat(64) } };
    expect(problems(fp, fp).join("; ")).toMatch(/no probe sources/);
  });
  it("no source of the spike's own among the inputs is refused", () => {
    const foreign = { algorithm: "sha256", digest: "c".repeat(64), files: { "pnpm-lock.yaml": "a".repeat(64) } };
    expect(problems(foreign, foreign).join("; ")).toMatch(/no probe sources/);
  });
});

describe("alSpikeFingerprint — the one implementation the checker and the generators share", () => {
  it("is deterministic, and covers exactly the declared inputs minus outputs", () => {
    const root = spikeRoot("review");
    put(root, `${GRILLS}/review/out/x.json`, "{}\n");
    const a = spikeFingerprint(root, "review");
    const b = spikeFingerprint(root, "review");
    expect(a).toEqual(b);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(a.files)).toContain(`${GRILLS}/revert/lib/probe.mjs`);
    expect(Object.keys(a.files)).toContain("pnpm-lock.yaml");
    expect(Object.keys(a.files).some((f) => f.includes("/out/") || f.endsWith("review/results.json"))).toBe(false);
  });
  it("diffFingerprints names changed, added and removed files", () => {
    expect(diffFingerprints({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" })).toEqual({ changed: ["b"], added: ["d"], removed: ["c"] });
  });
  it("an unknown area throws", () => {
    expect(() => spikeFingerprint(REPO, "golden")).toThrow(/unknown/);
  });
  it("the CLI prints the same fingerprint a generator would embed", () => {
    const root = spikeRoot("txn");
    const r = spawnSync(process.execPath, [FP_CLI, `--root=${root}`, "txn"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(spikeFingerprint(root, "txn"));
  });
  it("the CLI exits 64 on an unknown area", () => {
    expect(spawnSync(process.execPath, [FP_CLI, "golden"], { encoding: "utf8" }).status).toBe(64);
  });
});

describe("checkSpikeResult — the verdict each area must carry", () => {
  const verdict = (spike, patch) => {
    const doc = { ...PASSING[spike], generatedAt: iso(NOW - 60_000), ...patch };
    const current = { algorithm: "sha256", digest: "c".repeat(64), files: { [`${GRILLS_DIR}/${spike}/probe.mjs`]: "a".repeat(64) } };
    return checkSpikeResult(spike, { ...doc, fingerprint: current }, { current, nowMs: NOW, txnProvenanceAreas: TXN_PROV_AREAS, reviewProbes: REVIEW_PROBES });
  };
  const txnAreas = (byArea) => ({ tests: { byArea, total: Object.values(byArea).reduce((t, a) => ({ run: t.run + a.run, passed: t.passed + a.passed }), { run: 0, passed: 0 }) } });
  const without = (...names) => txnAreas(Object.fromEntries(Object.entries(TXN_BY_AREA).filter(([k]) => !names.includes(k))));
  const lat = (...rows) => ({ measurements: { captureLatency: rows } });
  const dmpPerf = (perf) => ({ libraries: { ...PASSING.revert.libraries, dmp: { ...PASSING.revert.libraries.dmp, perf: { ...WORKER_PERF, ...perf } } } });
  const m = PASSING.review.measurements;
  const review = (part) => ({ measurements: { ...m, ...part } });
  const budgets = (patch) => review({ budgets: { ...m.budgets, ...patch } });
  const oracle = (tally) => review({ ambiguousRevert: { ...m.ambiguousRevert, ledgerOracleFuzz: { byShapeAndMode: { "ab8/minimal": SOUND, "ab8/mixed": { ...SOUND, ...tally } } } } });
  const regs = m.ambiguousRevert.regressions;
  const regression = (id, patch) => review({ ambiguousRevert: { ...m.ambiguousRevert, regressions: { ...regs, [id]: { ...regs[id], ...patch } } } });
  const libFuzz = (where, tally) => {
    const lib = PASSING.revert.libraries.jsdiff;
    const mode = (k) => (where === k ? { summary: { ...SOUND, ...tally } } : lib.revertOracleFuzz[k]);
    const patched = where === "sweep"
      ? { ...lib, revertSeedSweep: { summary: { ...SOUND, ...tally } } }
      : { ...lib, revertOracleFuzz: { minimal: mode("minimal"), mixed: mode("mixed") } };
    return { libraries: { ...PASSING.revert.libraries, jsdiff: patched } };
  };
  const bp = (parts, totals = PASSING.anchor.blockProvenance.totals) => ({
    blockProvenance: { totals, parts: { ...PASSING.anchor.blockProvenance.parts, ...parts } },
  });

  it.each(AREAS)("%s: the passing shape has no problems", (spike) => {
    expect(verdict(spike, {}).problems).toEqual([]);
  });

  it.each([
    ["review: observation p95 exactly 2 ms", budgets({ session: { ...m.budgets.session, observeCpuMs: { n: 20, p95: 2 } } })],
    ["review: capture p95 exactly 10 ms", budgets({ nearCap: { ...m.budgets.nearCap, captureCpuMs: { n: 20, p95: 10 } } })],
    ["review: peak entries exactly at the cap", budgets({ nearCap: { ...m.budgets.nearCap, peakEntries: 16384 } })],
    ["review: a refused regression that left part of the edit in place", regression("aZb-snapshot-only", { text: "aZ" })],
  ])("boundary passes — %s", (_name, patch) => {
    expect(verdict("review", patch).problems).toEqual([]);
  });

  it.each([
    ["txn: each durable append exactly 25 ms p95", "txn", lat(latency("observe", 25), latency("linearize", 25))],
    ["txn: two appends together over 25 ms (each is judged alone)", "txn", lat(latency("observe", 20), latency("linearize", 20), latency("observe+linearize", 40))],
    ["txn: more live spans than the ceiling", "txn", lat(latency("observe", 19, { liveSpans: 700 }), latency("linearize", 9, { liveSpans: 700 }))],
    ["revert: worker p95 and max exactly at the 200 ms deadline", "revert", dmpPerf({ workerTerminationPathological: { wall: wall(200, 200), modes: { coarse: 20 } } })],
    ["revert: admissibility booleans false, numbers in budget (numbers decide)", "revert", {
      libraries: { ...PASSING.revert.libraries, dmp: { ...PASSING.revert.libraries.dmp, verdict: { admissibleViaWorkerTermination: false, admissibleViaNativeBudget: false } } },
    }],
    ["revert: worker termination too slow, native budget in time", "revert", dmpPerf({
      workerTerminationPathological: { wall: wall(250, 260), modes: { coarse: 20 } },
      nativeBudgetPathological: { wall: { ...wall(150, 160), n: 8 }, modes: { "coarse-native": 3, exact: 5 } },
    })],
  ])("boundary passes — %s", (_name, spike, patch) => {
    expect(verdict(spike, patch).problems).toEqual([]);
  });

  // Codex's in-memory checks: failed budgets and missing parity areas must not pass.
  it("txn: every capture p95 99,999 ms and both golden parity areas removed is refused, naming each", () => {
    const doc = structuredClone({ ...PASSING.txn, ...without("provenance_writer_golden", "provenance_review_golden") });
    for (const row of doc.measurements.captureLatency) row.p95Ms = 99_999;
    const problems = txnVerdict(doc, { provenanceAreas: TXN_PROV_AREAS });
    expect(problems.join("\n")).toMatch(/provenance_writer_golden/);
    expect(problems.join("\n")).toMatch(/provenance_review_golden/);
    expect(problems.join("\n")).toMatch(/observe p95 99999 ms exceeds 25 ms/);
    expect(problems.join("\n")).toMatch(/linearize p95 99999 ms exceeds 25 ms/);
  });
  it("revert: every library's pathological worker p95/max 99,999 ms is refused", () => {
    const doc = structuredClone(PASSING.revert);
    for (const l of Object.values(doc.libraries)) {
      l.perf = structuredClone(WORKER_PERF);
      l.perf.workerTerminationPathological.wall = { n: 20, p50: 99_999, p95: 99_999, max: 99_999 };
    }
    expect(revertVerdict(doc).join("\n")).toMatch(/99999 ms exceeds the 200 ms deadline/);
  });
  it("txn: the required areas are every tests/provenance*.rs, so a new one is required at once", () => {
    const root = spikeRoot("txn");
    put(root, `${GRILLS}/txn/tests/provenance_new.rs`, "// new\n");
    put(root, `${GRILLS}/txn/tests/races.rs`, "// not provenance\n");
    put(root, `${GRILLS}/txn/tests/common/provenance_helpers.rs`, "// not a test target\n");
    expect(txnProvenanceAreas(root)).toEqual([...TXN_PROV_AREAS, "provenance_new"].sort());
    expect(txnVerdict(PASSING.txn, { provenanceAreas: txnProvenanceAreas(root) })).toEqual([
      'no "provenance_new" test area — tests/provenance_new.rs did not run',
    ]);
  });
  it("review: the required probes are every review/probes/**/*.probe.ts[x], so a new one is required at once", () => {
    const root = spikeRoot("review");
    put(root, `${GRILLS}/review/probes/newThing.probe.ts`, "// new\n");
    put(root, `${GRILLS}/review/probes/fixtures.ts`, "// a helper, not a probe\n");
    put(root, `${GRILLS}/review/probes/nested/deep.probe.tsx`, "// the runner includes probes/**, and reports by basename\n");
    expect(reviewProbeFiles(root)).toEqual([...REVIEW_PROBES, "deep.probe.tsx", "newThing.probe.ts"].sort());
    expect(reviewVerdict(PASSING.review, { reviewProbes: reviewProbeFiles(root) })).toEqual(["deep.probe.tsx did not run and pass", "newThing.probe.ts did not run and pass"]);
  });
  it("review: two probes with one basename in different folders are refused, never merged into one row", () => {
    const root = spikeRoot("review");
    put(root, `${GRILLS}/review/probes/a/same.probe.ts`, "// one\n");
    put(root, `${GRILLS}/review/probes/b/same.probe.ts`, "// two\n");
    const found = reviewProbeFiles(root);
    expect(found.filter((f) => f === "same.probe.ts")).toHaveLength(2);
    const rows = { ...PASSING.review.testsPerArea, "same.probe.ts": PROBE_ROW };
    const totals = { ...PASSING.review.totals, passed: PASSING.review.totals.passed + PROBE_ROW.passed };
    expect(reviewVerdict({ ...PASSING.review, totals, testsPerArea: rows }, { reviewProbes: found })).toEqual([
      'same.probe.ts names 2 probes under review/probes — the reporter keys rows by basename, so rename all but one',
    ]);
  });
  it("review: no probes folder to derive the required probes from is refused, never skipped", () => {
    const root = mkdtempSync(path.join(tmpdir(), "al-spike-"));
    made.push(root);
    expect(reviewProbeFiles(root)).toEqual([]);
    expect(reviewVerdict(PASSING.review, { reviewProbes: [] }).join()).toMatch(/no review\/probes\/\*\.probe\.ts/);
    expect(reviewVerdict(PASSING.review).join()).toMatch(/no review\/probes\/\*\.probe\.ts/);
  });
  it("txn: no tests folder to derive the required areas from is refused, never skipped", () => {
    const root = mkdtempSync(path.join(tmpdir(), "al-spike-"));
    made.push(root);
    expect(txnProvenanceAreas(root)).toEqual([]);
    expect(txnVerdict(PASSING.txn, { provenanceAreas: [] }).join()).toMatch(/no tests\/provenance\*\.rs/);
    expect(txnVerdict(PASSING.txn).join()).toMatch(/no tests\/provenance\*\.rs/);
  });

  it.each([
    ["revert: no recommendation", "revert", { recommendation: {} }],
    ["revert: recommended library not measured", "revert", { recommendation: { library: "fast-diff" } }],
    ["revert: recommended library fails a fixture", "revert", {
      libraries: { dmp: fuzzed({ package: "diff-match-patch", verdict: { admissibleViaWorkerTermination: true }, fixtures: { pass: 40, total: 41 } }) },
    }],
    ["revert: recommended library inadmissible", "revert", {
      libraries: { dmp: fuzzed({ package: "diff-match-patch", verdict: { admissibleViaWorkerTermination: false, admissibleViaNativeBudget: false }, fixtures: { pass: 41, total: 41 } }) },
    }],
    ["revert: zero fixtures is not a pass", "revert", {
      libraries: { dmp: fuzzed({ package: "diff-match-patch", verdict: { admissibleViaWorkerTermination: true }, fixtures: { pass: 0, total: 0 } }) },
    }],
    ["revert: a wrong successful revert in another library's mixed fuzz", "revert", libFuzz("mixed", { wrong: 1 })],
    ["revert: a span mismatch in the minimal fuzz", "revert", libFuzz("minimal", { spanMismatch: 1 })],
    ["revert: a required revert missed in the seed sweep", "revert", libFuzz("sweep", { requiredMissed: 2 })],
    ["revert: a snapshot-only twin applied", "revert", libFuzz("minimal", { snapshotApplied: 1 })],
    ["revert: no nontrivial success", "revert", libFuzz("mixed", { nontrivial: 0 })],
    ["revert: a counter not recorded", "revert", libFuzz("sweep", { wrong: undefined })],
    ["revert: no seed sweep", "revert", { libraries: { dmp: { ...PASSING.revert.libraries.dmp, revertSeedSweep: undefined } } }],
    ["revert: no oracle fuzz", "revert", { libraries: { dmp: { ...PASSING.revert.libraries.dmp, revertOracleFuzz: undefined } } }],
    ["backend: no backend decided", "backend", { recommendation: { backend: "" } }],
    ["backend: a crash case failed", "backend", { crashInjection: { ...PASSING.backend.crashInjection, cases: CRASH_CASES.map((c, i) => (i === 1 ? { ...c, pass: false } : c)) } }],
    ["backend: no crash cases", "backend", { crashInjection: { cases: [] } }],
    ["backend: no recommended arm", "backend", { recommendation: { backend: "JSONL (packed blob layout)" } }],
    ["backend: the recommended arm is inadmissible", "backend", { admissibility: { jsonlPacked: { admissible: false } } }],
    ["txn: schema version 1", "txn", { schemaVersion: 1 }],
    ["txn: no schema version", "txn", { schemaVersion: undefined }],
    ["txn: no provenance parity area (tests/provenance.rs)", "txn", without("provenance")],
    ["txn: no writer-golden parity area", "txn", without("provenance_writer_golden")],
    ["txn: no review-golden parity area", "txn", without("provenance_review_golden")],
    ["txn: no epochs area", "txn", without("provenance_epochs")],
    ["txn: no schema area", "txn", without("provenance_schema")],
    ["txn: no barriers area", "txn", without("provenance_barriers")],
    ["txn: provenance parity failing", "txn", txnAreas({ ...TXN_BY_AREA, provenance: { run: 4, passed: 3 } })],
    ["txn: a parity area that ran nothing", "txn", txnAreas({ ...TXN_BY_AREA, provenance_review_golden: { run: 0, passed: 0 } })],
    ["txn: observe p95 over 25 ms", "txn", lat(latency("observe", 25.01), latency("linearize", 9))],
    ["txn: linearize p95 over 25 ms", "txn", lat(latency("observe", 19), latency("linearize", 26))],
    ["txn: no observe measurement", "txn", lat(latency("linearize", 9))],
    ["txn: no linearize measurement (only the sum)", "txn", lat(latency("observe", 19), latency("observe+linearize", 24))],
    ["txn: latency measured without a provenance payload", "txn", lat(latency("observe", 19, { provenance: false }), latency("linearize", 9))],
    ["txn: latency measured with no live spans", "txn", lat(latency("observe", 19), latency("linearize", 9, { liveSpans: 0 }))],
    ["txn: latency measured without full sync", "txn", lat(latency("observe", 5, { sync: "none" }), latency("linearize", 3, { sync: "none" }))],
    ["txn: a p95 that is not a number", "txn", lat(latency("observe", "fast"), latency("linearize", 9))],
    ["txn: no latency measurements", "txn", { measurements: undefined }],
    ["txn: the measurement example exited non-zero", "txn", { gates: { testExit: 0, clippyExit: 0, measureExit: 101 } }],
    ["txn: no measurement exit recorded", "txn", { gates: { testExit: 0, clippyExit: 0 } }],
    ["revert: pathological worker max over 200 ms", "revert", dmpPerf({ workerTerminationPathological: { wall: wall(190, 200.01), modes: { coarse: 20 } } })],
    ["revert: pathological worker p95 over 200 ms", "revert", dmpPerf({ workerTerminationPathological: { wall: wall(250, 260), modes: { coarse: 20 } } })],
    ["revert: a pathological run was not cut short", "revert", dmpPerf({ workerTerminationPathological: { wall: wall(182, 183), modes: { coarse: 19, exact: 1 } } })],
    ["revert: a consecutive kill over the deadline", "revert", dmpPerf({ consecutiveTimeouts: { ...WORKER_PERF.consecutiveTimeouts, killWall: wall(183, 230) } })],
    ["revert: a call right after a kill over the deadline", "revert", dmpPerf({ consecutiveTimeouts: { ...WORKER_PERF.consecutiveTimeouts, afterKillWall: wall(150, 201) } })],
    ["revert: consecutive timeouts that did not each kill", "revert", dmpPerf({ consecutiveTimeouts: { ...WORKER_PERF.consecutiveTimeouts, respawns: 9 } })],
    ["revert: a realistic 1 MB worker diff over the deadline", "revert", dmpPerf({ workerDeadline1MB: { ...WORKER_PERF.workerDeadline1MB, edits600: { wall: wall(190, 240), modes: { exact: 20 } } } })],
    ["revert: a 40-edit worker run that was not exact", "revert", dmpPerf({ workerDeadline1MB: { ...WORKER_PERF.workerDeadline1MB, edits40: { ...WORKER_PERF.workerDeadline1MB.edits40, modes: { exact: 19, coarse: 1 } } } })],
    ["revert: 600-edit worker modes that do not account for every sample", "revert", dmpPerf({ workerDeadline1MB: { ...WORKER_PERF.workerDeadline1MB, edits600: { ...WORKER_PERF.workerDeadline1MB.edits600, modes: { exact: 10 } } } })],
    ["revert: a 40-edit worker run that found 39 hunks", "revert", dmpPerf({ workerDeadline1MB: { ...WORKER_PERF.workerDeadline1MB, edits40: { ...WORKER_PERF.workerDeadline1MB.edits40, maxHunkCount: 39 } } })],
    ["revert: a 600-edit worker run with no hunk count", "revert", dmpPerf({ workerDeadline1MB: { ...WORKER_PERF.workerDeadline1MB, edits600: { ...WORKER_PERF.workerDeadline1MB.edits600, maxHunkCount: undefined } } })],
    ["revert: a call after a kill that was not exact", "revert", dmpPerf({ consecutiveTimeouts: { ...WORKER_PERF.consecutiveTimeouts, afterKillModes: { exact: 9, coarse: 1 } } })],
    ["revert: native budget cut short, but its realistic case over the deadline", "revert", dmpPerf({
      workerTerminationPathological: { wall: wall(250, 260), modes: { coarse: 20 } },
      nativeBudgetPathological: { wall: { ...wall(150, 160), n: 8 }, modes: { "coarse-native": 3, exact: 5 } },
      nativeBudgetRealistic40: { ...WORKER_PERF.nativeBudgetRealistic40, wall: wall(150, 250) },
    })],
    ["revert: native budget cut short, but its realistic case not exact", "revert", dmpPerf({
      workerTerminationPathological: { wall: wall(250, 260), modes: { coarse: 20 } },
      nativeBudgetPathological: { wall: { ...wall(150, 160), n: 8 }, modes: { "coarse-native": 3, exact: 5 } },
      nativeBudgetRealistic40: { ...WORKER_PERF.nativeBudgetRealistic40, modes: { exact: 12, "coarse-native": 8 } },
    })],
    ["revert: a deadline stat that is not a number", "revert", dmpPerf({ workerTerminationPathological: { wall: { n: 20, p95: "fast", max: 1 }, modes: { coarse: 20 } } })],
    ["revert: an empty deadline stat", "revert", dmpPerf({ workerTerminationPathological: { wall: { n: 0, p95: 1, max: 1 }, modes: {} } })],
    ["revert: no deadline self-test stability record", "revert", { deadlineSelfTest: undefined }],
    ["revert: a deadline self-test run failed", "revert", { deadlineSelfTest: { ...STABLE, failedRuns: 1, failures: ["late stand-in read in time"] } }],
    ["revert: fewer than 30 sequential self-test runs", "revert", { deadlineSelfTest: { ...STABLE, sequentialRuns: 29 } }],
    ["revert: fewer than 10 loaded self-test runs", "revert", { deadlineSelfTest: { ...STABLE, loadedRuns: 9 } }],
    ["revert: self-test runs under load with no load", "revert", { deadlineSelfTest: { ...STABLE, loadWorkers: 0 } }],
    ["revert: self-test runs with no tests", "revert", { deadlineSelfTest: { ...STABLE, testsPerRun: 0 } }],
    ["revert: a failure listed under zero failed runs", "revert", { deadlineSelfTest: { ...STABLE, failures: ["x"] } }],
    ["revert: no perf for the recommended library", "revert", { libraries: { ...PASSING.revert.libraries, dmp: { ...PASSING.revert.libraries.dmp, perf: undefined } } }],
    ["txn: cargo test exited non-zero", "txn", { gates: { testExit: 101, clippyExit: 0 } }],
    ["txn: clippy exited non-zero", "txn", { gates: { testExit: 0, clippyExit: 1 } }],
    ["txn: no gates recorded", "txn", { gates: undefined }],
    ["txn: an area that ran nothing", "txn", { tests: { byArea: { races: { run: 0, passed: 0 }, provenance: { run: 4, passed: 4 } }, total: { run: 4, passed: 4 } } }],
    ["txn: total disagrees with the areas", "txn", { tests: { byArea: { races: { run: 5, passed: 5 }, provenance: { run: 4, passed: 4 } }, total: { run: 12, passed: 12 } } }],
    ["txn: a surviving mutant", "txn", { mutationChecks: { killed: 6, survived: 1 } }],
    ["txn: no mutation checks", "txn", { mutationChecks: undefined }],
    ["txn: a mutation run that generated no mutant", "txn", { mutationChecks: { survived: 0 } }],
    ["txn: a mutation run that killed nothing", "txn", { mutationChecks: { killed: 0, survived: 0 } }],
    ["txn: a mutant list that disagrees with the counts", "txn", { mutationChecks: { killed: 7, survived: 0, mutants: [{ killed: true }] } }],
    ["txn: a negative durable-append p95", "txn", lat(latency("observe", -1), latency("linearize", 9))],
    ["txn: a latency row with no runs", "txn", lat(latency("observe", 19, { runs: 0 }), latency("linearize", 9))],
    ["txn: a latency row whose p50 exceeds its p95", "txn", lat(latency("observe", 19, { p50Ms: 20 }), latency("linearize", 9))],
    ["revert: a negative deadline timing", "revert", dmpPerf({ workerDeadline1MB: { ...WORKER_PERF.workerDeadline1MB, edits40: { wall: { n: 20, p50: -3, p95: -2, max: -1 } } } })],
    ["revert: a deadline p95 above its max", "revert", dmpPerf({ workerDeadline1MB: { ...WORKER_PERF.workerDeadline1MB, edits40: { wall: { n: 20, p50: 10, p95: 30, max: 20 } } } })],
    ["revert: a self-test record of another suite", "revert", { deadlineSelfTest: { ...STABLE, suite: "test/other.probe.mjs" } }],
    ["revert: fewer busy loops than cores", "revert", { deadlineSelfTest: { ...STABLE, loadWorkers: 1 } }],
    ["revert: no core count to judge the load by", "revert", { environment: undefined }],
    ["review: a p95 over zero samples", "review", budgets({ session: { ...m.budgets.session, observeCpuMs: { n: 0, p95: 0.006 } } })],
    ["review: a p95 with no sample count", "review", budgets({ session: { ...m.budgets.session, captureCpuMs: { p95: 0.051 } } })],
    ["review: a negative p95", "review", budgets({ nearCap: { ...m.budgets.nearCap, captureCpuMs: { n: 20, p95: -0.1 } } })],
    ["anchor: a fixture failed", "anchor", { totals: { fixtures: 45, exact: 36, widened: 8, failed: 1 } }],
    ["anchor: counts do not add up", "anchor", { totals: { fixtures: 45, exact: 30, widened: 9, failed: 0 } }],
    ["anchor: zero fixtures", "anchor", { totals: { fixtures: 0, exact: 0, widened: 0, failed: 0 } }],
    ["anchor: no block-provenance section", "anchor", { blockProvenance: undefined }],
    ["anchor: a block-provenance case failed", "anchor", bp({}, { cases: 4, pass: 3 })],
    ["anchor: a block-provenance part is missing", "anchor", bp({ widen: undefined })],
    ["anchor: the doc-identity history part (Codex r9 C2) is missing", "anchor", bp({ history: undefined })],
    ["anchor: the observation-continuity lifecycle part (Codex r10 C3) is missing", "anchor", bp({ lifecycle: undefined })],
    ["anchor: a lifecycle case failed", "anchor", bp({ lifecycle: { cases: [{ pass: false }] } })],
    ["anchor: the first-attachment part (Codex r12 C3d) is missing", "anchor", bp({ attach: undefined })],
    ["anchor: a first-attachment case failed", "anchor", bp({ attach: { cases: [{ pass: false }] } })],
    ["anchor: the plugin-view rebuild part (Codex r13 C3e) is missing", "anchor", bp({ rebuild: undefined })],
    ["anchor: a plugin-view rebuild case failed", "anchor", bp({ rebuild: { cases: [{ pass: false }] } })],
    ["anchor: observation p95 over 2 ms", "anchor", bp({ perf: { cases: [{ pass: true }], oneMiB: { observeUs: { n: 100, p95: 2001 } } } })],
    ["anchor: a negative observation p95 with no sample count", "anchor", bp({ perf: { cases: [{ pass: true }], oneMiB: { observeUs: { p95: -1 } } } })],
    ["anchor: an observation p95 with no sample count", "anchor", bp({ perf: { cases: [{ pass: true }], oneMiB: { observeUs: { p95: 35 } } } })],
    ["anchor: an observation p95 above its max", "anchor", bp({ perf: { cases: [{ pass: true }], oneMiB: { observeUs: { n: 100, p95: 35, max: 30 } } } })],
    ["anchor: no 1 MiB observation p95", "anchor", bp({ perf: { cases: [{ pass: true }] } })],
    ["anchor: an unexplained surviving mutant", "anchor", bp({ mutants: { total: 17, killed: 8, unexplainedSurvivors: 1 } })],
    ["anchor: no mutation run", "anchor", bp({ mutants: undefined })],
    ["review: the run did not pass", "review", { status: "fail" }],
    ["review: a test failed", "review", { totals: { passed: 11, failed: 1, skipped: 0 } }],
    ["review: no tests ran", "review", { totals: { passed: 0, failed: 0, skipped: 0 } }],
    ["review: one probe file failed", "review", { testsPerArea: { ...PASSING.review.testsPerArea, "overlap.probe.ts": { passed: 5, failed: 1, skipped: 0 } } }],
    ["review: the source-provenance probe did not run", "review", { testsPerArea: { ...PASSING.review.testsPerArea, "sourceProvenance.probe.ts": undefined } }],
    ["review: the capture-session probe did not run", "review", { testsPerArea: { ...PASSING.review.testsPerArea, "captureSession.probe.ts": undefined } }],
    ["review: the stale-plan probe did not run", "review", { testsPerArea: { ...PASSING.review.testsPerArea, "stalePlan.probe.ts": undefined } }],
    ["review: the pins probe ran zero tests", "review", { testsPerArea: { ...PASSING.review.testsPerArea, "pins.probe.ts": { passed: 0, failed: 0, skipped: 3 } } }],
    ["review: a .tsx probe did not run", "review", { testsPerArea: { ...PASSING.review.testsPerArea, "panel.probe.tsx": undefined } }],
    ["review: the barriers probe ran zero tests", "review", { testsPerArea: { ...PASSING.review.testsPerArea, "barriers.probe.ts": { passed: 0, failed: 0, skipped: 2 } } }],
    ["review: source provenance observed no transaction", "review", review({ sourceProvenance: { ...m.sourceProvenance, transactions: 0 } })],
    ["review: source provenance checked no span", "review", review({ sourceProvenance: { ...m.sourceProvenance, spansChecked: 0 } })],
    ["review: no undo transaction covered (R18)", "review", review({ sourceProvenance: { ...m.sourceProvenance, kinds: { type: 1, redo: 1, compose: 1, netZero: 1 } } })],
    ["review: no IME composition covered (R18)", "review", review({ sourceProvenance: { ...m.sourceProvenance, kinds: { type: 1, undo: 1, redo: 1, netZero: 1 } } })],
    ["review: no net-zero edit covered (R19)", "review", review({ sourceProvenance: { ...m.sourceProvenance, kinds: { type: 1, undo: 1, redo: 1, compose: 1 } } })],
    ["review: no source-provenance measurement", "review", review({ sourceProvenance: undefined })],
    ["review: session observation p95 over 2 ms", "review", budgets({ session: { ...m.budgets.session, observeCpuMs: { p95: 2.001 } } })],
    ["review: near-cap observation p95 over 2 ms", "review", budgets({ nearCap: { ...m.budgets.nearCap, observeCpuMsNearCap: { p95: 3 } } })],
    ["review: capture p95 over 10 ms", "review", budgets({ session: { ...m.budgets.session, captureCpuMs: { p95: 10.5 } } })],
    ["review: a p95 that is not a number", "review", budgets({ session: { ...m.budgets.session, observeCpuMs: { p95: "fast" } } })],
    ["review: no budgets measurement", "review", review({ budgets: undefined })],
    ["review: no accumulator cap recorded", "review", budgets({ cap: undefined })],
    ["review: peak entries over the cap", "review", budgets({ nearCap: { ...m.budgets.nearCap, peakEntries: 16385 } })],
    ["review: the cap overflow was never exercised", "review", review({ barriers: { underCap: m.barriers.underCap } })],
    ["review: the overflow run stayed under the cap", "review", review({ barriers: { ...m.barriers, capOverflow: { cap: 16384, ops: 100 } } })],
    ["review: overflow measured against another cap", "review", review({ barriers: { ...m.barriers, capOverflow: { cap: 8, ops: 8 } } })],
    ["review: a wrong successful revert in the ledger oracle", "review", oracle({ wrong: 1 })],
    ["review: a span mismatch in the ledger oracle", "review", oracle({ spanMismatch: 1 })],
    ["review: a required revert missed", "review", oracle({ requiredMissed: 1 })],
    ["review: a snapshot-only twin applied", "review", oracle({ snapshotApplied: 1 })],
    ["review: no nontrivial success", "review", oracle({ nontrivial: 0 })],
    ["review: no oracle shapes", "review", review({ ambiguousRevert: { ...m.ambiguousRevert, ledgerOracleFuzz: { byShapeAndMode: {} } } })],
    ["review: an applied regression reverted to the wrong text", "review", regression("aZb-delete-b", { text: "Za" })],
    ["review: an applied regression refused a hunk", "review", regression("aZb-delete-b", { ambiguous: 1 })],
    ["review: a refused regression refused nothing", "review", regression("aZb-snapshot-only", { ambiguous: 0 })],
    ["review: a regression with a wrong revert", "review", regression("aZb-snapshot-only", { wrong: 1 })],
    ["review: a regression with a span mismatch", "review", regression("aZb-delete-b", { spanMismatch: 1 })],
    ["review: a regression that missed a required revert", "review", regression("aZb-delete-b", { requiredMissed: 1 })],
    ["review: a regression without its counters", "review", regression("aZb-delete-b", { wrong: undefined })],
    ["review: a regression with an unknown status", "review", regression("aZb-delete-b", { status: "maybe" })],
    ["review: no named regressions", "review", review({ ambiguousRevert: { ...m.ambiguousRevert, regressions: {} } })],
  ])("%s", (_name, spike, patch) => {
    expect(verdict(spike, patch).problems.length).toBeGreaterThan(0);
  });
});

describe("check-al-spike-results — invocation", () => {
  it("no area exits 64", () => {
    expect(run(`--root=${REPO}`).status).toBe(64);
  });
  it("an unknown area exits 64", () => {
    const r = run(`--root=${REPO}`, "golden");
    expect(r.status).toBe(64);
    expect(r.out).toMatch(/unknown spike/);
  });
  it("two areas exit 64", () => {
    expect(run(`--root=${REPO}`, "txn", "anchor").status).toBe(64);
  });
  it("an unknown option exits 64", () => {
    expect(run("--rooot=/tmp", "txn").status).toBe(64);
  });
  it("a --root that is not a directory exits 64", () => {
    expect(run(`--root=${path.join(tmpdir(), "al-not-here-7c1e")}`, "txn").status).toBe(64);
  });
});
