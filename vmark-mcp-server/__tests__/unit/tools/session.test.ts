// Session tool — verifies get_state forwards the server's protocol version so
// the app can gate browser tabs for older clients (WI-P6.x follow-up).
import { describe, it, expect } from 'vitest';
import type { BridgeResponse } from '../../../src/bridge/core-types.js';
import { MCP_PROTOCOL_VERSION } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerSessionTool } from '../../../src/tools/session.js';
import { MockBridge } from '../../mocks/mockBridge.js';

describe('session tool — get_state via server.callTool', () => {
  function harness(handler: () => BridgeResponse) {
    const bridge = new MockBridge();
    bridge.setResponseHandler('vmark.session.get_state', handler);
    const server = new VMarkMcpServer({ bridge });
    registerSessionTool(server);
    return { server, bridge };
  }

  it('forwards clientProtocol so the app can gate browser tabs', async () => {
    const state = { windows: [], capabilities: { version: '0.7.0', mcpProtocol: MCP_PROTOCOL_VERSION } };
    const { server, bridge } = harness(() => ({ success: true, data: state }));

    const result = await server.callTool('session', { action: 'get_state' });

    const req = bridge.getRequestsOfType('vmark.session.get_state');
    expect(req).toHaveLength(1);
    expect(req[0].request).toEqual({
      type: 'vmark.session.get_state',
      clientProtocol: MCP_PROTOCOL_VERSION,
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(state);
  });

  it('rejects an unknown action without touching the bridge', async () => {
    const { server, bridge } = harness(() => ({ success: true, data: {} }));
    const result = await server.callTool('session', { action: 'bogus' });
    expect(result.isError).toBe(true);
    expect(bridge.getRequestsOfType('vmark.session.get_state')).toHaveLength(0);
  });
});
