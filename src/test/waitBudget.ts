/**
 * Purpose: the one async-wait budget for the test suite.
 *
 * `setup.ts` feeds it to Testing Library's `configure({ asyncUtilTimeout })`,
 * which covers every `waitFor`/`findBy*` in the codebase. `vi.waitFor` has no
 * global equivalent, so those call sites pass this object explicitly.
 *
 * Why it exists: 1000ms (vitest's default) is a WALL-CLOCK budget, and the full
 * suite runs ~1450 files across every core at once. A wait on a dynamic import
 * can miss that budget because the worker was descheduled rather than because
 * the code is wrong — three consecutive full runs failed on three disjoint sets
 * of such tests, every one passing in isolation. Raising the bound costs
 * nothing on the passing path and still fails a real regression, just later.
 *
 * @module test/waitBudget
 */

/** Wait budget, in the options shape `vi.waitFor` takes. */
export const ASYNC_IMPORT_WAIT = { timeout: 5000 } as const;
