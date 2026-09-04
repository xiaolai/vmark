/**
 * SDK-boundary smoke test (WI-7.4).
 *
 * Everything else in this suite talks to `VMarkMcpServer` in-process. The MCP
 * SDK boundary in `cli.ts` — `McpServer`, `registerTool`, the capabilities
 * object, `StdioServerTransport`, and the SDK's own Zod → JSON Schema
 * conversion — had NO test at all (`cli.ts`: 0% coverage), and the in-process
 * test client states outright that it "simulates MCP protocol without needing a
 * real MCP SDK client". So the one thing an AI client actually sees was the one
 * thing never exercised.
 *
 * This spawns the built binary and speaks the real protocol to it over stdio
 * with the SDK's own `Client` — the same thing `npx @modelcontextprotocol/
 * inspector --cli <binary> --method tools/list` does, minus a network fetch of
 * a 300-package dev tool on every CI run. Verified equivalent by hand against
 * `@modelcontextprotocol/inspector@0.16.8`.
 *
 * SKIPS when `dist/` has not been built, so an ad-hoc `pnpm vitest run` in a
 * clean tree still passes. The gate does not rely on that: root `test:sidecar`
 * runs `pnpm build` (plain `tsc`, ~1.7 s cold) before the suite, so this test
 * really executes in CI. It does NOT need `build:sidecar` — packaging the pkg
 * binary is the expensive step and adds nothing the stdio path exercises.
 *
 * NOTE: because the server runs in a CHILD process, v8 coverage cannot see it.
 * `cli.ts` therefore still reports 0% while being genuinely exercised here.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CLI_PATH = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const BUILT = existsSync(CLI_PATH);

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  outputSchema?: { properties?: Record<string, unknown> };
  annotations?: Record<string, unknown>;
}

const suite = BUILT ? describe : describe.skip;

suite('MCP SDK boundary (spawned dist/cli.js)', () => {
  let client: Client | undefined;

  async function connect(): Promise<ListedTool[]> {
    client = new Client({ name: 'vmark-smoke-test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [CLI_PATH],
        // The sidecar cannot reach VMark from a test, so it logs reconnect
        // warnings. Swallow them instead of polluting the reporter.
        stderr: 'ignore',
      }),
    );
    const listed = await client.listTools();
    return listed.tools as unknown as ListedTool[];
  }

  afterAll(async () => {
    // Closing the transport ends the child's stdin, which is what makes an
    // orphaned sidecar exit — the shutdown path this also happens to smoke.
    await client?.close();
  });

  it(
    'lists the full 9-tool surface with titles, annotations, and honest schemas',
    async () => {
      const tools = await connect();

      expect(tools.map((t) => t.name).sort()).toEqual([
        'browser',
        'browser_read',
        'coherence',
        'coherence_resolve',
        'document',
        'selection',
        'session',
        'workflow',
        'workspace',
      ]);

      for (const t of tools) {
        expect(t.title, t.name).toBeTruthy();
        expect(t.description, t.name).toBeTruthy();
        expect(t.annotations, t.name).toBeDefined();
        expect(t.inputSchema.required, t.name).toContain('action');
      }

      // The audit's live schema-fidelity loss: the old JSON Schema → Zod
      // converter dropped `minimum`/`maximum`, so the client saw an unbounded
      // integer. This asserts against what the SDK actually put on the wire.
      const browser = tools.find((t) => t.name === 'browser');
      expect(browser?.inputSchema.properties?.timeoutMs).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: 9000,
      });

      // A `default` must survive the same trip (it regressed once before).
      const document = tools.find((t) => t.name === 'document');
      expect(document?.inputSchema.properties?.save).toMatchObject({ default: true });

      // Round-2 finding 4, proven on the wire: a client is told an explicit
      // tabId cannot be blank, so the SDK rejects `tabId: ""` before the
      // handler runs and it can never reach the app as "the focused tab".
      for (const t of tools) {
        if (t.inputSchema.properties?.tabId) {
          expect(t.inputSchema.properties.tabId, t.name).toMatchObject({ minLength: 1 });
        }
      }

      // Structured output reaches the client for the three stable shapes.
      expect(Object.keys(document?.outputSchema?.properties ?? {})).toEqual(
        expect.arrayContaining(['saved', 'save_skipped', 'save_error', 'current_revision']),
      );
      expect(
        Object.keys(tools.find((t) => t.name === 'selection')?.outputSchema?.properties ?? {}),
      ).toEqual(expect.arrayContaining(['text', 'range', 'replaced_chars', 'current_revision']));
      expect(
        tools.find((t) => t.name === 'session')?.annotations,
      ).toMatchObject({ readOnlyHint: true });

      // WI-NB2.1: the initialize-time primer reaches the client. `instructions`
      // is initialize-response metadata, so only a real protocol round-trip can
      // prove it is on the wire — the in-process test client never sees it.
      const instructions = client?.getInstructions();
      expect(instructions).toBeTruthy();
      expect(instructions).toContain('browser_read {action:"read"} first');
      expect(instructions).toContain('needsApproval');
      expect(instructions).toContain('UNTRUSTED');
    },
    30_000,
  );
});

// A visible marker when the smoke test is skipped, so a green run cannot be
// mistaken for "the SDK boundary was checked".
describe.skipIf(BUILT)('MCP SDK boundary', () => {
  it('is skipped because dist/cli.js is not built — run `pnpm build` first', () => {
    expect(BUILT).toBe(false);
  });
});
