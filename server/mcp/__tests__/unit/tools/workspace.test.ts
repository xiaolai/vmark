// open_workspace approval-envelope translation (Codex M11) + its type guard.
// A refused open is a request for consent: the tool must render the envelope as
// actionable "ask + retry" guidance, not leak a bare error the AI cannot act on.
import { describe, it, expect } from 'vitest';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import {
  registerWorkspaceTool,
  isWorkspaceApprovalNeeded,
  WORKSPACE_TAB_KINDS,
} from '../../../src/tools/workspace.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson, toolText } from '../../utils/toolResult.js';

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
    expect(toolText(result).toLowerCase()).toContain('retry');
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
    expect(toolJson(result)).toEqual({ opened: true, folderPath: '/proj' });
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

  it('passes a non-approval bridge error through unchanged', async () => {
    const { server } = harness('vmark.workspace.open_workspace', () => ({
      success: false,
      error: 'ENOENT: no such directory',
      data: { needsApproval: true }, // malformed envelope — must NOT be rendered as consent
    }));

    const result = await server.callTool('workspace', {
      action: 'open_workspace',
      folderPath: '/gone',
    });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('ENOENT');
    expect(toolText(result)).not.toContain('approval required');
  });
});

// The remaining seven actions were entirely uncovered (workspace.ts sat at
// 40.9% statements). They are thin arg-validation + dispatch handlers, and the
// validation is what stops a malformed AI call from closing the wrong tab.
describe('workspace — file and window lifecycle dispatch', () => {
  it('new: forwards kind and windowLabel, both optional', async () => {
    const { server, bridge } = harness('vmark.workspace.new', () => ({
      success: true,
      data: { tabId: 'tab-new' },
    }));

    const bare = await server.callTool('workspace', { action: 'new' });
    expect(toolJson(bare)).toEqual({ tabId: 'tab-new' });
    expect(bridge.getRequestsOfType('vmark.workspace.new')[0].request).toEqual({
      type: 'vmark.workspace.new',
      kind: undefined,
      windowLabel: undefined,
    });

    await server.callTool('workspace', {
      action: 'new',
      kind: 'yaml-workflow',
      windowLabel: 'main',
    });
    expect(bridge.getRequestsOfType('vmark.workspace.new')[1].request).toEqual({
      type: 'vmark.workspace.new',
      kind: 'yaml-workflow',
      windowLabel: 'main',
    });
  });

  it('open: forwards filePath and refuses a missing one', async () => {
    const { server, bridge } = harness('vmark.workspace.open', () => ({
      success: true,
      data: { tabId: 'tab-2' },
    }));

    const ok = await server.callTool('workspace', {
      action: 'open',
      filePath: '/tmp/a.md',
      windowLabel: 'w2',
    });
    expect(toolJson(ok)).toEqual({ tabId: 'tab-2' });
    expect(bridge.getRequestsOfType('vmark.workspace.open')[0].request).toEqual({
      type: 'vmark.workspace.open',
      filePath: '/tmp/a.md',
      windowLabel: 'w2',
    });

    const bad = await server.callTool('workspace', { action: 'open' });
    expect(bad.isError).toBe(true);
    expect(toolText(bad)).toContain('filePath');
    expect(bridge.getRequestsOfType('vmark.workspace.open')).toHaveLength(1);
  });

  it('save: forwards the optional tabId', async () => {
    const { server, bridge } = harness('vmark.workspace.save', () => ({
      success: true,
      data: { filePath: '/tmp/a.md', revision: 'r5' },
    }));

    const result = await server.callTool('workspace', { action: 'save', tabId: 'tab-1' });

    expect(toolJson(result)).toEqual({ filePath: '/tmp/a.md', revision: 'r5' });
    expect(bridge.getRequestsOfType('vmark.workspace.save')[0].request).toEqual({
      type: 'vmark.workspace.save',
      tabId: 'tab-1',
    });
  });

  it('save: surfaces a bridge failure as a tool error', async () => {
    const { server } = harness('vmark.workspace.save', () => ({
      success: false,
      error: '{"error":"UNTITLED","message":"no filePath"}',
    }));

    const result = await server.callTool('workspace', { action: 'save' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('UNTITLED');
  });

  it('save_as: forwards filePath and refuses a missing one', async () => {
    const { server, bridge } = harness('vmark.workspace.save_as', () => ({
      success: true,
      data: { revision: 'r6' },
    }));

    const ok = await server.callTool('workspace', {
      action: 'save_as',
      tabId: 'tab-1',
      filePath: '/tmp/b.md',
    });
    expect(toolJson(ok)).toEqual({ revision: 'r6' });
    expect(bridge.getRequestsOfType('vmark.workspace.save_as')[0].request).toEqual({
      type: 'vmark.workspace.save_as',
      tabId: 'tab-1',
      filePath: '/tmp/b.md',
    });

    const bad = await server.callTool('workspace', { action: 'save_as', tabId: 'tab-1' });
    expect(bad.isError).toBe(true);
    expect(toolText(bad)).toContain('filePath');
    expect(bridge.getRequestsOfType('vmark.workspace.save_as')).toHaveLength(1);
  });

  it('close: defaults force to false and forwards an explicit true', async () => {
    const { server, bridge } = harness('vmark.workspace.close', () => ({
      success: true,
      data: { closed: true },
    }));

    await server.callTool('workspace', { action: 'close', tabId: 'tab-1' });
    expect(bridge.getRequestsOfType('vmark.workspace.close')[0].request).toEqual({
      type: 'vmark.workspace.close',
      tabId: 'tab-1',
      force: false,
    });

    await server.callTool('workspace', { action: 'close', tabId: 'tab-1', force: true });
    expect(bridge.getRequestsOfType('vmark.workspace.close')[1].request).toMatchObject({
      force: true,
    });
  });

  it('close: coerces a truthy non-boolean force to false rather than discarding a buffer', async () => {
    // `force` discards unsaved work. A string "true" from a sloppy client must
    // NOT be read as consent.
    const { server, bridge } = harness('vmark.workspace.close', () => ({
      success: true,
      data: { closed: false, reason: 'DIRTY' },
    }));

    const result = await server.callTool('workspace', {
      action: 'close',
      tabId: 'tab-1',
      force: 'true',
    });

    expect(bridge.getRequestsOfType('vmark.workspace.close')[0].request).toMatchObject({
      force: false,
    });
    expect(toolJson(result)).toEqual({ closed: false, reason: 'DIRTY' });
  });

  it('close: refuses a missing tabId without touching the bridge', async () => {
    const { server, bridge } = harness('vmark.workspace.close', () => ({
      success: true,
      data: {},
    }));

    const result = await server.callTool('workspace', { action: 'close' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('tabId');
    expect(bridge.requests).toHaveLength(0);
  });

  it('switch_tab: forwards tabId and refuses a missing one', async () => {
    const { server, bridge } = harness('vmark.workspace.switch_tab', () => ({
      success: true,
      data: { tabId: 'tab-4' },
    }));

    await server.callTool('workspace', { action: 'switch_tab', tabId: 'tab-4' });
    expect(bridge.getRequestsOfType('vmark.workspace.switch_tab')[0].request).toEqual({
      type: 'vmark.workspace.switch_tab',
      tabId: 'tab-4',
    });

    const bad = await server.callTool('workspace', { action: 'switch_tab' });
    expect(bad.isError).toBe(true);
    expect(toolText(bad)).toContain('tabId');
    expect(bridge.getRequestsOfType('vmark.workspace.switch_tab')).toHaveLength(1);
  });

  it('focus_window: forwards windowLabel and refuses a missing one', async () => {
    const { server, bridge } = harness('vmark.workspace.focus_window', () => ({
      success: true,
      data: { focused: true },
    }));

    await server.callTool('workspace', { action: 'focus_window', windowLabel: 'main' });
    expect(bridge.getRequestsOfType('vmark.workspace.focus_window')[0].request).toEqual({
      type: 'vmark.workspace.focus_window',
      windowLabel: 'main',
    });

    const bad = await server.callTool('workspace', { action: 'focus_window' });
    expect(bad.isError).toBe(true);
    expect(toolText(bad)).toContain('windowLabel');
    expect(bridge.getRequestsOfType('vmark.workspace.focus_window')).toHaveLength(1);
  });

  it.each([undefined, 'rename', 12])('refuses action=%p', async (action) => {
    const { server, bridge } = harness('vmark.workspace.new', () => ({
      success: true,
      data: {},
    }));

    const result = await server.callTool('workspace', { action });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('Invalid action');
    expect(bridge.requests).toHaveLength(0);
  });
});

describe('workspace — blank identifiers (round-2 audit finding 4)', () => {
  // Blank ids are falsy on the frontend, where that means "the focused
  // tab/window". `close` or `save_as` against a blank id acted on whatever the
  // user happened to have in front of them, not on the target the caller named.
  it.each([
    ['save', { action: 'save', tabId: '' }],
    ['save (whitespace)', { action: 'save', tabId: '  ' }],
    ['save_as', { action: 'save_as', tabId: '', filePath: '/tmp/a.md' }],
    ['close', { action: 'close', tabId: '' }],
    ['switch_tab', { action: 'switch_tab', tabId: '   ' }],
    ['new (blank windowLabel)', { action: 'new', windowLabel: '' }],
    ['focus_window', { action: 'focus_window', windowLabel: '  ' }],
    ['open (blank filePath)', { action: 'open', filePath: '   ' }],
    ['save_as (blank filePath)', { action: 'save_as', filePath: '' }],
    ['open_workspace (blank folderPath)', { action: 'open_workspace', folderPath: ' ' }],
  ])('%s: refuses without touching the bridge', async (_label, args) => {
    const bridge = new MockBridge();
    const server = new VMarkMcpServer({ bridge });
    registerWorkspaceTool(server);

    const result = await server.callTool('workspace', args);

    expect(result.isError).toBe(true);
    expect(bridge.requests).toHaveLength(0);
  });
});

// audit R3 #240 — `typeof args.kind === 'string' ? args.kind : undefined` turns
// a caller's mistake into exactly the value that means "use the default", so
// `new` silently made a Markdown tab for a caller who asked for something else.
// `callTool` runs NO schema validation, so this guard is what holds.
describe('workspace new — a supplied but invalid `kind` is refused, never dropped', () => {
  const newTab = (kind: unknown) => {
    const { server } = harness('vmark.workspace.new', (request) => ({
      success: true,
      data: { tabId: 't1', kind: (request as unknown as { kind?: unknown }).kind ?? null },
    }));
    return server.callTool('workspace', { action: 'new', ...(kind === undefined ? {} : { kind }) });
  };

  it.each(WORKSPACE_TAB_KINDS)('forwards the valid kind %s', async (kind) => {
    expect(toolJson(await newTab(kind))).toMatchObject({ kind });
  });

  it('omits an absent kind so the app applies its default', async () => {
    expect(toolJson(await newTab(undefined))).toMatchObject({ kind: null });
  });

  it.each([
    ['an unknown string', 'md'],
    ['a number', 7],
    ['null', null],
    ['a boolean', true],
    ['an object', {}],
  ])('refuses %s instead of creating the default tab', async (_label, kind) => {
    const text = toolText(await newTab(kind));
    expect(text).toContain('kind must be one of markdown, yaml-workflow');
    expect(text).toContain(JSON.stringify(kind));
  });

  it('spells the live list into the refusal rather than a stale literal', async () => {
    expect(toolText(await newTab('md'))).toContain(WORKSPACE_TAB_KINDS.join(', '));
  });
});

// audit R3 #241 — the description told clients the first call "returns
// {needsApproval: true}". It does not: the tool renders that envelope as an
// ERROR (deliberately, Codex M11), so a client branching on the documented
// field found nothing. The advertised contract now matches the result.
describe('workspace open_workspace — the advertised contract is the observed one', () => {
  it('describes the refusal a client actually receives', async () => {
    const { server } = harness('vmark.workspace.open_workspace', () => ({
      success: false,
      error: 'APPROVAL_REQUIRED',
      data: { needsApproval: true, folderPath: '/proj' },
    }));
    const observed = toolText(await server.callTool('workspace', { action: 'open_workspace', folderPath: '/proj' }));
    const described = server.listTools().find((t) => t.name === 'workspace')?.description ?? '';
    const advertised = described.slice(described.indexOf('- open_workspace:'), described.indexOf('- save:'));
    expect(observed).toContain('approval required to open workspace');
    expect(advertised).toContain('approval required to open workspace');
    expect(advertised).not.toContain('{needsApproval: true}');
  });
});
