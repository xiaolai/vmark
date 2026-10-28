/**
 * Purpose: the checks every agent-edit-ledger spike verdict shares — value
 * shapes, a list of cases that must all pass, an R24 oracle tally, ONE
 * mutant-list validator (the anchor and txn mutation runs), and ONE
 * timing-stat validator, so the revert deadline, the txn append latency and
 * the review budgets judge a recorded timing the same way.
 *
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — the revert, backend, txn and anchor verdicts
 * @coordinates-with scripts/lib/alSpikeReviewVerdict.mjs — the review verdict
 * @module scripts/lib/alSpikeVerdictParts
 */

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
export const isCount = (v) => Number.isInteger(v) && v >= 0;
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

/** Problems with a recorded list of `{ pass }` cases: at least one, and every one passed. */
export const casesAllPass = (cases, what) => {
  if (!Array.isArray(cases) || cases.length === 0) return [`no ${what} recorded`];
  const failed = cases.filter((c) => !isObject(c) || c.pass !== true).length;
  return failed === 0 ? [] : [`${failed} of ${cases.length} ${what} did not pass`];
};

const isNonblank = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Problems with a recorded mutation-run list at `where`, plus its survivors.
 * The list is the evidence, so it is required: each row `{ mutant, file?,
 * killed, failing }` names one mutant (once, keyed by file and name) with a
 * boolean `killed`; every killed one names the tests that failed; and the list
 * agrees with the recorded `total` and `killed` counts.
 */
export function mutantList(list, { total, killed }, where) {
  if (!Array.isArray(list) || list.length === 0) return { problems: [`${where} lists no mutant`], survivors: [] };
  const problems = [];
  const rows = list.filter((m) => isObject(m) && isNonblank(m.mutant) && typeof m.killed === "boolean");
  if (rows.length < list.length) problems.push(`${where}: ${list.length - rows.length} row(s) need a nonblank mutant name and a boolean killed`);
  const key = (m) => `${typeof m.file === "string" ? `${m.file}: ` : ""}${m.mutant}`;
  for (const [name, same] of Map.groupBy(rows, key)) if (same.length > 1) problems.push(`${where} lists "${name}" ${same.length} times`);
  const dead = rows.filter((m) => m.killed);
  for (const m of dead) {
    if (!Array.isArray(m.failing) || m.failing.length === 0 || !m.failing.every(isNonblank)) problems.push(`${where}: killed mutant "${key(m)}" names no failing test`);
  }
  if (list.length !== total || dead.length !== killed) problems.push(`${where} lists ${list.length} mutant(s), ${dead.length} killed, but counts ${total} total and ${killed} killed`);
  return { problems, survivors: rows.filter((m) => !m.killed) };
}

/** An anchor survivor is explained only by a stated, nonblank equivalence. */
export const isExplainedSurvivor = (m) => isNonblank(m.equivalentBecause);

/** R24: the counters that must be zero in every oracle tally. */
const ORACLE_REQUIRED_ZERO = ["wrong", "spanMismatch", "requiredMissed", "snapshotApplied"];

/** Problems with one R24 oracle tally `t`, labelled `where`. */
export function oracleTally(t, where) {
  if (!isObject(t)) return [`${where}: no oracle tally recorded`];
  const out = [];
  for (const k of ORACLE_REQUIRED_ZERO) {
    if (!isCount(t[k])) out.push(`${where}: ${k} not recorded`);
    else if (t[k] > 0) out.push(`${where}: ${k} ${t[k]}`);
  }
  if (!isCount(t.nontrivial) || t.nontrivial === 0) out.push(`${where}: no nontrivial successful revert`);
  return out;
}

/** The quantiles a timing record may carry, in the order their values must keep. */
const QUANTILES = ["p50", "p95", "max"];

/**
 * Problems with one recorded timing `stat` (ms) at `where`. `fields` maps the
 * quantiles to the record's keys; `count` names its sample count. A record
 * needs a positive integer sample count; each `required` quantile, and every
 * other one it carries, a finite non-negative number; its quantiles in order
 * (p50 ≤ p95 ≤ max); and each `judged` quantile within `budget`, else the
 * problem `over(quantile, value)`.
 */
export function timingStat(stat, { where, budget, over, count = "n", fields = { p50: "p50", p95: "p95", max: "max" }, required = ["p95"], judged = required }) {
  if (!isObject(stat) || !isCount(stat[count]) || stat[count] === 0) return [`${where}: no timings recorded`];
  const carried = QUANTILES.filter((q) => fields[q] !== undefined && (required.includes(q) || stat[fields[q]] !== undefined));
  const bad = carried.filter((q) => !isFiniteNumber(stat[fields[q]]) || stat[fields[q]] < 0);
  if (bad.length > 0) return bad.map((q) => `${where}: ${q} ${JSON.stringify(stat[fields[q]])} is not a non-negative number`);
  const out = [];
  for (let i = 1; i < carried.length; i++) {
    const [lo, hi] = [carried[i - 1], carried[i]];
    if (stat[fields[lo]] > stat[fields[hi]]) out.push(`${where}: ${lo} ${stat[fields[lo]]} exceeds ${hi} ${stat[fields[hi]]}`);
  }
  for (const q of judged) if (stat[fields[q]] > budget) out.push(over(q, stat[fields[q]]));
  return out;
}
