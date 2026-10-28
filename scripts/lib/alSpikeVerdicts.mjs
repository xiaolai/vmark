/**
 * Purpose: the verdict each agent-edit-ledger spike artifact must carry for
 * phase 0 to close — one pure function per area, each returning every problem
 * it finds (an empty list is a pass). Budgets are fixed here, never read from
 * the artifact, so a probe cannot pass by recording a looser limit.
 *
 *   revert   a diff library is recommended, passes every adversarial fixture
 *            and meets 200 ms by its NUMBERS, not the probe's booleans: every
 *            worker timing p95/max ≤ 200 ms with each pathological run killed
 *            and every normal run (40 and 600 edits, the call after a kill)
 *            exact, every mode tally accounting for exactly its samples
 *            (one kill and one follow-up sample per timeout), and the 40/600
 *            hunks found by EVERY run (its fewest, `minHunkCount`); or the
 *            native budget in time on both the pathological and the realistic
 *            case, the realistic runs exact and each still finding 40 hunks;
 *            EVERY
 *            library, in every history mode (minimal, mixed, seed sweep), has
 *            zero wrong successful reverts, span mismatches, missed required
 *            reverts and applied snapshot-only twins, with nontrivial successes
 *            (R24); the deadline check passed 30 runs alone, 10 under one busy
 *            loop per recorded core (M3).
 *   backend  a backend is decided, every crash-injection case of the
 *            shared crash matrix recovered by its evidence, and the
 *            recommended arm is a measured, admissible JSONL arm whose own
 *            cases all passed (see scripts/lib/alSpikeBackendVerdict.mjs).
 *   txn      schema version 2 (R23); test, clippy and measure exited 0; every
 *            area passed, including one per tests/provenance*.rs (the caller
 *            lists the folder; an empty list refuses); the total is the sum
 *            of the areas; a mutation run that generated mutants, killed
 *            every one, and whose required mutant list matches its counts;
 *            observe and linearize, EACH alone, p95 ≤ 25 ms (full sync,
 *            provenance, ≥ 600 live spans).
 *   anchor   selection-anchor fixtures, plus bounded WYSIWYG block
 *            provenance (R20) within the 2 ms observation p95 (a full
 *            timing record, through `timingStat`), and a listed mutation run
 *            whose every survivor states its equivalence.
 *   review   see scripts/lib/alSpikeReviewVerdict.mjs.
 *
 * Every recorded timing goes through ONE validator (alSpikeVerdictParts.mjs
 * `timingStat`): a positive sample count, non-negative ordered quantiles.
 *
 * @coordinates-with scripts/check-al-spike-results.mjs — the checker that applies these
 * @coordinates-with scripts/check-al-spike-results.test.mjs — the verdict table
 * @module scripts/lib/alSpikeVerdicts
 */

import { crashInjectionProblems, recommendedArmProblems } from "./alSpikeBackendVerdict.mjs";
import { deadlineSelfTestProblems } from "./alSpikeDeadlineSelfTest.mjs";
import { casesAllPass, isCount, isExplainedSurvivor, isObject, mutantList, oracleTally, timingStat } from "./alSpikeVerdictParts.mjs";

export { reviewVerdict } from "./alSpikeReviewVerdict.mjs";

/** R18: the review panel's revert-diff deadline, measured by the caller from call to settle. */
const WORKER_DEADLINE_MS = 200;

/** Problems with one recorded timing `stat` ({ n, p50?, p95, max } ms) against the deadline. */
const deadlineStat = (stat, where) => timingStat(stat, {
  where, budget: WORKER_DEADLINE_MS, required: ["p95", "max"],
  over: (q, v) => `${where} ${q} ${v} ms exceeds the ${WORKER_DEADLINE_MS} ms deadline`,
});

/**
 * Problems with the mode tally `modes` of the samples in `stat`: integer
 * counts that account for exactly `stat.n` runs. A tally that does not is no
 * evidence about the samples it sits beside.
 */
