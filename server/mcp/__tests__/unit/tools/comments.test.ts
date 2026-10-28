// WI-AL3.3 — the `comments` tool: list, reply and mark_addressed reach the bridge with exactly their fields; resolve, reopen and delete are refused before any bridge request; a comment refusal keeps its token; the three journaled writes forward `addresses` and refuse a malformed one locally
import { describe, it, expect } from 'vitest';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerCommentsTool } from '../../../src/tools/comments.js';
import { registerDocumentTool } from '../../../src/tools/document.js';
import { registerSelectionTool } from '../../../src/tools/selection.js';
import { registerWorkflowTool } from '../../../src/tools/workflow.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson, toolText } from '../../utils/toolResult.js';

function harness(handlers: Record<string, (r: BridgeRequest) => BridgeResponse> = {}) {
  const bridge = new MockBridge();
  for (const [type, handler] of Object.entries(handlers)) bridge.setResponseHandler(type, handler);
  const server = new VMarkMcpServer({ bridge });
  registerCommentsTool(server);
  registerDocumentTool(server);
  registerSelectionTool(server);
  registerWorkflowTool(server);
  return { server, bridge };
}

const ok = (data: unknown) => (): BridgeResponse => ({ success: true, data });

describe('the comments tool', () => {
  it('lists through vmark.comments.list for the named tab', async () => {
    const list = { doc: null, generation: '0', threads: [] };
    const { server, bridge } = harness({ 'vmark.comments.list': ok(list) });
    const result = await server.callTool('comments', { action: 'list', tabId: 'tab-2' });
    expect(bridge.getRequestsOfType('vmark.comments.list')[0].request).toEqual({ type: 'vmark.comments.list', tabId: 'tab-2' });
    expect(toolJson(result)).toEqual(list);
  });

  it('replies with the comment id, body and commentGen, and no reply id', async () => {
    const { server, bridge } = harness({ 'vmark.comments.reply': ok({ reply: 'r1' }) });
    await server.callTool('comments', { action: 'reply', commentId: 'c3', body: '第二段 fixed', expectedCommentGen: '2' });
    expect(bridge.getRequestsOfType('vmark.comments.reply')[0].request).toEqual({
      type: 'vmark.comments.reply',
      tabId: undefined,
      commentId: 'c3',
      body: '第二段 fixed',
      expectedCommentGen: '2',
    });
  });

  it('marks addressed with the comment id and commentGen', async () => {
    const { server, bridge } = harness({ 'vmark.comments.mark_addressed': ok({ state: 'addressed' }) });
    await server.callTool('comments', { action: 'mark_addressed', commentId: 'c3', expectedCommentGen: '2' });
    expect(bridge.getRequestsOfType('vmark.comments.mark_addressed')[0].request).toEqual({
      type: 'vmark.comments.mark_addressed',
      tabId: undefined,
      commentId: 'c3',
      expectedCommentGen: '2',
    });
  });

  it.each(['resolve', 'reopen', 'delete'])('refuses %s before any bridge request', async (action) => {
    const { server, bridge } = harness();
    const result = await server.callTool('comments', { action, commentId: 'c3', expectedCommentGen: '2' });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('list, reply, mark_addressed');
    expect(bridge.requests).toHaveLength(0);
  });

  it.each([
    [{ action: 'reply', body: 'x', expectedCommentGen: '2' }, 'commentId'],
    [{ action: 'reply', commentId: 'c3', expectedCommentGen: '2' }, 'body'],
    [{ action: 'mark_addressed', commentId: 'c3' }, 'expectedCommentGen'],
    [{ action: 'list', tabId: ' ' }, 'tabId'],
  ])('refuses %o locally, naming %s', async (args, field) => {
    const { server, bridge } = harness();
    const result = await server.callTool('comments', args);
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain(field);
    expect(bridge.requests).toHaveLength(0);
  });

  it('passes a comment refusal through with its token', async () => {
    const refusal = JSON.stringify({ error: 'STALE_COMMENT', message: 'the thread moved' });
    const { server } = harness({ 'vmark.comments.reply': () => ({ success: false, error: refusal }) });
    const result = await server.callTool('comments', { action: 'reply', commentId: 'c3', body: 'x', expectedCommentGen: '2' });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('STALE_COMMENT');
  });
});

describe('addresses on the journaled writes', () => {
  it.each([
    ['document', { action: 'write', content: 'x' }, 'vmark.document.write'],
    ['document', { action: 'transform', kind: 'cjk-spacing' }, 'vmark.document.transform'],
    ['selection', { action: 'set', content: 'x' }, 'vmark.selection.set'],
    ['workflow', { action: 'apply_patch', patches: [] }, 'vmark.workflow.apply_patch'],
  ] as const)('%s %o forwards addresses to %s', async (tool, args, type) => {
    const { server, bridge } = harness({ [type]: ok({ revision: 'r2' }) });
    await server.callTool(tool, { ...args, addresses: ['c1', 'c2'] });
    expect(bridge.getRequestsOfType(type)[0].request).toMatchObject({ addresses: ['c1', 'c2'] });
  });

  it.each([
    ['selection', { action: 'set', content: 'x' }, 'c1'],
    ['selection', { action: 'set', content: 'x' }, [1]],
    ['selection', { action: 'set', content: 'x' }, ['']],
    ['document', { action: 'write', content: 'x' }, 'c1'],
    ['document', { action: 'transform', kind: 'cjk-spacing' }, [1]],
    ['workflow', { action: 'apply_patch', patches: [] }, ['']],
  ] as const)('%s %o refuses addresses %o before any bridge request', async (tool, args, addresses) => {
    const { server, bridge } = harness();
    const result = await server.callTool(tool, { ...args, addresses });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('addresses');
    expect(bridge.requests).toHaveLength(0);
  });
});
