// Audit row #177 — the `browser_read` tool's action table.
//
// Same guarantees as `browserActions.test.ts`, for the read-only half: every
// advertised action has exactly one handler, the table's list matches the
// schema enum (a literal in `browserRead.ts`, because `scripts/check-mcp-docs.mjs`
// reads it by regex), and each handler is testable on its own. The request
// shapes are the ones `browserRead.test.ts` pins through `callTool`.
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerBrowserReadTool } from '../../../src/tools/browserRead.js';
import {
  BROWSER_READ_ACTIONS,
  BROWSER_READ_ACTION_HANDLERS,
  runBrowserReadAction,
  type BrowserReadActionName,
} from '../../../src/tools/browserReadActions.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolText } from '../../utils/toolResult.js';

function harness(): { server: VMarkMcpServer; bridge: MockBridge } {
  const bridge = new MockBridge();
  for (const type of [
    'vmark.browser.read',
    'vmark.browser.extract',
    'vmark.browser.workflow_status',
    'vmark.browser.query',
    'vmark.browser.console',
    'vmark.browser.wait',
    'vmark.browser.wait_for',
  ]) {
    bridge.setResponseHandler(type, () => ({ success: true, data: { ok: true } }));
  }
  bridge.setResponseHandler('vmark.browser.screenshot', () => ({
    success: true,
    data: { url: 'https://x.test', image: 'AA' },
  }));
  return { server: new VMarkMcpServer({ bridge }), bridge };
}

describe('browser_read action table — shape', () => {
  it('has exactly one handler per advertised action, and no others', () => {
    expect(Object.keys(BROWSER_READ_ACTION_HANDLERS).sort()).toEqual([...BROWSER_READ_ACTIONS].sort());
  });

  it('matches the tool schema enum exactly, in the advertised order', () => {
    const server = new VMarkMcpServer({ bridge: new MockBridge() });
    registerBrowserReadTool(server);

    const action = server.tools.get('browser_read')?.definition.inputSchema.action as z.ZodEnum<
      Record<string, string>
    >;
    expect(action.options).toEqual([...BROWSER_READ_ACTIONS]);
  });

  it('is frozen — a handler cannot be swapped at runtime', () => {
    expect(Object.isFrozen(BROWSER_READ_ACTION_HANDLERS)).toBe(true);
  });
});