function modeTally(modes, stat, where) {
  const n = isObject(stat) && isCount(stat.n) ? stat.n : undefined;
  const counts = isObject(modes) ? Object.values(modes) : [];
  const total = counts.length > 0 && counts.every(isCount) ? counts.reduce((a, b) => a + b, 0) : undefined;
  return total !== undefined && total === n ? [] : [`${where}: modes ${JSON.stringify(modes ?? null)} account for ${total ?? "?"} of ${n ?? "?"} runs`];
}

/**
 * Problems with one normal (non-pathological) run set: its mode tally
 * accounts for every timing sample, all of them `exact`, and, when `hunks` is
 * given, EVERY run found that many hunks — the fewest any run found
 * (`minHunkCount`), not only the most.
 */
function exactRuns(run, stat, where, hunks) {
  const modes = run?.modes;
  const out = modeTally(modes, stat, where);
  if (out.length === 0 && modes.exact !== stat.n) out.push(`${where}: ${modes.exact ?? 0} of ${stat.n} runs exact`);
  if (hunks === undefined) return out;
  const [min, max] = [run?.minHunkCount, run?.maxHunkCount];
  if (!isCount(min) || min < hunks) out.push(`${where}: the fewest hunks a run found is ${min ?? "?"} of ${hunks}`);
  else if (!isCount(max) || max < min) out.push(`${where}: the fewest hunks a run found (${min}) exceeds the most (${max ?? "?"})`);
  return out;
}

/** The consecutive-kill record holds one sample of `stat` per recorded timeout. */
const perTimeout = (stat, timeouts, where) => (isObject(stat) && stat.n === timeouts ? [] : [`${where}: ${stat?.n ?? "?"} samples for ${timeouts ?? "?"} timeouts`]);

/**
 * Interruption by killing the worker: every worker timing is in deadline,
 * every pathological run was cut short, and every normal run was exact and
 * found all its hunks — the realistic 40-edit call after each kill included.
 */
function workerPath(perf) {
  const [term, kills, d] = [perf.workerTerminationPathological ?? {}, perf.consecutiveTimeouts ?? {}, perf.workerDeadline1MB ?? {}];
  const stats = [[term.wall, "pathological"], [kills.killWall, "consecutive kill"], [kills.afterKillWall, "call after a kill"], [d.edits40?.wall, "1 MB, 40 edits"], [d.edits600?.wall, "1 MB, 600 edits"]];
  const out = stats.flatMap(([stat, where]) => deadlineStat(stat, where));
  const tally = modeTally(term.modes, term.wall, "pathological");
  out.push(...tally);
  if (tally.length === 0 && term.modes.coarse !== term.wall.n) out.push(`${term.modes.coarse ?? 0} of ${term.wall.n} pathological runs cut short`);
  if (!isCount(kills.timeouts) || kills.timeouts === 0 || kills.respawns !== kills.timeouts) out.push(`${kills.respawns ?? "?"} respawns for ${kills.timeouts ?? "?"} consecutive timeouts`);
  out.push(...perTimeout(kills.killWall, kills.timeouts, "consecutive kill"), ...perTimeout(kills.afterKillWall, kills.timeouts, "call after a kill"));
  out.push(...exactRuns(d.edits40, d.edits40?.wall, "1 MB, 40 edits", 40));
  out.push(...exactRuns(d.edits600, d.edits600?.wall, "1 MB, 600 edits", 600));
  const afterKill = { modes: kills.afterKillModes, minHunkCount: kills.afterKillMinHunkCount, maxHunkCount: kills.afterKillMaxHunkCount };
  out.push(...exactRuns(afterKill, kills.afterKillWall, "call after a kill", 40));
  return out;
}

