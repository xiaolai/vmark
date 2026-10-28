// WI-AL0.5 — the backend crash-injection verdict: every required crash case ran once, its pass re-derived from its evidence, and the counts reconcile
/**
 * Pins `backendVerdict`'s crash-injection section. Before, any nonempty
 * all-pass list closed WI-AL0.5 — one fabricated `{ pass: true }` was enough.
 * Now the required cases are a manifest fixed in the gate (the backend spike's
 * `cases()`), so:
 *   - every manifest case ran exactly once, and no case outside it is counted;
 *   - each case's pass is re-derived from its evidence: a crash boundary was
 *     SIGKILLed (the control was not), the observed state is the manifest's
 *     expected one, and the store invariants held — a recorded `pass: true`
 *     over failing evidence is refused;
 *   - `total`, `failed` and `failures` agree with the case list.
 *
 * And the recommendation names the arm it chose (`recommendation.arm`, an
 * `admissibility` key): a measured JSONL arm, recorded admissible (`true`,
 * not `"not measured"`), whose own required crash cases all passed by their
 * evidence — a clean matrix beside an inadmissible selection is refused.
 *
 * @coordinates-with scripts/lib/alSpikeBackendVerdict.mjs — the verdict and manifest under test
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — backendVerdict applies it
 * @module scripts/lib/alSpikeBackendVerdict.test
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BACKEND_CRASH_CASES } from "./alSpikeBackendVerdict.mjs";
import { backendVerdict } from "./alSpikeVerdicts.mjs";

/** A passing recorded case for one manifest entry, as crash.rs writes it. */
const ran = ({ arm, operation, boundary, expected }) => ({
  arm, operation, boundary, expected, observed: expected, invariantsOk: true,
  killedBySigkill: boundary !== "none", exitCode: boundary === "none" ? 0 : null, pass: true,
});
const CASES = BACKEND_CRASH_CASES.map(ran);
const injection = (cases = CASES, over = {}) => ({ cases, total: cases.length, failed: 0, failures: [], ...over });
const ADMISSIBLE = { jsonlLoose: { admissible: true }, jsonlPacked: { admissible: true }, gitSystem: { admissible: false }, gitBundled: { admissible: "not measured" } };
const recommend = (arm) => ({ backend: "JSONL (packed blob layout)", arm });
/** A results document selecting jsonlPacked, both JSONL arms admissible, every case passing; `over` replaces top-level keys. */
const doc = (over = {}) => ({ recommendation: recommend("jsonlPacked"), admissibility: ADMISSIBLE, crashInjection: injection(), ...over });
const verdict = (crashInjection) => backendVerdict(doc({ crashInjection }));
const idOf = (c) => `${c.arm}/${c.operation}/${c.boundary}`;
const withCase = (i, over) => CASES.map((c, j) => (j === i ? { ...c, ...over } : c));

describe("BACKEND_CRASH_CASES — the backend spike's crash matrix", () => {
  it("names the 41 cases crash.rs enumerates, each once", () => {
    expect(BACKEND_CRASH_CASES).toHaveLength(41);
    expect(new Set(BACKEND_CRASH_CASES.map(idOf)).size).toBe(41);
    expect(BACKEND_CRASH_CASES.filter((c) => c.arm === "loose")).toHaveLength(20);
    expect(BACKEND_CRASH_CASES.filter((c) => c.arm === "packed")).toHaveLength(15);
    expect(BACKEND_CRASH_CASES.filter((c) => c.arm === "git")).toHaveLength(6);
    expect(BACKEND_CRASH_CASES).toContainEqual({ arm: "packed", operation: "capture", boundary: "append_torn:32768", expected: "old" });
    expect(BACKEND_CRASH_CASES).toContainEqual({ arm: "loose", operation: "compact", boundary: "gc_mid_unlink", expected: "compacted" });
    expect(BACKEND_CRASH_CASES).toContainEqual({ arm: "git", operation: "capture", boundary: "git_after_update_ref", expected: "new" });
  });

  it("is the shared manifest crash.rs also reads, not a hand copy", () => {
    const shared = JSON.parse(readFileSync(path.join(import.meta.dirname, "alSpikeBackendCrashCases.json"), "utf8"));
    expect(BACKEND_CRASH_CASES).toEqual(shared);
  });
});

