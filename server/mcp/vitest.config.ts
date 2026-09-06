import { defineConfig } from 'vitest/config';
// The workspace-wide liveness bound. Shared so this number cannot drift
// from the root tiers again — it already had, three times over.
import { LIVENESS_TIMEOUT_MS } from '../../vitest.shared.ts';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // Liveness bound, not a performance assertion — see the root
    // `vitest.config.ts`. Kept in step so the three projects cannot drift.
    testTimeout: LIVENESS_TIMEOUT_MS,
    hookTimeout: LIVENESS_TIMEOUT_MS,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts',
        'src/types.ts',           // Type definitions only
        'src/bridge/types.ts',    // Type definitions only
      ],
      // HONEST THRESHOLDS (WI-7). These were 90/70/90/90 against an actual
      // 72.0/68.0/73.3/71.6 — a gate that could only ever fail, and that never
      // ran anyway because root `test:sidecar` invoked `vitest run` with no
      // coverage flag. Both halves are fixed: `test:sidecar` now runs coverage,
      // and the numbers below are what the package genuinely measures. They
      // RATCHET UP ONLY — raising real coverage means raising these; lowering
      // one needs a stated reason.
      //
      // Why the global floor sits below 86 while `src/tools` is pinned at 100:
      // `cli.ts` measures 0% and cannot measure higher. It is the MCP SDK
      // boundary, exercised end to end by
      // `__tests__/integration/sdkBoundary.test.ts`, which spawns the built
      // binary — a CHILD process v8 coverage cannot instrument. Excluding the
      // file would hide it; leaving it to drag the global number alone would
      // hand ~15 points of silent slack to every other file. The per-directory
      // thresholds hold each area at its real value instead.
      //
      // Raised 2026-07-28 with the dead-code deletion (audit §4). Deleting
      // `server.ts`'s eight unused arg extractors took that file from 62.5% to
      // 100%; deleting the resource pipeline took its ONLY consumers with it.
      // Note the second-order effect the ratchet exists to catch: removing
      // well-covered code (`toMcpContents`, `createResourceHandler`) SHRANK
      // `src/utils`'s denominator and pushed its branch rate DOWN, from 93.1 to
      // 92.72. That was closed by covering `portFile.ts`'s real gaps (the three
      // non-darwin `getAppDataDir` arms, the VMARK_DEBUG error path, the
      // default `warn`) rather than by lowering the floor.
      //
      // Raised again 2026-07-28 by the websocket.ts split (831 -> 299, extracted
      // into websocketConfig / connection / authHandshake / reconnect /
      // pendingRequests / requestQueue / rateLimiter / wsProtocol). A pure
      // refactor: the test file is untouched, but splitting one file into nine
      // changes the denominators, so the numbers are re-read and re-pinned.
      // Global 85.96 -> 86.53 stmts, 82.73 -> 86.41 funcs, 85.45 -> 86.03 lines;
      // bridge 85.76 -> 87.27 / 91.66 -> 94.62 / 85.52 -> 87.00.
      //
      // Branches moved the other way by a hundredth (83.35 -> 83.33 global,
      // 78.75 -> 78.61 bridge) and the floors below are NOT lowered for it:
      // the UNCOVERED branch count is unchanged (115 before, 115 after) — the
      // restructure removed one *covered* branch from the denominator. No test
      // lost coverage, so 83/78 stand.
      //
      // Raised again 2026-07-28 by the per-client credential work: the
      // identity heuristic moved out of the 0%-covered `cli.ts` into
      // `utils/clientIdentity.ts` and got real tests, so ~48 uncoverable
      // lines left the denominator covered instead of uncovered. That is a
      // genuine win, not an accounting one — every branch of the detection
      // (and of the credential reader) is now asserted — so the floors move
      // with it.
      //
      // Raised again 2026-08-04 by WI-15 (MCP contracts generated from one set
      // of per-operation zod schemas). Two effects, both real coverage rather
      // than accounting: `operationSchemas.ts` arrives fully exercised (every
      // tool send now validates through `checkOutboundRequest`), and the new
      // `operationSends.test.ts` drives every (tool, action) pair through the
      // real handlers — which is why `src/tools` branch coverage jumped from
      // 89.44 to 96.46.
      //
      // Actual at the time of writing: 88.22 / 89.05 / 87.50 / 87.98 global,
      // tools 100/96.46/100/100, utils 100/99.21/100/100,
      // bridge 88.37/80.00/95.09/88.08.
      thresholds: {
        statements: 88,
        branches: 89,
        functions: 87,
        lines: 87,
        'src/tools/**': {
          statements: 100,
          branches: 96,
          functions: 100,
          lines: 100,
        },
        'src/utils/**': {
          statements: 100,
          branches: 99,
          functions: 100,
          lines: 100,
        },
        'src/bridge/**': {
          statements: 88,
          branches: 80,
          functions: 95,
          lines: 88,
        },
      },
    },
  },
});
