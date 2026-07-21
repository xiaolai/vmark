// open_workspace approval-envelope translation (Codex M11) + its type guard.
// A refused open is a request for consent: the tool must render the envelope as
// actionable "ask + retry" guidance, not leak a bare error the AI cannot act on.
import { describe, it, expect } from 'vitest';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import {
  registerWorkspaceTool,
  isWorkspaceApprovalNeeded,
} from '../../../src/tools/workspace.js';
import { MockBridge } from '../../mocks/mockBridge.js';

function harness(
  requestType: string,
  handler: (request: BridgeRequest) => BridgeResponse,
) {
  const bridge = new MockBridge();
  bridge.setResponseHandler(requestType, handler);
  const server = new VMarkMcpServer({ bridge });
  registerWorkspaceTool(server);
  return { server, bridge };
}

describe('isWorkspaceApprovalNeeded', () => {
  it('accepts the workspace envelope and rejects malformed / other shapes', () => {
    expect(isWorkspaceApprovalNeeded({ needsApproval: true, folderPath: '/p' })).toBe(true);
    expect(isWorkspaceApprovalNeeded({ needsApproval: true, folderPath: '' })).toBe(false);
    expect(isWorkspaceApprovalNeeded({ needsApproval: true })).toBe(false);
    expect(isWorkspaceApprovalNeeded({ needsApproval: false, folderPath: '/p' })).toBe(false);
    expect(isWorkspaceApprovalNeeded(null)).toBe(false);
  });
});

describe('workspace tool — open_workspace approval translation', () => {
  it('renders the approval envelope as actionable guidance, not a bare error', async () => {
    const { server } = harness('vmark.workspace.open_workspace', () => ({
      success: false,
      error: '{"error":"APPROVAL_REQUIRED","message":"needs approval"}',
      data: { needsApproval: true, folderPath: '/proj' },
    }));

    const result = await server.callTool('workspace', {
      action: 'open_workspace',
      folderPath: '/proj',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('approval required');
    expect(result.content[0].text).toContain('/proj');
    expect(result.content[0].text.toLowerCase()).toContain('retry');
  });

  it('passes a successful open through as JSON', async () => {
    const { server } = harness('vmark.workspace.open_workspace', () => ({
      success: true,
      data: { opened: true, folderPath: '/proj' },
    }));

    const result = await server.callTool('workspace', {
      action: 'open_workspace',
      folderPath: '/proj',
    });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ opened: true, folderPath: '/proj' });
  });

  it('rejects a missing folderPath without touching the bridge', async () => {
    const { server, bridge } = harness('vmark.workspace.open_workspace', () => ({
      success: true,
      data: {},
    }));

    const result = await server.callTool('workspace', { action: 'open_workspace' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('folderPath');
    expect(bridge.requests).toHaveLength(0);
  });
});
