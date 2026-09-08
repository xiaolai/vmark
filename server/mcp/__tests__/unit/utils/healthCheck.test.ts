/**
 * Tests for `--health-check` (audit R3 cleanup).
 *
 * `runHealthCheck` moved out of `cli.ts` when that entry point crossed the
 * 300-line limit, and landed in `src/utils/**`, where coverage is required to
 * be total. It arrived untested, so the split silently lowered the tier's
 * coverage — closed here by covering the code, which is what this config's own
 * history says to do rather than moving the floor.
 *
 * What is worth asserting, beyond line coverage: the surface check must fail on
 * a WRONG NAME and on a DUPLICATE, not merely on a wrong count. A count
 * comparison passes on compensating errors (one register function contributing
 * zero while another contributes two), which is the defect audit R3 #197
 * replaced — so a test that only checks the happy path would let that
 * regression back in.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { listToolsMock, seenBridge } = vi.hoisted(() => ({
  listToolsMock: vi.fn(),
  seenBridge: { current: undefined as unknown },
}));

vi.mock('../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/index.js')>();
  return {
    ...actual,
    createVMarkMcpServer: vi.fn((bridge: unknown) => {
      seenBridge.current = bridge;
      return { listTools: listToolsMock };
    }),
  };
});

import { runHealthCheck } from '../../../src/utils/healthCheck.js';
import { TOOL_REGISTRY, EXPECTED_TOOL_COUNT } from '../../../src/index.js';

/** The exact surface the registry declares — what a healthy run reports. */
const healthy = (): { name: string; inputSchema: object }[] =>
  TOOL_REGISTRY.map((t) => ({ name: t.name as string, inputSchema: {} }));

let log: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  listToolsMock.mockReset();
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  err = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  log.mockRestore();
  err.mockRestore();
  process.exitCode = undefined;
});

/** The single JSON document the run printed, parsed. */
function reported(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
}

describe('runHealthCheck', () => {
  it('reports ok, on stdout, with the tools it found', async () => {
    listToolsMock.mockReturnValue(healthy());

    await runHealthCheck('9.9.9');

    const result = reported(log);
    expect(result.status).toBe('ok');
    expect(result.version).toBe('9.9.9');
    expect(result.toolCount).toBe(EXPECTED_TOOL_COUNT);
    expect(result.tools).toEqual(TOOL_REGISTRY.map((t) => t.name));
    // `resourceCount` is declared required by the app-side consumer.
    expect(result.resourceCount).toBe(0);
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('sets exitCode rather than exiting, so a piped stdout can drain', async () => {
    listToolsMock.mockReturnValue(healthy());
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await runHealthCheck('1.0.0');

    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  // The bridge this passes to the server is the whole point of `--health-check`:
  // it proves the surface can be built with NO VMark connection. Nothing in the
  // run calls its methods, so only asserting its contract exercises them — and
  // a `send` that silently resolved would make the health check a live client.
  it('hands the server a bridge that refuses to send and reports itself disconnected', async () => {
    listToolsMock.mockReturnValue(healthy());

    await runHealthCheck('1.0.0');

    const bridge = seenBridge.current as {
      send: () => Promise<never>;
      isConnected: () => boolean;
      connect: () => Promise<void>;
      disconnect: () => Promise<void>;
      onConnectionChange: () => () => void;
    };
    await expect(bridge.send()).rejects.toThrow('Health check mode - no VMark connection');
    expect(bridge.isConnected()).toBe(false);
    await expect(bridge.connect()).resolves.toBeUndefined();
    await expect(bridge.disconnect()).resolves.toBeUndefined();
    expect(bridge.onConnectionChange()).toBeTypeOf('function');
    expect(bridge.onConnectionChange()()).toBeUndefined();
  });

  it('fails on a tool registered under the WRONG NAME, which a count check would pass', async () => {
    const wrong = healthy();
    wrong[0] = { name: 'not-a-real-tool', inputSchema: {} };
    listToolsMock.mockReturnValue(wrong);

    await runHealthCheck('1.0.0');

    const result = reported(err);
    expect(result.status).toBe('error');
    expect(String(result.error)).toContain('Tool surface mismatch');
    expect(String(result.error)).toContain('missing:');
    expect(String(result.error)).toContain('unexpected: not-a-real-tool');
    expect(process.exitCode).toBe(1);
  });

  it('fails on a DUPLICATE registration, which also keeps the count plausible', async () => {
    const dupes = healthy();
    dupes[1] = { name: dupes[0].name, inputSchema: {} };
    listToolsMock.mockReturnValue(dupes);

    await runHealthCheck('1.0.0');

    const result = reported(err);
    expect(String(result.error)).toContain('Duplicate tool registration(s)');
    expect(String(result.error)).toContain(dupes[0].name);
    expect(process.exitCode).toBe(1);
  });

  it('fails when a register function contributed nothing', async () => {
    listToolsMock.mockReturnValue(healthy().slice(1));

    await runHealthCheck('1.0.0');

    expect(String(reported(err).error)).toContain('Tool surface mismatch');
    expect(process.exitCode).toBe(1);
  });

  // The complement of the case above: nothing MISSING, something EXTRA. It is
  // the one arm of the mismatch message neither other failure reaches, and it
  // is the shape a register function that registers twice produces.
  it('fails on an extra tool with the whole declared surface present', async () => {
    listToolsMock.mockReturnValue([...healthy(), { name: 'surprise-tool', inputSchema: {} }]);

    await runHealthCheck('1.0.0');

    const message = String(reported(err).error);
    expect(message).toContain('unexpected: surprise-tool');
    expect(message).not.toContain('missing:');
    expect(process.exitCode).toBe(1);
  });

  it('fails on a tool with no input schema', async () => {
    const schemaless = healthy().map((t) => ({ ...t }));
    delete (schemaless[0] as { inputSchema?: object }).inputSchema;
    listToolsMock.mockReturnValue(schemaless);

    await runHealthCheck('1.0.0');

    expect(String(reported(err).error)).toContain('Invalid tool definition');
    expect(process.exitCode).toBe(1);
  });

  it('reports a thrown non-Error as a string rather than crashing the report', async () => {
    listToolsMock.mockImplementation(() => {
      throw 'listTools exploded';
    });

    await runHealthCheck('1.0.0');

    const result = reported(err);
    expect(result.status).toBe('error');
    expect(result.error).toBe('listTools exploded');
    expect(result.version).toBe('1.0.0');
    expect(process.exitCode).toBe(1);
  });
});
