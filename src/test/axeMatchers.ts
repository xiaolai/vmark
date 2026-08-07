/**
 * Purpose: opt-in registration of the `vitest-axe` matchers, for the five
 *   `*.a11y.test.tsx` suites that actually assert on accessibility.
 *
 * This used to live in `src/test/setup.ts`, which every test file in the app
 * tier loads. That meant all ~1,436 of them paid to import axe-core — by a
 * wide margin the heaviest thing in that setup — so that 5 could call
 * `toHaveNoViolations()`. Setup was ~0.78s per file across the suite.
 *
 * Importing this module has the same effect the global setup had: `expect` is
 * extended at import time, which is before any test body in the importing file
 * runs. Forgetting the import is loud, not silent — the matcher is simply
 * undefined and the assertion fails immediately with an unknown-matcher error.
 *
 * `vitest-axe/extend-expect` is the type-only half: it augments `Vi.Assertion`
 * so `toHaveNoViolations()` type-checks. Keep both — the runtime `expect.extend`
 * alone leaves the call site untyped.
 *
 * @coordinates-with src/test/setup.ts — the global setup this was lifted out of
 * @module test/axeMatchers
 */
import { expect } from "vitest";
import "vitest-axe/extend-expect";
import * as axeMatchers from "vitest-axe/matchers";

expect.extend(axeMatchers);
