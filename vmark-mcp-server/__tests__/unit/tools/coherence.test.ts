// Coherence tool (WI-1.10) — verifies both read-only actions forward the
// right Rust-terminal bridge request with workspace_root, pass results and
// bridge errors through, and reject bad input without touching the bridge.
import { describe, it, expect } from 'vitest';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import { createVMarkMcpServer, EXPECTED_TOOL_COUNT } from '../../../src/index.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerCoherenceTool } from '../../../src/tools/coherence.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson } from '../../utils/toolResult.js';

const ROOT = '/workspace/novel';

describe('coherence tool — status/edges via server.callTool', () => {
  function harness(
    requestType: string,
    handler: (request: BridgeRequest) => BridgeResponse,
  ) {
    const bridge = new MockBridge();
    bridge.setResponseHandler(requestType, handler);
    const server = new VMarkMcpServer({ bridge });
    registerCoherenceTool(server);
    return { server, bridge };
  }

  it('status forwards vmark.coherence.status with workspace_root and passes the result through', async () => {
    const status = {
      initialized: false,
      objects: 0,
      open_items: 0,
      quarantined: 0,
      writer: '00000000-0000-0000-0000-000000000007',
    };
    const { server, bridge } = harness('vmark.coherence.status', () => ({
      success: true,
      data: status,
    }));

    const result = await server.callTool('coherence', {
      action: 'status',
      workspace_root: ROOT,
    });

    const requests = bridge.getRequestsOfType('vmark.coherence.status');
    expect(requests).toHaveLength(1);
    expect(requests[0].request).toEqual({
      type: 'vmark.coherence.status',
      workspace_root: ROOT,
    });
    expect(result.isError).toBeUndefined();
    expect(toolJson(result)).toEqual(status);
  });

  it('edges forwards vmark.coherence.edges with workspace_root and passes rows through', async () => {
    const rows = [
      {
        txf: '018f0000-0000-7000-8000-000000000001',
        input: 0,
        upstream: '018f0000-0000-7000-8000-000000000002',
        upstream_path: 'elena.md',
        pinned: 'rev-a',
        downstream: '018f0000-0000-7000-8000-000000000003',
        downstream_path: 'scene.md',
        downstream_rev: 'rev-b',
        state: 'version-stale',
      },
    ];
    const { server, bridge } = harness('vmark.coherence.edges', () => ({
      success: true,
      data: rows,
    }));

    const result = await server.callTool('coherence', {
      action: 'edges',
      workspace_root: ROOT,
    });

    const requests = bridge.getRequestsOfType('vmark.coherence.edges');
    expect(requests).toHaveLength(1);
    expect(requests[0].request).toEqual({
      type: 'vmark.coherence.edges',
      workspace_root: ROOT,
    });
    expect(result.isError).toBeUndefined();
    expect(toolJson(result)).toEqual(rows);
  });

  it('surfaces a bridge error (invalid workspace) as a tool error', async () => {
    const { server } = harness('vmark.coherence.status', () => ({
      success: false,
      error: 'workspace_root is not an accessible directory: /gone',
    }));

    const result = await server.callTool('coherence', {
      action: 'status',
      workspace_root: '/gone',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not an accessible directory');
  });

  it('rejects an unknown action without touching the bridge', async () => {
    const { server, bridge } = harness('vmark.coherence.status', () => ({
      success: true,
      data: {},
    }));

    const result = await server.callTool('coherence', {
      action: 'explode',
      workspace_root: ROOT,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid action');
    expect(bridge.requests).toHaveLength(0);
  });

  it('forwards resolve to the bridge as vmark.coherence.resolve', async () => {
    const { server, bridge } = harness('vmark.coherence.resolve', () => ({
      success: true,
      data: { entryId: 'e', kind: 'ratification' },
    }));
    const result = await server.callTool('coherence', {
      action: 'resolve',
      workspace_root: ROOT,
      txf: '019f0000-0000-7000-8000-000000000000',
      input: 0,
      resolution: 'accept-newer',
    });
    expect(result.isError).toBeUndefined();
    expect(bridge.getRequestsOfType('vmark.coherence.resolve')).toHaveLength(1);
  });

  it('rejects a missing or empty workspace_root without touching the bridge', async () => {
    const { server, bridge } = harness('vmark.coherence.edges', () => ({
      success: true,
      data: [],
    }));

    for (const args of [
      { action: 'edges' },
      { action: 'edges', workspace_root: '' },
      { action: 'edges', workspace_root: 42 },
    ]) {
      const result = await server.callTool('coherence', args as Record<string, unknown>);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('workspace_root');
    }
    expect(bridge.requests).toHaveLength(0);
  });
});

describe('coherence tool — registration consistency', () => {
  it('is registered by createVMarkMcpServer and counted in EXPECTED_TOOL_COUNT', () => {
    // Keeps the --health-check tool-count self-test honest: the reduce over
    // TOOL_CATEGORIES must match the actual registrations.
    const server = createVMarkMcpServer(new MockBridge());
    const names = server.listTools().map((t) => t.name);
    expect(names).toContain('coherence');
    expect(names).toHaveLength(EXPECTED_TOOL_COUNT);
  });
});