describe("backendVerdict — crash injection", () => {
  it("every manifest case, passing by its evidence, with matching counts, passes", () => {
    expect(verdict(injection())).toEqual([]);
  });

  it("one fabricated passing case does not close the work item", () => {
    const problems = verdict(injection([{ pass: true }]));
    expect(problems).toContain("crash-injection: 1 case(s) need string arm, operation and boundary");
    expect(problems).toContain("crash-injection: 41 required case(s) did not run (loose/capture/none, loose/capture/blob_tmp_partial, loose/capture/blob_after_tmp_write, loose/capture/blob_after_tmp_fsync, loose/capture/blob_after_rename and 36 more)");
  });

  it("a missing required case is refused by name", () => {
    const cases = CASES.filter((c) => c.boundary !== "gc_mid_unlink");
    expect(verdict(injection(cases))).toContain("crash-injection: 1 required case(s) did not run (loose/compact/gc_mid_unlink)");
  });

  it("a case outside the manifest is refused", () => {
    const extra = { ...CASES[0], boundary: "made_up" };
    expect(verdict(injection([...CASES, extra]))).toContain("crash-injection: case loose/capture/made_up is not a required case");
  });

  it("a case recorded twice is refused", () => {
    expect(verdict(injection([...CASES, CASES[3]]))).toContain(`crash-injection: case ${idOf(CASES[3])} recorded 2 times`);
  });

  it.each([
    ["observed state is not the expected one", { observed: "old" }, "observed \"old\", expected \"new\""],
    ["store invariants did not hold", { invariantsOk: false }, "invariants did not hold"],
    ["a crash boundary that was not killed", { killedBySigkill: false }, "the crash was not delivered by SIGKILL"],
  ])("a recorded pass whose %s is refused", (_name, over, why) => {
    const i = CASES.findIndex((c) => c.boundary === "append_after_write" && c.arm === "loose");
    expect(verdict(injection(withCase(i, over)))).toContain(`crash-injection: case loose/capture/append_after_write recorded pass, but ${why}`);
  });

  it("a control case that was killed is refused", () => {
    expect(verdict(injection(withCase(0, { killedBySigkill: true })))).toContain("crash-injection: case loose/capture/none recorded pass, but the control run was killed");
  });

  it("an expected state that is not the manifest's is refused, even when observed agrees", () => {
    const i = CASES.findIndex((c) => c.boundary === "blob_after_rename");
    expect(verdict(injection(withCase(i, { expected: "new", observed: "new" })))).toContain('crash-injection: case loose/capture/blob_after_rename records expected "new", but the manifest expects "old"');
  });

  it("a case recorded as failed is refused, and counted", () => {
    const cases = withCase(5, { pass: false, observed: "torn" });
    const problems = verdict(injection(cases, { failed: 1, failures: [idOf(cases[5])] }));
    expect(problems).toContain("crash-injection: 1 of 41 case(s) did not pass");
  });

  it.each([
    ["a total that is not the case count", { total: 42 }, "crash-injection: total 42, failed 0 and 0 failure(s) do not match 41 case(s), 0 failing"],
    ["a failed count that hides a failure", { failed: 1 }, "crash-injection: total 41, failed 1 and 0 failure(s) do not match 41 case(s), 0 failing"],
    ["a failures list with entries", { failures: ["x"] }, "crash-injection: total 41, failed 0 and 1 failure(s) do not match 41 case(s), 0 failing"],
    ["no total", { total: undefined }, "crash-injection: total ?, failed 0 and 0 failure(s) do not match 41 case(s), 0 failing"],
  ])("%s is refused", (_name, over, problem) => {
    expect(verdict(injection(CASES, over))).toContain(problem);
  });

  it("no crash-injection record is refused", () => {
    expect(verdict(undefined)).toContain("no crash-injection cases recorded");
  });
});

