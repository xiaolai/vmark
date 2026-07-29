/**
 * `selection` tool — arg validation and bridge dispatch.
 *
 * Was at 7.7% statement coverage: neither action, neither refusal branch.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerSelectionTool } from '../../../src/tools/selection.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson, toolText } from '../../utils/toolResult.js';

function harness(handlers: Record<string, (r: BridgeRequest) => BridgeResponse> = {}) {
  const bridge = new MockBridge();
  for (const [type, handler] of Object.entries(handlers)) {
    bridge.setResponseHandler(type, handler);
  }
  const server = new VMarkMcpServer({ bridge });
  registerSelectionTool(server);
  return { server, bridge };
}

describe('selection.get', () => {
  it('returns the selection payload for the focused tab', async () => {
    const payload = {
      text: 'hello',
      isEmpty: false,
      range: { from: 3, to: 8 },
      mode: 'wysiwyg',
      kind: 'markdown',
      tabId: 'tab-1',
      revision: 'r1',
    };
    const { server, bridge } = harness({
      'vmark.selection.get': () => ({ success: true, data: payload }),
    });

    const result = await server.callTool('selection', { action: 'get' });

    expect(bridge.getRequestsOfType('vmark.selection.get')[0].request).toEqual({
      type: 'vmark.selection.get',
      tabId: undefined,
    });
    expect(toolJson(result)).toEqual(payload);
  });

  it('forwards an explicit tabId', async () => {
    const { server, bridge } = harness({
      'vmark.selection.get': () => ({ success: true, data: { text: '', isEmpty: true } }),
    });

    await server.callTool('selection', { action: 'get', tabId: 'tab-9' });

    expect(bridge.getRequestsOfType('vmark.selection.get')[0].request).toMatchObject({
      tabId: 'tab-9',
    });
  });

  it('surfaces INVALID_TAB from the bridge as a tool error', async () => {
    const { server } = harness({
      'vmark.selection.get': () => ({ success: false, error: 'INVALID_TAB' }),
    });

    const result = await server.callTool('selection', { action: 'get', tabId: 'nope' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('INVALID_TAB');
  });
});

describe('selection.set', () => {
  it('forwards content and expected_revision', async () => {
    const { server, bridge } = harness({
      'vmark.selection.set': () => ({ success: true, data: { revision: 'r2' } }),
    });

    const result = await server.callTool('selection', {
      action: 'set',
      content: 'replacement',
      expected_revision: 'r1',
      tabId: 'tab-1',
    });

    expect(bridge.getRequestsOfType('vmark.selection.set')[0].request).toEqual({
      type: 'vmark.selection.set',
      tabId: 'tab-1',
      content: 'replacement',
      expected_revision: 'r1',
    });
    expect(toolJson(result)).toEqual({ revision: 'r2' });
  });

  it('accepts an empty string as an intentional delete', async () => {
    const { server, bridge } = harness({
      'vmark.selection.set': () => ({ success: true, data: { revision: 'r2' } }),
    });

    const result = await server.callTool('selection', { action: 'set', content: '' });

    expect(result.isError).toBeUndefined();
    expect(bridge.getRequestsOfType('vmark.selection.set')[0].request).toMatchObject({
      content: '',
    });
  });

  it('refuses a missing content without touching the bridge', async () => {
    const { server, bridge } = harness();

    const result = await server.callTool('selection', { action: 'set' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('content');
    expect(bridge.requests).toHaveLength(0);
  });

  it('refuses a non-string content', async () => {
    const { server, bridge } = harness();

    const result = await server.callTool('selection', { action: 'set', content: ['a'] });

    expect(result.isError).toBe(true);
    expect(bridge.requests).toHaveLength(0);
  });

  it('surfaces a STALE rejection', async () => {
    const { server } = harness({
      'vmark.selection.set': () => ({
        success: false,
        error: '{"error":"STALE","current_revision":"r7"}',
      }),
    });

    const result = await server.callTool('selection', {
      action: 'set',
      content: 'x',
      expected_revision: 'r1',
    });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('r7');
  });
});

describe('selection — structured output (parity with document)', () => {
  // `selection.set` refuses a stale write exactly like `document.write`, but
  // used to answer in prose only: the retry token an agent MUST branch on
  // arrived as `Tool error: {"error":"STALE",…}`, a JSON string glued into a
  // sentence. It now travels in `structuredContent`, and both success payloads
  // are declared in an `outputSchema` so a client knows the fields exist.

  it('declares an outputSchema covering both actions and the STALE refusal', () => {
    const { server } = harness();
    const schema = z.object(server.tools.get('selection')!.definition.outputSchema!);

    // selection.get
    expect(
      schema.safeParse({
        text: 'hello',
        isEmpty: false,
        range: { from: 3, to: 8 },
        mode: 'wysiwyg',
        kind: 'markdown',
        tabId: 'tab-1',
        revision: 'r1',
      }).success,
    ).toBe(true);
    // selection.set
    expect(schema.safeParse({ revision: 'r2', replaced_chars: 11 }).success).toBe(true);
    // STALE refusal
    expect(
      schema.safeParse({ error: 'STALE', message: 'changed', current_revision: 'r9' }).success,
    ).toBe(true);
    // truncation envelope (selection.get can exceed the output bound)
    expect(
      schema.safeParse({
        truncated: true,
        truncation_note: 'too big',
        bytes_total: 90_000,
        bytes_shown: 74_000,
        preview: 'hel',
      }).success,
    ).toBe(true);
    // Permissive like document's: an unanticipated payload must never turn an
    // already-committed selection replacement into a protocol error.
    expect(schema.safeParse({}).success).toBe(true);
  });

  it('attaches structuredContent to a successful get', async () => {
    const payload = {
      text: 'hello',
      isEmpty: false,
      range: { from: 3, to: 8 },
      mode: 'wysiwyg',
      kind: 'markdown',
      tabId: 'tab-1',
      revision: 'r1',
    };
    const { server } = harness({
      'vmark.selection.get': () => ({ success: true, data: payload }),
    });

    const result = await server.callTool('selection', { action: 'get' });

    expect(result.structuredContent).toEqual(payload);
    expect(toolJson(result)).toEqual(payload);
  });

  it('attaches structuredContent to a successful set', async () => {
    const payload = { revision: 'r2', replaced_chars: 11 };
    const { server } = harness({
      'vmark.selection.set': () => ({ success: true, data: payload }),
    });

    const result = await server.callTool('selection', { action: 'set', content: 'replacement' });

    expect(result.structuredContent).toEqual(payload);
    expect(toolJson(result)).toEqual(payload);
  });

  it('returns the STALE retry token as structuredContent, not only prose', async () => {
    const { server } = harness({
      'vmark.selection.set': () => ({
        success: false,
        error: '{"error":"STALE","message":"Document has changed","current_revision":"r7"}',
      }),
    });

    const result = await server.callTool('selection', {
      action: 'set',
      content: 'x',
      expected_revision: 'r1',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: 'STALE',
      current_revision: 'r7',
    });
    // The prose still names the token and the recovery, for clients that show
    // only the text block.
    expect(toolText(result)).toContain('r7');
    expect(toolText(result)).toContain('selection.get');
  });

  it('reports an unknown current_revision rather than inventing one', async () => {
    const { server } = harness({
      'vmark.selection.set': () => ({
        success: false,
        error: '{"error":"STALE"}',
      }),
    });

    const result = await server.callTool('selection', { action: 'set', content: 'x' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('unknown');
    expect(result.structuredContent).toEqual({ error: 'STALE' });
  });

  it.each([
    ['a plain-string refusal', 'INVALID_TAB'],
    ['a non-STALE structured refusal', '{"error":"NO_EDITOR","message":"no editor"}'],
    ['a malformed JSON refusal', '{"error":"STALE"'],
    ['a JSON array refusal', '["STALE"]'],
  ])('leaves %s as a plain error with no structuredContent', async (_label, error) => {
    const { server } = harness({
      'vmark.selection.get': () => ({ success: false, error }),
    });

    const result = await server.callTool('selection', { action: 'get' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(toolText(result)).toContain(error);
  });
});

describe('selection — invalid actions', () => {
  it.each([undefined, 'replace', 7])('refuses action=%p', async (action) => {
    const { server, bridge } = harness();

    const result = await server.callTool('selection', { action });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('Invalid action');
    expect(bridge.requests).toHaveLength(0);
  });
});

describe('selection — blank tabId (round-2 audit finding 4)', () => {
  // An empty string is falsy on the frontend, so it silently means "focused
  // tab". `selection.set` with a blank tabId replaced text in a document the
  // caller never named.
  it.each([
    ['get', { action: 'get', tabId: '' }],
    ['get (whitespace)', { action: 'get', tabId: ' ' }],
    ['set', { action: 'set', tabId: '', content: 'x' }],
    ['set (non-string)', { action: 'set', tabId: 7, content: 'x' }],
  ])('%s: refuses without touching the bridge', async (_label, args) => {
    const { server, bridge } = harness({
      'vmark.selection.get': () => ({ success: true, data: {} }),
      'vmark.selection.set': () => ({ success: true, data: {} }),
    });

    const result = await server.callTool('selection', args);

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('tabId');
    expect(bridge.requests).toHaveLength(0);
  });
});
