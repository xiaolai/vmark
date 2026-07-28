/**
 * `workflow` tool — arg validation and bridge dispatch.
 *
 * Was at 7.7% statement coverage. `apply_patch` is the only structural mutator
 * that survived the prune, so its "patches must be an array" refusal is the
 * one thing standing between a malformed AI call and the CST mutators.
 */

import { describe, it, expect } from 'vitest';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerWorkflowTool } from '../../../src/tools/workflow.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson, toolText } from '../../utils/toolResult.js';

function harness(handlers: Record<string, (r: BridgeRequest) => BridgeResponse> = {}) {
  const bridge = new MockBridge();
  for (const [type, handler] of Object.entries(handlers)) {
    bridge.setResponseHandler(type, handler);
  }
  const server = new VMarkMcpServer({ bridge });
  registerWorkflowTool(server);
  return { server, bridge };
}

describe('workflow.apply_patch', () => {
  it('forwards the patch array, tabId, and expected_revision verbatim', async () => {
    const patches = [
      { kind: 'workflow.set', path: 'name', value: 'CI' },
      { kind: 'needs.add', jobId: 'build', ref: 'lint' },
    ];
    const { server, bridge } = harness({
      'vmark.workflow.apply_patch': () => ({ success: true, data: { revision: 'r2' } }),
    });

    const result = await server.callTool('workflow', {
      action: 'apply_patch',
      tabId: 'tab-3',
      patches,
      expected_revision: 'r1',
    });

    expect(bridge.getRequestsOfType('vmark.workflow.apply_patch')[0].request).toEqual({
      type: 'vmark.workflow.apply_patch',
      tabId: 'tab-3',
      patches,
      expected_revision: 'r1',
    });
    expect(toolJson(result)).toEqual({ revision: 'r2' });
  });

  it('accepts an empty patch array (a no-op the app may still validate)', async () => {
    const { server, bridge } = harness({
      'vmark.workflow.apply_patch': () => ({ success: true, data: { revision: 'r1' } }),
    });

    const result = await server.callTool('workflow', { action: 'apply_patch', patches: [] });

    expect(result.isError).toBeUndefined();
    expect(bridge.getRequestsOfType('vmark.workflow.apply_patch')).toHaveLength(1);
  });

  it.each([undefined, {}, 'workflow.set', 3])(
    'refuses patches=%p without touching the bridge',
    async (patches) => {
      const { server, bridge } = harness();

      const result = await server.callTool('workflow', { action: 'apply_patch', patches });

      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('patches');
      expect(bridge.requests).toHaveLength(0);
    },
  );

  it('surfaces a bridge rejection (wrong tab kind) as a tool error', async () => {
    const { server } = harness({
      'vmark.workflow.apply_patch': () => ({
        success: false,
        error: '{"error":"INVALID_KIND","message":"tab is markdown"}',
      }),
    });

    const result = await server.callTool('workflow', { action: 'apply_patch', patches: [] });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('INVALID_KIND');
  });
});

describe('workflow.validate', () => {
  it('forwards the tabId and returns the diagnostics payload', async () => {
    const payload = {
      ok: false,
      diagnostics: [{ line: 3, col: 5, message: 'unexpected key', severity: 'error' }],
      binaryAvailable: true,
    };
    const { server, bridge } = harness({
      'vmark.workflow.validate': () => ({ success: true, data: payload }),
    });

    const result = await server.callTool('workflow', { action: 'validate', tabId: 'tab-3' });

    expect(bridge.getRequestsOfType('vmark.workflow.validate')[0].request).toEqual({
      type: 'vmark.workflow.validate',
      tabId: 'tab-3',
    });
    expect(toolJson(result)).toEqual(payload);
  });

  it('defaults to the focused tab', async () => {
    const { server, bridge } = harness({
      'vmark.workflow.validate': () => ({ success: true, data: { ok: true, diagnostics: [] } }),
    });

    await server.callTool('workflow', { action: 'validate' });

    expect(bridge.getRequestsOfType('vmark.workflow.validate')[0].request).toEqual({
      type: 'vmark.workflow.validate',
      tabId: undefined,
    });
  });
});

describe('workflow — invalid actions', () => {
  it.each([undefined, 'apply', null])('refuses action=%p', async (action) => {
    const { server, bridge } = harness();

    const result = await server.callTool('workflow', { action });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('Invalid action');
    expect(bridge.requests).toHaveLength(0);
  });
});

describe('workflow — blank tabId (round-2 audit finding 4)', () => {
  // `apply_patch` mutates a workflow buffer. A blank id means "focused tab" on
  // the frontend, so an invalid target patched whichever file happened to be
  // in front of the user.
  it.each([
    ['apply_patch', { action: 'apply_patch', tabId: '', patches: [] }],
    ['validate', { action: 'validate', tabId: '   ' }],
    ['apply_patch (non-string)', { action: 'apply_patch', tabId: 3, patches: [] }],
  ])('%s: refuses without touching the bridge', async (_label, args) => {
    const { server, bridge } = harness({
      'vmark.workflow.apply_patch': () => ({ success: true, data: {} }),
      'vmark.workflow.validate': () => ({ success: true, data: { ok: true } }),
    });

    const result = await server.callTool('workflow', args);

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('tabId');
    expect(bridge.requests).toHaveLength(0);
  });
});
