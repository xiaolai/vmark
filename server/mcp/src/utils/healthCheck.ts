/**
 * `--health-check`: can this binary construct its server and register the tool
 * surface it advertises, with no VMark connection?
 *
 * Lived inside `cli.ts` until that entry point crossed the repo's 300-line
 * limit. It is a self-contained self-test, not argument handling, and moving it
 * out is the split `check-file-size` was asking for. The behaviour is unchanged:
 * `cli.ts` still calls it before anything else runs, and the static imports
 * below are still evaluated first — so an import failure crashes the process
 * before this function is reached, which is why there is no import self-test
 * here (a dynamic re-import could only return the already-cached module).
 *
 * It sets `process.exitCode` rather than calling `process.exit()`: stdout is
 * ASYNCHRONOUS when it is a pipe, and every caller reads it through one — the
 * app's `useMcpHealthCheck.ts` JSON.parses the result — so exiting immediately
 * after a `console.log` can truncate the report (audit R3 #195).
 *
 * @coordinates-with src/cli.ts — the only caller
 * @coordinates-with src/index.ts — TOOL_REGISTRY, the surface this verifies
 * @coordinates-with src/hooks/useMcpHealthCheck.ts — the app-side consumer of this JSON
 * @module utils/healthCheck
 */
import { createVMarkMcpServer, EXPECTED_TOOL_COUNT, TOOL_REGISTRY } from '../index.js';

export async function runHealthCheck(version: string): Promise<void> {
  // Note: no import self-test here. The server module is statically imported
  // below (hoisted, evaluated before any of this runs), so an import failure
  // crashes the process before runHealthCheck — a dynamic re-import could
  // only ever return the already-cached module and can't catch anything.
  try {
    // 1. Create a mock bridge that doesn't connect (implements Bridge interface)
    const mockBridge = {
      send: async (): Promise<never> => {
        throw new Error('Health check mode - no VMark connection');
      },
      isConnected: (): boolean => false,
      connect: async (): Promise<void> => {},
      disconnect: async (): Promise<void> => {},
      onConnectionChange: (): (() => void) => () => {},
    };

    // 2. Can we instantiate the server and list tools?
    const server = createVMarkMcpServer(mockBridge, { version });
    const allTools = server.listTools();

    // 3. Validate the registered tools are EXACTLY the declared surface.
    //
    // A count comparison passes on compensating errors — `browser` registering
    // zero and `document` registering two keeps the total right — and it says
    // nothing about NAMES, so a tool registered under the wrong one satisfied
    // it too (audit R3 #197). The expectation comes from `TOOL_REGISTRY`, which
    // is already the single source of truth `EXPECTED_TOOL_COUNT` derives from,
    // so this restates no contract; it reads the same one more precisely.
    const expected = TOOL_REGISTRY.map((t) => t.name as string);
    const got = allTools.map((t) => t.name);
    const duplicates = got.filter((n, i) => got.indexOf(n) !== i);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate tool registration(s): ${[...new Set(duplicates)].join(', ')}`);
    }
    const missing = expected.filter((n) => !got.includes(n));
    const unexpected = got.filter((n) => !expected.includes(n));
    if (missing.length > 0 || unexpected.length > 0 || got.length !== EXPECTED_TOOL_COUNT) {
      throw new Error(
        `Tool surface mismatch: got ${got.length} [${got.join(', ')}], expected ${EXPECTED_TOOL_COUNT} ` +
        `[${expected.join(', ')}]${missing.length ? `; missing: ${missing.join(', ')}` : ''}` +
        `${unexpected.length ? `; unexpected: ${unexpected.join(', ')}` : ''}. ` +
        `TOOL_REGISTRY in index.ts and the registrations disagree — a register function registered zero or two tools, or one under the wrong name.`
      );
    }

    // 4. Validate tool schemas are valid
    for (const tool of allTools) {
      if (!tool.name || !tool.inputSchema) {
        throw new Error(`Invalid tool definition: ${tool.name}`);
      }
    }

    // Success - output structured result. `resourceCount` is a constant 0 (the
    // pruned surface exposes no MCP resources); the field stays because the
    // app's health check declares it required and renders it in Settings →
    // Integrations (src/hooks/useMcpHealthCheck.ts).
    const result = {
      status: 'ok',
      version,
      toolCount: allTools.length,
      resourceCount: 0,
      tools: allTools.map((t) => t.name),
    };

    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
  } catch (error) {
    const result = {
      status: 'error',
      version,
      error: error instanceof Error ? error.message : String(error),
    };

    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}
