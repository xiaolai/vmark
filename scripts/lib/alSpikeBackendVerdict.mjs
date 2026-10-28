/**
 * Purpose: the backend spike's crash-injection verdict, the crash matrix it
 * requires, and the check tying the recommended arm to its own crash results.
 * The matrix is the shared manifest `alSpikeBackendCrashCases.json` — the
 * backend spike's `crash.rs` compiles the same file in, so the cases it runs
 * and the cases required here cannot drift — and is never read from the
 * artifact, so a run cannot pass by recording fewer cases.
 *
 * A recorded case passes only by its evidence, re-derived here as crash.rs
 * derives it: a crash boundary was delivered by SIGKILL (the control was
 * not), the observed state is the matrix's expected one, and the store's
 * invariants held. `total`, `failed` and `failures` must agree with the list.
 *
 * The recommendation names its arm by admissibility key (`jsonlLoose`,
 * `jsonlPacked`); that arm must be recorded admissible (`true` exactly), and
 * every required case of it must pass by its evidence, so a clean matrix
 * beside an inadmissible or contradicted selection is refused.
 *
 * @coordinates-with scripts/lib/alSpikeBackendCrashCases.json — the shared crash matrix
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — backendVerdict applies it
 * @coordinates-with scripts/lib/alSpikeBackendVerdict.test.mjs — the self-test
 * @module scripts/lib/alSpikeBackendVerdict
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { isCount, isObject } from "./alSpikeVerdictParts.mjs";

const MAX_NAMED = 5;
const CASE_FIELDS = ["arm", "operation", "boundary", "expected"];
const MANIFEST = "alSpikeBackendCrashCases.json";
/** Admissibility key → the crash-case arm that measured it. Only these arms have crash evidence to select by. */
const MEASURED_ARMS = Object.freeze({ jsonlLoose: "loose", jsonlPacked: "packed" });

/** The shared manifest, validated: a nonempty array of `{ arm, operation, boundary, expected }` strings. Throws when it is not. */
function loadManifest() {
  const list = JSON.parse(readFileSync(path.join(import.meta.dirname, MANIFEST), "utf8"));
  const bad = Array.isArray(list) ? list.findIndex((c) => !isObject(c) || !CASE_FIELDS.every((k) => typeof c[k] === "string")) : 0;
  if (!Array.isArray(list) || list.length === 0 || bad >= 0) throw new Error(`${MANIFEST}: entry ${bad} needs string ${CASE_FIELDS.join(", ")}`);
  return Object.freeze(list.map((c) => Object.freeze(Object.fromEntries(CASE_FIELDS.map((k) => [k, c[k]])))));
}

/** Every crash case the backend spike must run, in its order: `boundary: "none"` is the unkilled control. */
export const BACKEND_CRASH_CASES = loadManifest();

const idOf = (c) => `${c.arm}/${c.operation}/${c.boundary}`;
const isIdentified = (c) => isObject(c) && ["arm", "operation", "boundary"].every((k) => typeof c[k] === "string");
const named = (ids) => `${ids.slice(0, MAX_NAMED).join(", ")}${ids.length > MAX_NAMED ? ` and ${ids.length - MAX_NAMED} more` : ""}`;

/** Why the recovery a recorded case `c` observed does not meet its matrix entry `want`; `[]` when it does. */
function evidenceGaps(c, want) {
  const why = [];
  if (c.observed !== want.expected) why.push(`observed ${JSON.stringify(c.observed)}, expected ${JSON.stringify(want.expected)}`);
  if (c.invariantsOk !== true) why.push("invariants did not hold");
  if (want.boundary === "none" ? c.killedBySigkill !== false : c.killedBySigkill !== true) {
    why.push(want.boundary === "none" ? "the control run was killed" : "the crash was not delivered by SIGKILL");
  }
  return why;
}

/** Why a recorded case's evidence does not support a pass against its matrix entry `want`; `[]` when it does. */
function evidenceProblems(c, want) {
  const out = [];
  if (c.expected !== want.expected) out.push(`records expected ${JSON.stringify(c.expected)}, but the manifest expects ${JSON.stringify(want.expected)}`);
  const why = evidenceGaps(c, want);
  if (c.pass === true && why.length > 0) out.push(`recorded pass, but ${why.join("; ")}`);
  return out;
}