describe('runBrowserReadAction — per-action handlers send exactly one request', () => {
  const SENDS: ReadonlyArray<
    readonly [BrowserReadActionName, Record<string, unknown>, string | undefined, Record<string, unknown>]
  > = [
    ['read', {}, 'b1', { type: 'vmark.browser.read', tabId: 'b1' }],
    ['read', {}, undefined, { type: 'vmark.browser.read' }],
    ['extract', {}, 'b1', { type: 'vmark.browser.extract', tabId: 'b1' }],
    ['workflow_status', { runId: 'r' }, undefined, { type: 'vmark.browser.workflow_status', runId: 'r' }],
    ['query', { selector: 'table' }, undefined, { type: 'vmark.browser.query', selector: 'table' }],
    ['query', { selector: 'table', fields: { box: true } }, 'b1',
      { type: 'vmark.browser.query', tabId: 'b1', selector: 'table', fields: { box: true } }],
    ['console', {}, undefined, { type: 'vmark.browser.console' }],
    // The read tool never drains: a smuggled `clear` is not forwarded.
    ['console', { clear: true }, 'b1', { type: 'vmark.browser.console', tabId: 'b1' }],
    ['wait', {}, undefined, { type: 'vmark.browser.wait' }],
    ['wait', { navigationId: 'n1', timeoutMs: 100 }, 'b1',
      { type: 'vmark.browser.wait', tabId: 'b1', navigationId: 'n1', timeoutMs: 100 }],
    ['wait_for', { ref: 'e1' }, undefined, { type: 'vmark.browser.wait_for', ref: 'e1' }],
    ['wait_for', { role: 'button', name: 'OK', timeoutMs: 100 }, 'b1',
      { type: 'vmark.browser.wait_for', tabId: 'b1', role: 'button', name: 'OK', timeoutMs: 100 }],
    ['wait_for', { text: 'Done' }, undefined, { type: 'vmark.browser.wait_for', text: 'Done' }],
    ['wait_for', { urlContains: '/next' }, undefined, { type: 'vmark.browser.wait_for', urlContains: '/next' }],
    ['screenshot', {}, 'b1', { type: 'vmark.browser.screenshot', tabId: 'b1' }],
  ];

  it.each(SENDS)('%s %j → one request, byte-for-byte', async (action, args, tabId, expected) => {
    const { server, bridge } = harness();

    const result = await runBrowserReadAction(server, { action, ...args }, tabId);

    expect(result.isError, toolText(result)).toBeUndefined();
    expect(bridge.requests).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(bridge.requests[0].request))).toEqual(expected);
  });

  it('hands every handler the tool-validated tabId, never the raw argument', async () => {
    const { server, bridge } = harness();

    await runBrowserReadAction(server, { action: 'read', tabId: '   raw   ' }, 'b1');

    expect(bridge.getRequestsOfType('vmark.browser.read')[0].request).toEqual({
      type: 'vmark.browser.read',
      tabId: 'b1',
    });
  });

  it('screenshot renders the image block and names the page', async () => {
    const { server } = harness();

    const result = await runBrowserReadAction(server, { action: 'screenshot' }, undefined);

    expect(result.content).toEqual([
      { type: 'text', text: 'Screenshot of https://x.test' },
      { type: 'image', data: 'AA', mimeType: 'image/jpeg' },
    ]);
  });
});

describe('runBrowserReadAction — each handler refuses its own missing argument first', () => {
  const REFUSES: ReadonlyArray<
    readonly [BrowserReadActionName, Record<string, unknown>, string | undefined, string]
  > = [
    ['workflow_status', {}, undefined, 'workflow_status requires a `runId`'],
    ['query', { selector: '  ' }, undefined, 'requires a non-empty CSS `selector`'],
    ['wait', { navigationId: ' ' }, undefined, 'navigationId must be a non-empty string'],
    ['wait', { timeoutMs: 0 }, undefined, 'timeoutMs must be an integer from 1 to 9000'],
    ['wait_for', { text: 'Done', timeoutMs: 9001 }, undefined, 'timeoutMs must be an integer from 1 to 9000'],
    ['wait_for', {}, undefined, 'exactly one of'],
    ['wait_for', { ref: 'e1', text: 'Done' }, undefined, 'exactly one of'],
    ['wait_for', { text: 'Done', name: 'Save' }, undefined, '`name` is only valid together with `role`'],
  ];

  it.each(REFUSES)('%s %j → refused: %s', async (action, args, tabId, fragment) => {
    const { server, bridge } = harness();

    const result = await runBrowserReadAction(server, { action, ...args }, tabId);

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain(fragment);
    expect(bridge.requests).toHaveLength(0);
  });

  it('screenshot refuses a reply without image data rather than emitting a broken block', async () => {
    const bridge = new MockBridge();
    bridge.setResponseHandler('vmark.browser.screenshot', () => ({ success: true, data: { url: 'https://x.test' } }));
    const server = new VMarkMcpServer({ bridge });

    const result = await runBrowserReadAction(server, { action: 'screenshot' }, undefined);

    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe('screenshot returned no image data');
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'refuses the inherited key %s without touching the bridge',
    async (action) => {
      const { server, bridge } = harness();

      const result = await runBrowserReadAction(server, { action }, undefined);

      expect(result.isError).toBe(true);
      expect(toolText(result)).toBe(`unknown action: ${action}`);
      expect(bridge.requests).toHaveLength(0);
    },
  );
});
