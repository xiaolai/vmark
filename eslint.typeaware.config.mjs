/**
 * Type-aware lint config — the ONLY config in this repo that builds a
 * TypeScript `Program`, and therefore the only one that can see across files.
 *
 * It is deliberately separate from `eslint.config.js`. That one is syntactic,
 * runs in seconds, and sits in `check:fast`; this one costs ~4 minutes because
 * it type-checks 1,510 files, and belongs in `check:static` only. Merging them
 * would make the inner loop unusable, which is how a slow gate ends up disabled.
 *
 * RULE SELECTION IS MEASURED, NOT TASTEFUL. The full `recommendedTypeChecked`
 * preset reports 420 violations here, of which 183 are
 * `no-unnecessary-type-assertion` — a stylistic cleanup that would bury the
 * findings that matter. The rules enabled below are the ones whose violations
 * are RUNTIME DEFECTS:
 *
 *   no-floating-promises      an unawaited promise in an app whose every
 *                             backend call is `await invoke(...)`: the failure
 *                             is a silently swallowed rejection.
 *   no-misused-promises       an async function passed where a void callback is
 *                             expected — the caller cannot await it, so errors
 *                             vanish and ordering is not what it reads as.
 *   await-thenable            awaiting a non-promise: always a mistake.
 *   no-base-to-string         the `"[object Object]"` class. `.claude/rules/50`
 *                             records four of these SHIPPING to users when
 *                             `String(error)` met a typed `CommandError`; the
 *                             bespoke ratchet catches it only at command
 *                             boundaries, and this rule catches it everywhere.
 *   restrict-plus-operands    string/number confusion in arithmetic.
 *   prefer-promise-reject-errors  rejecting with a non-Error loses the stack.
 *
 * Adding a rule here means re-measuring the baseline; see
 * `scripts/check-type-aware.mjs`.
 */
import tseslint from "typescript-eslint";

/**
 * The rules this gate OWNS, as a set — exported so `scripts/check-type-aware.mjs`
 * can filter its report to exactly these and nothing else.
 *
 * This is load-bearing. Running eslint with `--config <this> --no-config-lookup`
 * still reports `react-hooks/*` findings (76 of them, at severity 2), which
 * `pnpm lint` already owns. Baselining those here would double-count them under
 * two gates and hand this one violations it never declared — so the report is
 * filtered by this list rather than trusted wholesale. Severity filtering does
 * NOT substitute: the leaked rules arrive as errors too.
 */
export const TYPE_AWARE_RULES = [
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/await-thenable",
  "@typescript-eslint/no-base-to-string",
  "@typescript-eslint/restrict-plus-operands",
  "@typescript-eslint/prefer-promise-reject-errors",
];

export default tseslint.config({
  files: ["src/**/*.{ts,tsx}"],
  // `tsconfig.json` excludes these, so the Program has no types for them and
  // the parser would error rather than lint. They are not typechecked by
  // anything today — see AGENTS.md — and closing that is separate work.
  ignores: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/__tests__/**",
    "src/test/**",
    "src/bench/**",
  ],
  extends: [tseslint.configs.base],
  languageOptions: {
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
  },
  rules: {
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-base-to-string": "error",
    "@typescript-eslint/restrict-plus-operands": "error",
    "@typescript-eslint/prefer-promise-reject-errors": "error",
  },
});
