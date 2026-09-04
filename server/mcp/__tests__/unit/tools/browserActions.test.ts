// Audit row #175 — the `browser` tool's action table.
//
// What the old `if`-chain could not promise and this table does: every action
// the schema advertises has exactly one handler (and nothing un-advertised has
// one), and each handler is a unit small enough to test by itself. The schema
// enum stays a literal in `browser.ts` because `scripts/check-mcp-docs.mjs`
// reads it by regex, so the second test below is what keeps the two lists one.
// The request shapes are the same ones `browser.test.ts` pins through
// `callTool`; here they are reached through the table directly, so a routing
// regression and a handler regression read apart.
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerBrowserTool } from '../../../src/tools/browser.js';
import {
  BROWSER_ACTIONS,
  BROWSER_ACTION_HANDLERS,
  runBrowserAction,
  type BrowserActionName,
} from '../../../src/tools/browserActions.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolText } from '../../utils/toolResult.js';

function harness(): { server: VMarkMcpServer; bridge: MockBridge } {
  const bridge = new MockBridge();
  for (const type of [
    'vmark.browser.act',
    'vmark.browser.open',
    'vmark.browser.navigate',
    'vmark.browser.close',
    'vmark.browser.style',
    'vmark.browser.execute_js',
    'vmark.browser.session.save',
    'vmark.browser.session.load',
    'vmark.browser.console',
    'vmark.browser.workflow_run',
    'vmark.browser.workflow_cancel',
    'vmark.browser.workflow_record',
  ]) {
    bridge.setResponseHandler(type, () => ({ success: true, data: { ok: true } }));
  }
  return { server: new VMarkMcpServer({ bridge }), bridge };
}

describe('browser action table — shape', () => {
  it('has exactly one handler per advertised action, and no others', () => {
    expect(Object.keys(BROWSER_ACTION_HANDLERS).sort()).toEqual([...BROWSER_ACTIONS].sort());
  });

  it('matches the tool schema enum exactly, in the advertised order', () => {
    const server = new VMarkMcpServer({ bridge: new MockBridge() });
    registerBrowserTool(server);

    const action = server.tools.get('browser')?.definition.inputSchema.action as z.ZodEnum<
      Record<string, string>
    >;
    expect(action.options).toEqual([...BROWSER_ACTIONS]);
  });

  it('is frozen — a handler cannot be swapped at runtime', () => {
    expect(Object.isFrozen(BROWSER_ACTION_HANDLERS)).toBe(true);
  });
});

describe('runBrowserAction — per-action handlers send exactly one request', () => {
  // [action, args, tabId as the tool validated it, the request that must cross]
  const SENDS: ReadonlyArray<
    readonly [BrowserActionName, Record<string, unknown>, string | undefined, Record<string, unknown>]
  > = [
    ['act', { operation: 'click', role: 'button', name: 'OK' }, undefined,
      { type: 'vmark.browser.act', operation: 'click', role: 'button', name: 'OK' }],
    ['act', { operation: 'type', ref: 'e1', text: '' }, 'b1',
      { type: 'vmark.browser.act', tabId: 'b1', operation: 'type', ref: 'e1', text: '' }],
    ['act', { operation: 'scroll', dy: 0 }, undefined,
      { type: 'vmark.browser.act', operation: 'scroll', dy: 0 }],
    ['act', { operation: 'scroll', ref: 'e2' }, undefined,
      { type: 'vmark.browser.act', operation: 'scroll', ref: 'e2' }],
    ['act', { operation: 'key', key: 'Enter' }, undefined,
      { type: 'vmark.browser.act', operation: 'key', key: 'Enter' }],
    ['act', { operation: 'key', key: 'Tab', ref: 'e3', modifiers: { shift: true } }, undefined,
      { type: 'vmark.browser.act', operation: 'key', key: 'Tab', ref: 'e3', modifiers: { shift: true } }],
    // `open` creates a tab: it never forwards a tabId, even when the tool has one.
    ['open', { url: 'https://x.test' }, 'b1', { type: 'vmark.browser.open', url: 'https://x.test' }],
    ['open', { url: 'https://x.test', timeoutMs: 100, profile: ' p1 ' }, undefined,
      { type: 'vmark.browser.open', url: 'https://x.test', timeoutMs: 100, profile: 'p1' }],
    ['navigate', { url: 'https://x.test' }, 'b1',
      { type: 'vmark.browser.navigate', tabId: 'b1', url: 'https://x.test' }],
    ['navigate', { url: 'https://x.test', timeoutMs: 1 }, undefined,
      { type: 'vmark.browser.navigate', url: 'https://x.test', timeoutMs: 1 }],
    ['close', {}, 'b1', { type: 'vmark.browser.close', tabId: 'b1' }],
    ['style', { set: { display: 'none' } }, undefined,
      { type: 'vmark.browser.style', set: { display: 'none' } }],
    ['style', { ref: 'e1', selector: '.x', addClasses: ['a'], removeClasses: ['b'], injectCss: 'a{}' }, 'b1',
      { type: 'vmark.browser.style', tabId: 'b1', ref: 'e1', selector: '.x', addClasses: ['a'], removeClasses: ['b'], injectCss: 'a{}' }],
    ['execute_js', { script: 'return 1' }, undefined,
      { type: 'vmark.browser.execute_js', script: 'return 1' }],
    ['session_save', { handle: ' h ' }, undefined, { type: 'vmark.browser.session.save', handle: 'h' }],
    ['session_load', { handle: 'h' }, 'b1', { type: 'vmark.browser.session.load', tabId: 'b1', handle: 'h' }],
    ['console_clear', {}, undefined, { type: 'vmark.browser.console', clear: true }],
    ['workflow_run', { source: 's' }, undefined, { type: 'vmark.browser.workflow_run', source: 's' }],
    ['workflow_run', { source: 's', inputs: { a: 'b' }, allowRepeat: true, resumeRunId: 'r0' }, 'b1',
      { type: 'vmark.browser.workflow_run', tabId: 'b1', source: 's', inputs: { a: 'b' }, allowRepeat: true, resumeRunId: 'r0' }],
    ['workflow_cancel', { runId: 'r' }, undefined, { type: 'vmark.browser.workflow_cancel', runId: 'r' }],
    ['workflow_record', { recordOp: 'stop' }, undefined,
      { type: 'vmark.browser.workflow_record', recordOp: 'stop' }],
    ['workflow_record', { recordOp: 'start', site: 'blog' }, 'b1',
      { type: 'vmark.browser.workflow_record', tabId: 'b1', recordOp: 'start', site: 'blog' }],
  ];

  it.each(SENDS)('%s %j → one request, byte-for-byte', async (action, args, tabId, expected) => {
    const { server, bridge } = harness();

    const result = await runBrowserAction(server, { action, ...args }, tabId);

    expect(result.isError, toolText(result)).toBeUndefined();
    expect(bridge.requests).toHaveLength(1);
    // JSON is the wire: a key carrying `undefined` is not sent, so compare what
    // would actually be serialized.
    expect(JSON.parse(JSON.stringify(bridge.requests[0].request))).toEqual(expected);
  });

  it('hands every handler the tool-validated tabId, never the raw argument', async () => {
    const { server, bridge } = harness();

    await runBrowserAction(server, { action: 'close', tabId: '   raw   ' }, 'b1');

    expect(bridge.getRequestsOfType('vmark.browser.close')[0].request).toEqual({
      type: 'vmark.browser.close',
      tabId: 'b1',
    });
  });
});

