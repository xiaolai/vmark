/**
 * Stryker break-threshold canary fixture — NOT app code.
 *
 * `isEven` is DELIBERATELY untested: every mutant in it survives, holding the
 * fixture's mutation score far below the `break` threshold in the sibling
 * stryker.conf.json, so the canary meta-test
 * (scripts/stryker-break-canary.test.mjs) can assert the break gate actually
 * fails the run. Do not add tests for `isEven` — a green canary here means
 * the gate stopped biting.
 */
export function add(a, b) {
  return a + b;
}

// Deliberately uncovered: its surviving mutants ARE the canary.
export function isEven(n) {
  return n % 2 === 0;
}
