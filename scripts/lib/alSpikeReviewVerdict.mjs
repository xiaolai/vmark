/**
 * Purpose: the review spike's phase-0 verdict — the probe run passed with
 * nothing skipped, its totals the sum of its per-probe rows, including every *.probe.ts[x] under review/probes the caller lists (an
 * empty list refuses; two probes sharing a basename are refused, since the
 * reporter keys its rows by basename); source provenance covered undo, redo,
 * IME composition and net-zero edits (R18/R19); observation p95 ≤ 2 ms and
 * capture p95 ≤ 10 ms; the accumulator cap was hit and turned into a barrier
 * (R19); the ledger oracle has no wrong revert and nontrivial successes in
 * every shape and mode, and every named regression applies exactly or
 * refuses, never reverting wrongly. One validator per measurement section.
 *
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — re-exports reviewVerdict beside the other areas
 * @coordinates-with scripts/check-al-spike-results.test.mjs — the verdict table
 * @module scripts/lib/alSpikeReviewVerdict
 */

import { isCount, isObject, oracleTally, timingStat } from "./alSpikeVerdictParts.mjs";

/** R20's per-transaction observation budget, and the per-capture budget (ms). */
const [OBSERVE_P95_BUDGET_MS, CAPTURE_P95_BUDGET_MS] = [2, 10];
/** Probes whose measurements phase 0 reads; required beside every file the caller found (`reviewProbes`). */
const REVIEW_REQUIRED_PROBES = ["sourceProvenance.probe.ts", "budgets.probe.ts", "barriers.probe.ts", "ambiguousRevert.probe.ts"];
/** Transaction kinds R18/R19 name, which the source-provenance probe must have exercised. */
const REVIEW_REQUIRED_KINDS = ["undo", "redo", "compose", "netZero"];

/** `stat.p95` (ms) at `where`: a real sample within `budget`. */
const p95Within = (stat, budget, where) => timingStat(stat, { where, budget, over: (q, v) => `${where} ${q} ${v} ms exceeds ${budget} ms` });

const RUN_COUNTS = ["passed", "failed", "skipped"];
const hasRunCounts = (r) => isObject(r) && RUN_COUNTS.every((k) => isCount(r[k]));

/**
 * The run's own counts: every row and the totals record integer passed,
 * failed and skipped; nothing failed or was skipped (a probe whose acceptance
 * tests were skipped did not pass); and the totals are the sum of the rows.
 */
function runCounts(t, rows) {
  const out = [];
  for (const [file, row] of Object.entries(rows)) {
    if (!hasRunCounts(row)) out.push(`${file} needs integer passed, failed and skipped`);
    else {
      if (row.failed > 0) out.push(`${file}: ${row.failed} failed`);
      if (row.skipped > 0) out.push(`${file}: ${row.skipped} skipped`);
    }
  }
  if (!hasRunCounts(t)) return [...out, "totals needs integer passed, failed and skipped"];
  if (t.failed > 0 || t.passed === 0) out.push(`totals: ${t.passed} passed, ${t.failed} failed`);
  if (t.skipped > 0) out.push(`totals: ${t.skipped} skipped`);
  for (const k of RUN_COUNTS) {
    const sum = Object.values(rows).reduce((n, r) => n + (isObject(r) && isCount(r[k]) ? r[k] : 0), 0);
    if (sum !== t[k]) out.push(`totals.${k} ${t[k]} ≠ sum of testsPerArea ${sum}`);
  }
  return out;
}

function reviewRunVerdict(doc, reviewProbes) {
  const out = [];
  if (!Array.isArray(reviewProbes) || reviewProbes.length === 0) out.push("no review/probes/*.probe.ts[x] found to derive the required probes from");
  if (doc.status !== "pass") out.push(`status ${JSON.stringify(doc.status)}, not "pass"`);
  const rows = isObject(doc.testsPerArea) ? doc.testsPerArea : {};
  out.push(...runCounts(doc.totals, rows));
  for (const [name, same] of Map.groupBy(reviewProbes ?? [], (f) => f)) {
    if (same.length > 1) out.push(`${name} names ${same.length} probes under review/probes — the reporter keys rows by basename, so rename all but one`);
  }
  for (const file of new Set([...REVIEW_REQUIRED_PROBES, ...(reviewProbes ?? [])])) {
    const row = rows[file];
    if (!hasRunCounts(row) || row.passed === 0 || row.failed !== 0 || row.skipped !== 0) out.push(`${file} did not run and pass`);
  }
  return out;
}

