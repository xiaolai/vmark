/**
 * Purpose: the async-wait budgets for the test suite — one per class of wait,
 *   and no ad-hoc numbers at call sites.
 *
 * There are TWO, because there are two costs. `ASYNC_IMPORT_WAIT` is the
 * general budget `setup.ts` feeds to Testing Library's
 * `configure({ asyncUtilTimeout })`, covering every `waitFor`/`findBy*` in the
 * codebase (`vi.waitFor` has no global equivalent, so those call sites pass it
 * explicitly). `SURFACE_IMPORT_WAIT` and its paired test timeout cover the much
 * more expensive wait on the real Tiptap editor surface — see their own note.
 *
 * Why any of them exist: 1000ms (vitest's default) is a WALL-CLOCK budget, and
 * the full suite runs ~1450 files across every core at once. A wait on a
 * dynamic import can miss that budget because the worker was descheduled rather
 * than because the code is wrong — three consecutive full runs failed on three
 * disjoint sets of such tests, every one passing in isolation. Raising the
 * bound costs nothing on the passing path and still fails a real regression,
 * just later.
 *
 * Budgets live here rather than at call sites so a class is sized once. Two
 * separate tests invented their own numbers for the surface wait (10s, then
 * 15s) and both flaked, because neither was sized against the ~10.7s the
 * import actually costs.
 *
 * These are LIVENESS bounds. A performance BUDGET — "this must finish in N ms"
 * — is a different claim and lives in `./timeBudget`, enforced only under
 * `PERF=1`.
 *
 * @coordinates-with src/test/timeBudget.ts — the performance-budget twin
 * @module test/waitBudget
 */

/** Wait budget, in the options shape `vi.waitFor` takes. */
export const ASYNC_IMPORT_WAIT = { timeout: 5000 } as const;

/**
 * The budget for waiting on the REAL Tiptap/ProseMirror editor surface.
 *
 * This is a distinct class from `ASYNC_IMPORT_WAIT`, and conflating them is
 * what kept it flaking. `lazySurfaces.test.ts` measures the bare
 * `import("./adapters/markdownSurface")` at **~10.7s alone on an idle
 * machine** — Vite transforms that whole module graph inside the test. Any
 * budget in the single-digit seconds is therefore not "generous", it is below
 * the measured cost of the thing being awaited, and every point of extra load
 * turns it red.
 *
 * Two instances proved it: `Editor.test.tsx` sat at 10s and failed ~1 run in 5
 * at the DEFAULT pool width; raised to 15s it still failed in a full-suite run
 * at 16 workers. Numbers were being nudged instead of sized.
 *
 * Both constants are LIVENESS bounds, never performance assertions — the same
 * distinction `vitest.config.ts` draws for `testTimeout`. A surface that never
 * arrives still fails; a wrong module still fails instantly on its assertion.
 * A bigger number only stops a busy machine being reported as a hang.
 *
 * They come in a PAIR, and the test timeout must be the larger of the two. A
 * `waitFor` budget above its enclosing test's timeout is dead: the test is
 * killed first and reports a bare "timed out in 20000ms" instead of the
 * `waitFor` message naming what never appeared.
 */
export const SURFACE_IMPORT_WAIT = { timeout: 45_000 } as const;

/** Headroom between the wait budget and the test timeout that encloses it, so
 *  the `waitFor` message (which names what never appeared) wins the race
 *  against the bare "test timed out" one. */
const SURFACE_IMPORT_HEADROOM_MS = 15_000;

/**
 * Per-test timeout for a test that awaits the real editor surface.
 *
 * DERIVED, not declared. As two independent literals the ordering invariant
 * lived only in the prose above, and a later edit to either could invert it —
 * at which point every test in this class reports "timed out in Ns" instead of
 * naming the element that never arrived, and the useful diagnostic is gone.
 */
export const SURFACE_IMPORT_TEST_TIMEOUT_MS =
  SURFACE_IMPORT_WAIT.timeout + SURFACE_IMPORT_HEADROOM_MS;