/** Interruption by the library's own budget: the pathological fixture in deadline and cut short; the realistic case in deadline, exact, and finding all 40 hunks in every run. */
function nativePath(perf) {
  const [nat, real] = [perf.nativeBudgetPathological ?? {}, perf.nativeBudgetRealistic40 ?? {}];
  const out = [...deadlineStat(nat.wall, "native pathological"), ...deadlineStat(real.wall, "native realistic, 40 edits")];
  const tally = modeTally(nat.modes, nat.wall, "native pathological");
  out.push(...tally);
  if (tally.length === 0 && !(nat.modes["coarse-native"] > 0)) out.push("the native budget never cut a pathological run short");
  out.push(...exactRuns(real, real.wall, "native realistic, 40 edits", 40));
  return out;
}

/** Revert engine: the recommended library meets the deadline by its numbers and is exact; every library's oracle fuzz is sound. */
export function revertVerdict(doc) {
  const libs = Object.entries(isObject(doc.libraries) ? doc.libraries : {});
  const lib = doc.recommendation?.library;
  if (typeof lib !== "string" || lib === "") return ["no recommendation.library — no admissible diff candidate chosen"];
  const entry = libs.map(([, l]) => l).find((l) => isObject(l) && l.package === lib);
  if (!entry) return [`recommended library "${lib}" has no entry in libraries`];
  const out = deadlineSelfTestProblems(doc.deadlineSelfTest, doc.environment);
  const perf = isObject(entry.perf) ? entry.perf : {};
  const [viaWorker, viaNative] = [workerPath(perf), nativePath(perf)];
  if (viaWorker.length > 0 && viaNative.length > 0) out.push(`"${lib}" meets the ${WORKER_DEADLINE_MS} ms deadline by neither path — worker: ${viaWorker.join(", ")}; native: ${viaNative.join(", ")}`);
  const f = entry.fixtures ?? {};
  if (!isCount(f.total) || f.total === 0 || f.pass !== f.total) out.push(`"${lib}" passes ${f.pass ?? "?"} of ${f.total ?? "?"} adversarial fixtures`);
  for (const [name, l] of libs) {
    out.push(...oracleTally(l?.revertOracleFuzz?.minimal?.summary, `${name} minimal fuzz`));
    out.push(...oracleTally(l?.revertOracleFuzz?.mixed?.summary, `${name} mixed fuzz`));
    out.push(...oracleTally(l?.revertSeedSweep?.summary, `${name} seed sweep`));
  }
  return out;
}

/** Backend comparison: a backend is decided, every required crash-injection case recovered by its evidence, and the recommended arm is admissible by its own cases. */
export function backendVerdict(doc) {
  const out = [];
  const b = doc.recommendation?.backend;
  if (typeof b !== "string" || b.trim() === "") out.push("no recommendation.backend — the backend is not decided");
  out.push(...recommendedArmProblems(doc));
  out.push(...crashInjectionProblems(doc.crashInjection));
  return out;
}

/** R23: the persisted schema version the transaction harness must implement. */
const TXN_SCHEMA_VERSION = 2;
/** The test area (tests/provenance.rs) that holds Rust/TS provenance parity; always required. */
const TXN_PROVENANCE_AREA = "provenance";
/** The per-append durable latency budget, each append alone. */
const DURABLE_APPEND_P95_BUDGET_MS = 25;
/** The live-span load the latency is measured under (500 agent hunks + 100 restores), and the appends judged. */
const [TXN_LATENCY_LIVE_SPANS, TXN_APPEND_OPS] = [600, ["observe", "linearize"]];

