#!/usr/bin/env node
/**
 * check-test-timer-isolation — fail when a test can race a production timer.
 *
 * ## The defect this exists for
 *
 * `useUpdateSync` scheduled a fire-and-forget `setTimeout(.., 100)` on mount
 * that emitted an event. Its test asserted `expect(emitMock).not
 * .toHaveBeenCalled()`. In isolation the assertion ran well inside 100 ms and
 * passed 3/3; under full-suite parallel load an `act()` block exceeded it, the
 * timer fired between the mock reset and the assertion, and `check:all` went
 * red on a test that had nothing to do with the change being made.
 *
 * That is not flakiness in the "computers are mysterious" sense. It is a test
 * asserting on state that a wall-clock timer can change, without controlling
 * the clock — a structural property, visible without running anything.
 *
 * ## Why a gate rather than just fixing the three
 *
 * The failure mode is INVISIBLE: a test file that forgot `vi.useFakeTimers()`
 * looks exactly like one that never needed it, and the suite passes on most
 * runs either way. Nothing goes red until CI happens to be slow — which is the
 * worst possible moment and the least informative signal.
 *
 * ## What counts as a violation (all four, deliberately narrow)
 *
 *   1. The production sibling schedules a FIRE-AND-FORGET timer. An `await`ed
 *      timer, a returned one, or the `await new Promise(r => setTimeout(r, n))`
 *      sleep idiom is deterministic — the awaiting code decides when it
 *      resumes — so those do not count.
 *   2. The test file never calls `vi.useFakeTimers()`.
 *   3. The test file has `await` or `async` tests. A fully synchronous test
 *      body cannot be interleaved by any timer, however short. (This is what
 *      excludes MathInlineNodeView's `setTimeout(fn, 0)`.)
 *   4. A test file exists at all.
 *
 * A file that legitimately wants real timers opts out with the marker
 * `// timer-isolation: intentional real timers — <reason>`. Deliberately NOT
 * `vi.useRealTimers()`: that call is the cleanup half of the fake-timer
 * pattern and appears in nearly every file that fakes the clock, so accepting
 * it would let a file pass whose `useFakeTimers()` had been deleted — which is
 * exactly what mutation-checking this gate revealed.
 */
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";

const SRC = "src";

/** Timers whose firing time the surrounding code does NOT control. */
function fireAndForgetTimers(source) {
  const hits = [];
  const re = /(await\s+|return\s+)?(?:window\.)?(setTimeout|setInterval)\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) continue; // awaited or returned -> deterministic
    // A timer inside a `new Promise(...)` executor is deterministic: whoever
    // awaits (or races) that promise decides when execution resumes. Covers
    // both the sleep idiom `new Promise(r => setTimeout(r, n))` and the
    // timeout-guard idiom `new Promise((_, reject) => setTimeout(reject, n))`.
    //
    // Matched by looking back for `new Promise` with no statement terminator
    // in between, rather than by balancing parentheses: an executor's own
    // parameter list contains `)`, which defeated the naive lookbehind.
    const before = source.slice(Math.max(0, m.index - 200), m.index);
    const promiseAt = before.lastIndexOf("new Promise");
    if (promiseAt !== -1 && !before.slice(promiseAt).includes(";")) continue;
    hits.push(source.slice(0, m.index).split("\n").length);
  }
  return hits;
}

const violations = [];
const files = globSync(`${SRC}/**/*.{ts,tsx}`, { exclude: (p) => p.includes(".test.") });

for (const prod of files) {
  const source = readFileSync(prod, "utf8");
  const timers = fireAndForgetTimers(source);
  if (timers.length === 0) continue;

  const base = prod.replace(/\.tsx?$/, "");
  const testFile = [`${base}.test.ts`, `${base}.test.tsx`].find((p) => existsSync(p));
  if (!testFile) continue;

  const test = readFileSync(testFile, "utf8");
  if (test.includes("useFakeTimers")) continue;
  // NOT `useRealTimers` — that is the CLEANUP half of the fake-timer pattern
  // and lives in almost every file that fakes the clock, so accepting it made
  // this gate pass on a file whose `useFakeTimers()` had been deleted. (Found
  // by mutation-checking the gate itself: removing the fix left the gate
  // green.) An intentional opt-out has to be a statement nothing else looks
  // like, and has to carry a reason.
  if (/timer-isolation:\s*intentional real timers\s*—/.test(test)) continue;
  // A synchronous test body cannot be interleaved by a timer.
  if (!/\bawait\b/.test(test) && !/async\s*\(/.test(test)) continue;

  violations.push({ prod, testFile, lines: timers });
}

if (violations.length > 0) {
  console.error(
    `\n❌ ${violations.length} test file(s) can race a production timer:\n`
  );
  for (const v of violations) {
    console.error(`   ${v.testFile}`);
    console.error(
      `     races ${v.prod} (fire-and-forget timer at line ${v.lines.join(", ")})`
    );
  }
  console.error(
    "\n   These tests have async bodies and never control the clock, so a\n" +
      "   production timer can fire between a mock reset and an assertion —\n" +
      "   passing locally and failing when CI is slow.\n" +
      "\n   Fix: call vi.useFakeTimers() in beforeEach and vi.useRealTimers()\n" +
      "   in afterEach. If real timers are genuinely wanted, opt out with\n" +
      "   // timer-isolation: intentional real timers — <reason>\n"
  );
  process.exit(1);
}

console.log(
  `✅ Test-timer isolation: no async test races a fire-and-forget production timer ` +
    `(${files.length} production files scanned).`
);