/** R18/R19: the source-provenance probe checked spans over every required transaction kind. */
function sourceProvenanceVerdict(sp) {
  if (!isObject(sp)) return ["no sourceProvenance measurement"];
  const out = [];
  for (const k of ["transactions", "spansChecked"]) if (!isCount(sp[k]) || sp[k] === 0) out.push(`sourceProvenance checked no ${k}`);
  for (const k of REVIEW_REQUIRED_KINDS) if (!isCount(sp.kinds?.[k]) || sp.kinds[k] === 0) out.push(`sourceProvenance exercised no "${k}" transaction`);
  return out;
}

/** Observation and capture in budget, the accumulator under its cap, and the cap overflowed into a barrier (R19). */
function budgetsVerdict(b, barriers) {
  if (!isObject(b)) return ["no budgets measurement"];
  const out = [
    ...p95Within(b.session?.observeCpuMs, OBSERVE_P95_BUDGET_MS, "session observation"),
    ...p95Within(b.nearCap?.observeCpuMs, OBSERVE_P95_BUDGET_MS, "near-cap observation"),
    ...p95Within(b.nearCap?.observeCpuMsNearCap, OBSERVE_P95_BUDGET_MS, "at-cap observation"),
    ...p95Within(b.session?.captureCpuMs, CAPTURE_P95_BUDGET_MS, "session capture"),
    ...p95Within(b.nearCap?.captureCpuMs, CAPTURE_P95_BUDGET_MS, "near-cap capture"),
  ];
  if (!isCount(b.cap) || b.cap === 0) out.push("budgets records no accumulator cap");
  else if (!isCount(b.nearCap?.peakEntries) || b.nearCap.peakEntries > b.cap) out.push(`accumulator peak ${b.nearCap?.peakEntries} exceeds the cap ${b.cap}`);
  const o = barriers?.capOverflow;
  if (!isObject(o) || o.cap !== b.cap || !isCount(o.ops) || o.ops < b.cap) out.push(`the accumulator cap ${b.cap} was never overflowed into a barrier`);
  return out;
}

/** R24: every ledger-oracle shape is sound, and every named regression holds. */
function ambiguousRevertVerdict(ar) {
  const out = [];
  const shapes = Object.entries(isObject(ar?.ledgerOracleFuzz?.byShapeAndMode) ? ar.ledgerOracleFuzz.byShapeAndMode : {});
  if (shapes.length === 0) out.push("ambiguousRevert records no ledger-oracle shape");
  for (const [name, tally] of shapes) out.push(...oracleTally(tally, `ledger oracle ${name}`));
  const regressions = Object.entries(isObject(ar?.regressions) ? ar.regressions : {});
  if (regressions.length === 0) out.push("ambiguousRevert records no named regression");
  for (const [id, r] of regressions) out.push(...regressionVerdict(id, r));
  return out;
}

const REGRESSION_REQUIRED_ZERO = ["wrong", "spanMismatch", "requiredMissed"];

/**
 * One named R24 regression: no wrong revert, span mismatch or missed required revert; an "applied"
 * one refuses nothing and reverts to the expected text; an "ambiguous" one refuses at least one hunk
 * (what it leaves is not compared — a history-backed refusal may apply its unambiguous hunks).
 */
function regressionVerdict(id, r) {
  if (!isObject(r)) return [`regression ${id} has no measurement`];
  const out = [];
  for (const k of REGRESSION_REQUIRED_ZERO) {
    if (!isCount(r[k])) out.push(`regression ${id} records no ${k} count`);
    else if (r[k] > 0) out.push(`regression ${id}: ${k} = ${r[k]}`);
  }
  if (r.status === "applied") {
    if (r.ambiguous !== 0) out.push(`regression ${id} must apply but refused ${r.ambiguous} hunk(s)`);
    if (r.text !== r.expected) out.push(`regression ${id} reverted to the wrong text`);
  } else if (r.status === "ambiguous") {
    if (!isCount(r.ambiguous) || r.ambiguous === 0) out.push(`regression ${id} must refuse but refused nothing`);
  } else out.push(`regression ${id} has no status (applied | ambiguous)`);
  return out;
}

/** Review probes: the run passed, and its provenance, budget, cap and oracle measurements meet R18–R24. */
export function reviewVerdict(doc, { reviewProbes } = {}) {
  const m = isObject(doc.measurements) ? doc.measurements : {};
  return [...reviewRunVerdict(doc, reviewProbes), ...sourceProvenanceVerdict(m.sourceProvenance), ...budgetsVerdict(m.budgets, m.barriers), ...ambiguousRevertVerdict(m.ambiguousRevert)];
}