/** Each durable append's p95, measured on the real provenance path; a row that is not, or a summed row, counts for nothing. */
function txnLatency(doc) {
  const rows = Array.isArray(doc.measurements?.captureLatency) ? doc.measurements.captureLatency : [];
  return TXN_APPEND_OPS.flatMap((op) => {
    const real = rows.filter((r) => isObject(r) && r.op === op && r.sync === "full" && r.provenance === true && isCount(r.liveSpans) && r.liveSpans >= TXN_LATENCY_LIVE_SPANS);
    if (real.length === 0) return [`no full-sync ${op} latency measured with a provenance payload and ≥ ${TXN_LATENCY_LIVE_SPANS} live spans`];
    const where = `durable append ${op}`;
    return real.flatMap((r) => timingStat(r, {
      where, budget: DURABLE_APPEND_P95_BUDGET_MS, count: "runs", fields: { p50: "p50Ms", p95: "p95Ms" },
      over: (q, v) => `${where} ${q} ${v} ms exceeds ${DURABLE_APPEND_P95_BUDGET_MS} ms`,
    }));
  });
}

/** R23 and the harness's own exits: schema v2; cargo test, clippy and the measurement example exited 0. */
function txnSchemaAndGates(doc) {
  const out = [];
  if (doc.schemaVersion !== TXN_SCHEMA_VERSION) out.push(`schemaVersion ${JSON.stringify(doc.schemaVersion)} — R23 requires ${TXN_SCHEMA_VERSION}`);
  const g = doc.gates;
  if (!isObject(g) || !isCount(g.testExit) || !isCount(g.clippyExit) || !isCount(g.measureExit)) return [...out, "gates needs integer testExit, clippyExit and measureExit"];
  if (g.testExit !== 0) out.push(`cargo test exited ${g.testExit}`);
  if (g.clippyExit !== 0) out.push(`clippy exited ${g.clippyExit}`);
  if (g.measureExit !== 0) out.push(`the measurement example exited ${g.measureExit}`);
  return out;
}

/** Every area ran and passed, including each of `provenanceAreas`, and the total is the sum of the areas. */
function txnAreas(tests, provenanceAreas) {
  const out = [];
  const byArea = isObject(tests?.byArea) ? tests.byArea : {};
  const areas = Object.entries(byArea);
  if (areas.length === 0) out.push("tests.byArea records no test area");
  if (!Array.isArray(provenanceAreas) || provenanceAreas.length === 0) out.push("no tests/provenance*.rs found to derive the required parity areas from");
  for (const a of new Set([TXN_PROVENANCE_AREA, ...(provenanceAreas ?? [])])) {
    if (!Object.hasOwn(byArea, a)) out.push(`no "${a}" test area — tests/${a}.rs did not run`);
  }
  for (const [name, a] of areas) {
    if (!isObject(a) || !isCount(a.run) || !isCount(a.passed)) out.push(`area "${name}" needs integer run and passed`);
    else if (a.run === 0) out.push(`area "${name}" ran no tests`);
    else if (a.passed !== a.run) out.push(`area "${name}" passed ${a.passed} of ${a.run}`);
  }
  const total = tests?.total;
  if (!isObject(total) || !isCount(total.run) || !isCount(total.passed)) return [...out, "tests.total needs integer run and passed"];
  if (total.run === 0 || total.passed !== total.run) out.push(`tests.total passed ${total.passed} of ${total.run}`);
  const sum = areas.reduce((n, [, a]) => n + (isObject(a) && isCount(a.run) ? a.run : 0), 0);
  if (areas.length > 0 && sum !== total.run) out.push(`tests.total.run ${total.run} ≠ sum of areas ${sum}`);
  return out;
}

/** A mutation run that generated mutants and killed every one, its mutant list agreeing with the counts. */
function txnMutations(m) {
  if (!isObject(m) || !isCount(m.killed) || !isCount(m.survived)) return ["mutationChecks needs integer killed and survived counts"];
  const out = [];
  if (m.killed + m.survived === 0) out.push("mutationChecks generated no mutant");
  if (m.survived > 0) out.push(`${m.survived} mutant(s) survived`);
  out.push(...mutantList(m.mutants, { total: m.killed + m.survived, killed: m.killed }, "mutationChecks").problems);
  return out;
}