describe("backendVerdict — the recommended arm", () => {
  const armProblem = (problems) => problems.filter((p) => p.startsWith("recommendation.arm") || p.startsWith("no recommendation.arm"));

  it.each(["jsonlPacked", "jsonlLoose"])("%s, admissible, its cases passing by evidence, passes", (arm) => {
    expect(backendVerdict(doc({ recommendation: recommend(arm) }))).toEqual([]);
  });

  it("all 41 cases passing does not admit jsonlPacked recorded inadmissible", () => {
    const admissibility = { ...ADMISSIBLE, jsonlPacked: { admissible: false } };
    expect(backendVerdict(doc({ admissibility }))).toEqual(['recommendation.arm "jsonlPacked" is not admissible (admissibility.jsonlPacked.admissible is false)']);
  });

  it.each([
    ["\"not measured\"", "not measured", '"not measured"'],
    ["the string \"true\"", "true", '"true"'],
  ])("an admissibility of %s is refused", (_name, admissible, shown) => {
    const admissibility = { ...ADMISSIBLE, jsonlPacked: { admissible } };
    expect(backendVerdict(doc({ admissibility }))).toEqual([`recommendation.arm "jsonlPacked" is not admissible (admissibility.jsonlPacked.admissible is ${shown})`]);
  });

  it.each([
    ["no admissibility entry for the arm", { jsonlLoose: { admissible: true } }],
    ["no admissibility record", undefined],
  ])("%s is refused", (_name, admissibility) => {
    expect(backendVerdict(doc({ admissibility }))).toEqual(['recommendation.arm "jsonlPacked" is not admissible (admissibility.jsonlPacked.admissible is missing)']);
  });

  it.each([
    ["missing", undefined],
    ["blank", " "],
    ["not a string", 1],
  ])("an arm that is %s is refused", (_name, arm) => {
    expect(backendVerdict(doc({ recommendation: recommend(arm) }))).toEqual(["no recommendation.arm — the recommended backend arm is not named"]);
  });

  it.each(["gitSystem", "gitWithJsonlFallback", "jsonlFast", "packed"])("an arm %s that is not a measured JSONL arm is refused", (arm) => {
    expect(backendVerdict(doc({ recommendation: recommend(arm) }))).toEqual([`recommendation.arm "${arm}" is not a measured arm (jsonlLoose, jsonlPacked)`]);
  });

  it("an admissible record contradicted by the arm's own crash evidence is refused", () => {
    const i = CASES.findIndex((c) => c.arm === "packed" && c.boundary === "append_torn:8");
    const problems = verdict(injection(withCase(i, { observed: "torn" })));
    expect(armProblem(problems)).toEqual(['recommendation.arm "jsonlPacked" is recorded admissible, but 1 of its 15 required crash case(s) did not pass by evidence (packed/capture/append_torn:8)']);
  });

  it("a required case of the arm that did not run, or failed, counts against it", () => {
    const cases = CASES.filter((c) => !(c.arm === "packed" && c.boundary === "none")).map((c) => (c.arm === "packed" && c.boundary === "compact_after_rename" ? { ...c, pass: false } : c));
    const problems = verdict(injection(cases, { failed: 1, failures: [{}] }));
    expect(armProblem(problems)).toEqual(['recommendation.arm "jsonlPacked" is recorded admissible, but 2 of its 15 required crash case(s) did not pass by evidence (packed/capture/none, packed/compact/compact_after_rename)']);
  });

  it("another arm's failing case is a matrix problem, not the selected arm's", () => {
    const i = CASES.findIndex((c) => c.arm === "loose" && c.boundary === "gc_mid_unlink");
    const problems = verdict(injection(withCase(i, { invariantsOk: false })));
    expect(problems).toContain("crash-injection: case loose/compact/gc_mid_unlink recorded pass, but invariants did not hold");
    expect(armProblem(problems)).toEqual([]);
  });
});