/** The one recorded case for `want`, passing by its evidence; recorded twice or not at all is no pass. */
const passesByEvidence = (same, want) => same?.length === 1 && same[0].pass === true && same[0].expected === want.expected && evidenceGaps(same[0], want).length === 0;

/** The recorded cases with string arm, operation and boundary, grouped by case id. */
const recordedById = (ci) => Map.groupBy((isObject(ci) && Array.isArray(ci.cases) ? ci.cases : []).filter(isIdentified), idOf);

/**
 * Problems with the recommended arm: `recommendation.arm` names a measured arm
 * (an admissibility key with crash evidence), `admissibility[arm].admissible`
 * is `true` exactly, and every required case of that arm passed by its
 * evidence. `[]` is a pass.
 */
export function recommendedArmProblems(doc) {
  const arm = doc.recommendation?.arm;
  if (typeof arm !== "string" || arm.trim() === "") return ["no recommendation.arm — the recommended backend arm is not named"];
  if (!Object.hasOwn(MEASURED_ARMS, arm)) return [`recommendation.arm ${JSON.stringify(arm)} is not a measured arm (${Object.keys(MEASURED_ARMS).join(", ")})`];
  const admissible = isObject(doc.admissibility) && isObject(doc.admissibility[arm]) ? doc.admissibility[arm].admissible : undefined;
  if (admissible !== true) {
    return [`recommendation.arm ${JSON.stringify(arm)} is not admissible (admissibility.${arm}.admissible is ${admissible === undefined ? "missing" : JSON.stringify(admissible)})`];
  }
  const required = BACKEND_CRASH_CASES.filter((c) => c.arm === MEASURED_ARMS[arm]);
  const byId = recordedById(doc.crashInjection);
  const unproven = required.filter((want) => !passesByEvidence(byId.get(idOf(want)), want)).map(idOf);
  if (unproven.length === 0) return [];
  return [`recommendation.arm ${JSON.stringify(arm)} is recorded admissible, but ${unproven.length} of its ${required.length} required crash case(s) did not pass by evidence (${named(unproven)})`];
}

/** Every problem with the recorded `crashInjection` against BACKEND_CRASH_CASES; `[]` is a pass. */
export function crashInjectionProblems(ci) {
  const cases = isObject(ci) && Array.isArray(ci.cases) ? ci.cases : [];
  if (cases.length === 0) return ["no crash-injection cases recorded"];
  const out = [];
  const identified = cases.filter(isIdentified);
  if (identified.length < cases.length) out.push(`crash-injection: ${cases.length - identified.length} case(s) need string arm, operation and boundary`);
  const required = new Map(BACKEND_CRASH_CASES.map((c) => [idOf(c), c]));
  const byId = recordedById(ci);
  const missing = [...required.keys()].filter((id) => !byId.has(id));
  if (missing.length > 0) out.push(`crash-injection: ${missing.length} required case(s) did not run (${named(missing)})`);
  for (const [id, same] of byId) {
    if (!required.has(id)) out.push(`crash-injection: case ${id} is not a required case`);
    else if (same.length > 1) out.push(`crash-injection: case ${id} recorded ${same.length} times`);
    else out.push(...evidenceProblems(same[0], required.get(id)).map((why) => `crash-injection: case ${id} ${why}`));
  }
  const failing = cases.filter((c) => !isObject(c) || c.pass !== true).length;
  if (failing > 0) out.push(`crash-injection: ${failing} of ${cases.length} case(s) did not pass`);
  const failures = Array.isArray(ci.failures) ? ci.failures.length : undefined;
  if (ci.total !== cases.length || !isCount(ci.failed) || ci.failed !== failing || failures !== failing) {
    out.push(`crash-injection: total ${ci.total ?? "?"}, failed ${ci.failed ?? "?"} and ${failures ?? "?"} failure(s) do not match ${cases.length} case(s), ${failing} failing`);
  }
  return out;
}