/** Transaction harness: schema v2, gates 0, every area (incl. each of `provenanceAreas`) passed, every mutant killed, appends in budget. */
export function txnVerdict(doc, { provenanceAreas } = {}) {
  return [...txnSchemaAndGates(doc), ...txnAreas(doc.tests, provenanceAreas), ...txnMutations(doc.mutationChecks), ...txnLatency(doc)];
}

/** Anchor mapping: every fixture maps exactly or widens visibly; none fails. */
function anchorFixturesVerdict(doc) {
  const t = doc.totals;
  if (!isObject(t) || ![t.fixtures, t.exact, t.widened, t.failed].every(isCount)) return ["totals needs integer fixtures, exact, widened and failed"];
  if (t.fixtures === 0) return ["totals records zero fixtures"];
  if (t.failed > 0) return [`${t.failed} of ${t.fixtures} fixtures failed`];
  if (t.exact + t.widened !== t.fixtures) return [`exact ${t.exact} + widened ${t.widened} ≠ fixtures ${t.fixtures}`];
  return [];
}

/** R20's per-transaction observation budget, in µs as the anchor probe records it. */
const OBSERVE_P95_BUDGET_US = 2000;
const BLOCK_PROVENANCE_CASE_PARTS = ["constructs", "serialization", "widen", "history", "lifecycle", "attach", "rebuild", "perf"];

/** Bounded WYSIWYG provenance (R20): every part passed, 1 MiB observation p95 in budget, no unexplained mutant. */
function blockProvenanceVerdict(bp) {
  if (!isObject(bp)) return ["no blockProvenance section — run the block-provenance probes"];
  const out = [];
  const t = bp.totals;
  if (!isObject(t) || !isCount(t.cases) || !isCount(t.pass)) out.push("blockProvenance.totals needs integer cases and pass");
  else if (t.cases === 0) out.push("blockProvenance.totals records zero cases");
  else if (t.pass !== t.cases) out.push(`blockProvenance: ${t.cases - t.pass} of ${t.cases} cases did not pass`);
  const parts = isObject(bp.parts) ? bp.parts : {};
  for (const name of BLOCK_PROVENANCE_CASE_PARTS) {
    if (!isObject(parts[name])) out.push(`blockProvenance part "${name}" is missing`);
    else out.push(...casesAllPass(parts[name].cases, `blockProvenance ${name} cases`));
  }
  out.push(...timingStat(parts.perf?.oneMiB?.observeUs, {
    where: "blockProvenance 1 MiB observation", budget: OBSERVE_P95_BUDGET_US,
    over: (q, v) => `blockProvenance observation ${q} ${v} µs exceeds ${OBSERVE_P95_BUDGET_US} µs`,
  }));
  out.push(...blockMutants(parts.mutants));
  return out;
}

/** The block-provenance mutation run: a listed run agreeing with its counts, every survivor with a stated equivalence. */
function blockMutants(m) {
  const where = "blockProvenance mutants";
  if (m === undefined) return ["blockProvenance records no mutation run"];
  if (!isObject(m) || !isCount(m.total) || !isCount(m.killed) || !isCount(m.unexplainedSurvivors)) return [`${where} needs integer total, killed and unexplainedSurvivors`];
  if (m.total === 0) return [`${where} records zero mutants`];
  const { problems, survivors } = mutantList(m.mutants, m, where);
  const unexplained = survivors.filter((s) => !isExplainedSurvivor(s));
  if (unexplained.length > 0) problems.push(`blockProvenance: ${unexplained.length} surviving mutant(s) without a stated equivalence (${unexplained.map((s) => s.mutant).join(", ")})`);
  if (m.unexplainedSurvivors !== unexplained.length) problems.push(`${where} records ${m.unexplainedSurvivors} unexplained survivor(s), but the list shows ${unexplained.length}`);
  return problems;
}

export const anchorVerdict = (doc) => [...anchorFixturesVerdict(doc), ...blockProvenanceVerdict(doc.blockProvenance)];
