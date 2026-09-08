#!/usr/bin/env node
/**
 * The verdict on one vitest JSON report: did the suites a DoD names actually
 * RUN, and did they pass?
 *
 * This was ~18 lines of JavaScript embedded in a `node -e '…'` string inside
 * `scripts/check-ui-phase.sh`. Code inside a shell string is checked by
 * nothing here — not eslint, not the gates tier, not `pnpm typecheck` — and
 * two of its branches ("no suite matches on disk", "suites failed to run")
 * were unreachable from any test because the shell harness could not construct
 * them. It is a module now, and `scripts/vitestReportVerdict.test.mjs` covers
 * every branch (audit R2 #94).
 *
 * It lives directly in `scripts/`, not in `scripts/lib/`, and that is LOAD
 * BEARING: `scripts/knip-production.json` makes `scripts/*.{ts,mjs}` a
 * production ROOT, while `scripts/lib/**` is reachable only by IMPORT. A shell
 * script spawning `node <path>` is not an import, so under `lib/` this module
 * is unreachable by construction and `check-test-only-modules` correctly
 * reports it as one only tests reach. `scripts/dod-syntax.mjs` — invoked the
 * same way by the phase checkers — sits here for the same reason.
 *
 * The rules it encodes, each of which cost a round to learn:
 *   - vitest's EXIT STATUS counts. A run that wrote a green-looking report and
 *     then died (a reporter crash, a teardown failure, an unhandled rejection)
 *     was reported as successful (audit R2 #96).
 *   - Suites are compared BY NAME, never by count. `find`'s `-name` and
 *     vitest's substring filter are different matchers, so a filter that ran a
 *     different set of the same size passed (audit R2 #97).
 *   - A suite whose every case is skipped reports `status: "passed"` with only
 *     skipped assertions, and vanishes into a green total beside its siblings
 *     (audit 20260907 #66). Every suite must have a passing case and no
 *     failing one.
 *   - An EMPTY expectation is a failure, not a vacuous pass: it means the
 *     filter matched nothing on disk, so the phase asserted nothing.
 *
 * Usage: node scripts/vitestReportVerdict.mjs <report.json> <expected-suites> <vitest-exit-status>
 *   <expected-suites> is a newline-separated list of repo-relative paths.
 *   exit 0  every expectation held
 *   exit 1  one or more reasons, printed on stdout, semicolon-separated
 *
 * @coordinates-with scripts/check-ui-phase.sh — the caller
 * @coordinates-with scripts/vitestReportVerdict.test.mjs — the self-test
 * @module scripts/vitestReportVerdict
 */
import { readFileSync } from "node:fs";

/**
 * Every reason this run is not the deliverable, in report order. An empty
 * array is the only green.
 *
 * @param {unknown} report parsed vitest JSON report
 * @param {string[]} want repo-relative suite paths the filter matched on disk
 * @param {number} vitestStatus vitest's own exit code
 * @param {string} root prefix stripped from absolute suite names
 */
export function verdictReasons(report, want, vitestStatus, root) {
  const reasons = [];
  const suites = Array.isArray(report?.testResults) ? report.testResults : [];
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const rel = (name) => (String(name).startsWith(prefix) ? String(name).slice(prefix.length) : String(name));
  const ran = new Set(suites.map((t) => rel(t.name)));
  if (vitestStatus !== 0) reasons.push(`vitest exited ${vitestStatus}`);
  if (want.length === 0) reasons.push("no suite matches on disk");
  for (const f of want) if (!ran.has(f)) reasons.push(`${f} did not run`);
  if (Number(report?.numFailedTestSuites) > 0) {
    reasons.push(`${report.numFailedTestSuites} suite(s) failed to run`);
  }
  for (const t of suites) {
    const statuses = (Array.isArray(t?.assertionResults) ? t.assertionResults : []).map((a) => a?.status);
    if (statuses.includes("failed")) {
      reasons.push(`${rel(t.name)}: ${statuses.filter((s) => s === "failed").length} failed test(s)`);
    } else if (!statuses.includes("passed")) {
      reasons.push(`${rel(t.name)}: no passing test (${statuses.length ? statuses.join(", ") : "empty"})`);
    }
  }
  return reasons;
}

function main(argv) {
  const [reportPath, expected, status] = argv;
  if (reportPath === undefined || expected === undefined || status === undefined) {
    console.log("vitestReportVerdict: needs <report.json> <expected-suites> <vitest-exit-status>");
    return 1;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    // An unreadable report is a finding, with its reason — not a silent
    // "report unreadable" from a swallowed stack trace.
    console.log(`report unreadable (${reportPath}): ${error.message}`);
    return 1;
  }
  const reasons = verdictReasons(report, expected.split("\n").filter(Boolean), Number(status), process.cwd());
  if (reasons.length === 0) return 0;
  console.log(reasons.join("; "));
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("vitestReportVerdict.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
