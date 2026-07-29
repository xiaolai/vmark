// coherence_resolve (WI-1.10) — the one mutating action on the coherence
// layer, split out of `coherence` so that tool can declare readOnlyHint:true.
//
// The split must be a pure relocation: the same bridge request, with the same
// fields, reaching the same fail-closed Rust authorization. Authorization
// itself is server-side and keys off the authenticated bridge principal, so
// nothing here can grant a caller anything — these tests pin the wire shape and
// the guards that run before it.
import { describe, it, expect } from 'vitest';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import { createVMarkMcpServer, EXPECTED_TOOL_COUNT } from '../../../src/index.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerCoherenceResolveTool } from '../../../src/tools/coherenceResolve.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson } from '../../utils/toolResult.js';

const ROOT = '/workspace/novel';
const TXF = '019f0000-0000-7000-8000-000000000000';

function harness(handler: (request: BridgeRequest) => BridgeResponse) {
  const bridge = new MockBridge();
  bridge.setResponseHandler('vmark.coherence.resolve', handler);
  const server = new VMarkMcpServer({ bridge });
  registerCoherenceResolveTool(server);
  return { server, bridge };
}

describe('coherence_resolve tool', () => {
  it('forwards accept-newer as vmark.coherence.resolve with every field intact', async () => {
    const { server, bridge } = harness(() => ({
      success: true,
      data: { entryId: 'e', kind: 'ratification' },
    }));

    const result = await server.callTool('coherence_resolve', {
      action: 'resolve',
      workspace_root: ROOT,
      txf: TXF,
      input: 0,
      resolution: 'accept-newer',
    });

    expect(result.isError).toBeUndefined();
    const requests = bridge.getRequestsOfType('vmark.coherence.resolve');
    expect(requests).toHaveLength(1);
    expect(requests[0].request).toEqual({
      type: 'vmark.coherence.resolve',
      workspace_root: ROOT,
      txf: TXF,
      input: 0,
      resolution: 'accept-newer',
    });
    expect(toolJson(result)).toEqual({ entryId: 'e', kind: 'ratification' });
  });

  it('carries the waive reason through to the ledger', async () => {
    // A waive without its reason would land an unexplained entry in an
    // audit log, which is the one thing an audit log cannot afford.
    const { server, bridge } = harness(() => ({ success: true, data: { entryId: 'e2' } }));

    await server.callTool('coherence_resolve', {
      action: 'resolve',
      workspace_root: ROOT,
      txf: TXF,
      input: 1,
      resolution: 'waive',
      reason: 'upstream change is cosmetic',
    });

    expect(bridge.getRequestsOfType('vmark.coherence.resolve')[0].request).toEqual({
      type: 'vmark.coherence.resolve',
      workspace_root: ROOT,
      txf: TXF,
      input: 1,
      resolution: 'waive',
      reason: 'upstream change is cosmetic',
    });
  });

  it('omits reason entirely when it was not supplied', async () => {
    const { server, bridge } = harness(() => ({ success: true, data: {} }));

    await server.callTool('coherence_resolve', {
      action: 'resolve', workspace_root: ROOT, txf: TXF, input: 0, resolution: 'accept-newer',
    });

    const request = bridge.getRequestsOfType('vmark.coherence.resolve')[0].request as Record<string, unknown>;
    expect('reason' in request).toBe(false);
  });

  it('surfaces a fail-closed authorization refusal as a tool error', async () => {
    const { server } = harness(() => ({
      success: false,
      error: 'no live delegation grant covers this resolution',
    }));

    const result = await server.callTool('coherence_resolve', {
      action: 'resolve', workspace_root: ROOT, txf: TXF, input: 0, resolution: 'accept-newer',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('delegation grant');
  });

  it('rejects a missing or empty workspace_root without touching the bridge', async () => {
    const { server, bridge } = harness(() => ({ success: true, data: {} }));

    for (const args of [
      { action: 'resolve', txf: TXF, input: 0, resolution: 'accept-newer' },
      { action: 'resolve', workspace_root: '', txf: TXF, input: 0, resolution: 'accept-newer' },
      { action: 'resolve', workspace_root: 42, txf: TXF, input: 0, resolution: 'accept-newer' },
    ]) {
      const result = await server.callTool('coherence_resolve', args as Record<string, unknown>);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('workspace_root');
    }
    expect(bridge.requests).toHaveLength(0);
  });

  it('rejects any action other than resolve without touching the bridge', async () => {
    // The read actions live on `coherence`. Accepting one here would route a
    // read through the tool a client has been told is destructive — harmless in
    // itself, but it makes the surface's one dangerous tool ambiguous.
    const { server, bridge } = harness(() => ({ success: true, data: {} }));

    for (const action of ['status', 'edges', 'claims', 'contexts', 'explode']) {
      const result = await server.callTool('coherence_resolve', { action, workspace_root: ROOT });
      expect(result.isError, action).toBe(true);
      expect(result.content[0].text).toContain('Invalid action');
    }
    expect(bridge.requests).toHaveLength(0);
  });
});

describe('coherence_resolve tool — registration consistency', () => {
  it('is registered by createVMarkMcpServer and counted in EXPECTED_TOOL_COUNT', () => {
    const server = createVMarkMcpServer(new MockBridge());
    const names = server.listTools().map((t) => t.name);
    expect(names).toContain('coherence_resolve');
    expect(names).toHaveLength(EXPECTED_TOOL_COUNT);
  });
});