describe('runBrowserAction — each handler refuses its own missing argument first', () => {
  // [action, args, tabId, fragment of the refusal] — one guard per handler,
  // the bridge untouched. (`console_clear` has no guard: it always drains.)
  const REFUSES: ReadonlyArray<
    readonly [BrowserActionName, Record<string, unknown>, string | undefined, string]
  > = [
    ['act', {}, undefined, "must be 'click', 'type', 'scroll', or 'key'"],
    ['act', { operation: 'scroll' }, undefined, 'exactly one of a `ref`'],
    ['act', { operation: 'key' }, undefined, 'requires a non-empty `key`'],
    ['act', { operation: 'click', ref: 'e1', role: 'button', name: 'X' }, undefined, 'not both'],
    ['act', { operation: 'click', role: 'button' }, undefined, 'both `role` and `name`'],
    ['act', { operation: 'type', ref: 'e1' }, undefined, "'type' requires a 'text' string"],
    ['open', {}, undefined, 'url must be a non-empty string'],
    ['open', { url: 'https://x.test', timeoutMs: 0 }, undefined, 'timeoutMs must be an integer from 1 to 9000'],
    ['open', { url: 'https://x.test', profile: 'bad/slash' }, undefined, 'profile must match'],
    ['navigate', { url: ' ' }, 'b1', 'url must be a non-empty string'],
    ['navigate', { url: 'https://x.test', timeoutMs: 9001 }, 'b1', 'timeoutMs must be an integer from 1 to 9000'],
    ['close', {}, undefined, 'requires the `tabId`'],
    ['style', { selector: '.x' }, undefined, 'style requires one of'],
    ['style', { injectCss: 'a'.repeat(64 * 1024 + 1) }, undefined, 'byte limit'],
    ['execute_js', {}, undefined, 'requires a non-empty `script`'],
    ['execute_js', { script: 'x'.repeat(64 * 1024 + 1) }, undefined, 'byte limit'],
    ['session_save', { handle: '../x' }, undefined, "session_save requires a 'handle'"],
    ['session_load', {}, undefined, "session_load requires a 'handle'"],
    ['workflow_run', { source: '  ' }, undefined, 'requires a non-empty `source`'],
    ['workflow_cancel', {}, undefined, 'requires a `runId`'],
    ['workflow_record', { recordOp: 'pause' }, undefined, "recordOp 'start' or 'stop'"],
  ];

  it.each(REFUSES)('%s %j → refused: %s', async (action, args, tabId, fragment) => {
    const { server, bridge } = harness();

    const result = await runBrowserAction(server, { action, ...args }, tabId);

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain(fragment);
    expect(bridge.requests).toHaveLength(0);
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'refuses the inherited key %s without touching the bridge',
    async (action) => {
      const { server, bridge } = harness();

      const result = await runBrowserAction(server, { action }, undefined);

      expect(result.isError).toBe(true);
      expect(toolText(result)).toBe(`unknown action: ${action}`);
      expect(bridge.requests).toHaveLength(0);
    },
  );
});
