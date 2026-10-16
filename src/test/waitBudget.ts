/**
 * Purpose: the async-wait budgets for the test suite — one per class of wait,
 *   and no ad-hoc numbers at call sites.
 *
 * There are TWO, because there are two costs. `ASYNC_IMPORT_WAIT` is the
 * general budget `setup.ts` feeds to Testing Library's
 * `configure({ asyncUtilTimeout })`, covering every `waitFor`/`findBy*` in the
 * codebase (`vi.waitFor` has no global equivalent, so those call sites pass it
 * explicitly). `SURFACE_IMPORT_WAIT` covers the much more expensive wait on
 * the real Tiptap editor surface — see its own note.
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
 * It is a LIVENESS bound, never a performance assertion — the same distinction
 * `vitest.config.ts` draws for `testTimeout`. A surface that never arrives
 * still fails; a wrong module still fails instantly on its assertion. A bigger
 * number only stops a busy machine being reported as a hang.
 *
 * A wait budget must stay BELOW the timeout of the test that encloses it, or
 * the test is killed first and reports a bare "timed out" instead of the
 * `waitFor` message naming what never appeared. No test sets a timeout of its
 * own (`perTestTimeouts.test.ts`), so that timeout is the tier's liveness
 * bound, `LIVENESS_TIMEOUT_MS`; the same file asserts every budget here sits
 * below it.
 *
 * The class is "a real heavy lazy chunk that Vite transforms inside the test",
 * not Tiptap alone: the GHA workflow renderer chunk (React Flow plus the
 * workflow IR) is the second member. It measured 2.4-3.6s alone on a loaded
 * machine and failed the 5s general budget in a full `check:all`, while a
 * sibling test had invented its own 15s for the same wait.
 */
export const SURFACE_IMPORT_WAIT = { timeout: 45_000 } as const;

/**
 * The budget for waiting on the WHOLE App module graph — `import("./App")`
 * via the real `main.tsx` entry.
 *
 * A third class, because it costs about twice the editor surface: the App
 * graph contains that surface and every store, service and shell around it.
 * `main.test.tsx` and `main.bootFailure.test.tsx` measured ~21s each, run
 * together, at a load average of ~30. Borrowing `SURFACE_IMPORT_WAIT` left
 * them ~2x headroom, and both failed together in a `vitest related` run on a
 * saturated machine while passing alone — the descheduled-worker failure this
 * file exists to absorb.
 *
 * Same contract as above: a LIVENESS bound, below `LIVENESS_TIMEOUT_MS`.
 */
export const APP_GRAPH_IMPORT_WAIT = { timeout: 120_000 } as const;
