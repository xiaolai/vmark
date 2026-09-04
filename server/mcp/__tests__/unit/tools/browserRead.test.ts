// browser_read — the non-mutating half of the embedded-browser surface.
//
// These assertions were written against the composite `browser` tool and moved
// here verbatim when it was split, so they still prove exactly what they proved
// before: each read forwards the right bridge request and passes the result
// through untouched. What is NEW is the last block — the guarantee that makes
// the split worth doing, namely that nothing reachable from this tool can
// modify the page, the tab, or VMark.
import { describe, it, expect } from 'vitest';
import type { BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerBrowserReadTool } from '../../../src/tools/browserRead.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson, toolText } from '../../utils/toolResult.js';

describe('browser_read tool — integration via server.callTool', () => {
  function harness(handlers: Partial<Record<string, () => BridgeResponse>>) {
    const bridge = new MockBridge();
    for (const [type, handler] of Object.entries(handlers)) {
      bridge.setResponseHandler(type, handler as () => BridgeResponse);
    }
    const server = new VMarkMcpServer({ bridge });
    registerBrowserReadTool(server);
    return { server, bridge };
  }

  it('read: sends {type, tabId} and returns the snapshot as JSON', async () => {
    const snapshot = { url: 'https://x.com', snapshot: [{ role: 'button', name: 'Go' }] };
    const { server, bridge } = harness({
      'vmark.browser.read': () => ({ success: true, data: snapshot }),
    });

    const result = await server.callTool('browser_read', { action: 'read', tabId: 'tab-2' });

    const req = bridge.getRequestsOfType('vmark.browser.read');
    expect(req).toHaveLength(1);
    expect(req[0].request).toEqual({ type: 'vmark.browser.read', tabId: 'tab-2' });
    expect(result.isError).toBeUndefined();
    expect(toolJson(result)).toEqual(snapshot);
  });

  it('rejects a blank tabId instead of silently using the active tab', async () => {
    const { server, bridge } = harness({
      'vmark.browser.read': () => ({ success: true, data: {} }),
    });

    const result = await server.callTool('browser_read', { action: 'read', tabId: '   ' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('tabId');
    expect(bridge.requests).toHaveLength(0);
  });

  it.each([
    { text: 'Done', role: 'button' },
    { ref: 'e1', text: 'Done' },
    { ref: 'e1', urlContains: '/next' },
    {},
  ])('wait_for: refuses %j — exactly one mode, never a silent pick', async (modes) => {
    const { server, bridge } = harness({ 'vmark.browser.waitFor': () => ({ success: true, data: { matched: true } }) });
    const result = await server.callTool('browser_read', { action: 'wait_for', ...modes });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('exactly one');
    expect(bridge.requests).toHaveLength(0);
  });

  it('wait_for: refuses a name without a role instead of ignoring it', async () => {
    const { server, bridge } = harness({ 'vmark.browser.waitFor': () => ({ success: true, data: { matched: true } }) });
    const result = await server.callTool('browser_read', { action: 'wait_for', text: 'Done', name: 'Save' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('`name`');
    expect(bridge.requests).toHaveLength(0);
  });

  it('reports an ordinary bridge failure (no approval data) as a plain error', async () => {
    const { server } = harness({
      'vmark.browser.read': () => ({ success: false, error: 'no active browser tab' }),
    });

    const result = await server.callTool('browser_read', { action: 'read' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no active browser tab');
  });

  it('surfaces an approval refusal as guidance (a human tab needs attachment)', async () => {
    // A read is not automatically permitted: reading a tab the user owns
    // requires attachment. The refusal must arrive as consent guidance, not as
    // an opaque error, exactly as it does on the mutating half.
    const { server } = harness({
      'vmark.browser.read': () => ({
        success: false,
        error: 'blocked',
        data: { needsApproval: true, operation: 'read', url: 'https://mail.example.com' },
      }),
    });

    const result = await server.callTool('browser_read', { action: 'read' });

    const text = result.content.map((c) => c.text).join('\n');
    expect(result.isError).toBe(true);
    expect(text).toContain('approval');
    expect(text).toContain('https://mail.example.com');
  });

  it('wait: forwards an existing navigation ticket without creating a navigation', async () => {
    const { server, bridge } = harness({
      'vmark.browser.wait': () => ({ success: true, data: { navigationId: 'nav-2', loading: false } }),
    });
    await server.callTool('browser_read', {
      action: 'wait', tabId: 'ai-1', navigationId: 'nav-2', timeoutMs: 100,
    });
    expect(bridge.getRequestsOfType('vmark.browser.wait')[0].request).toEqual({
      type: 'vmark.browser.wait', tabId: 'ai-1', navigationId: 'nav-2', timeoutMs: 100,
    });
  });

  it('wait: refuses a blank navigationId rather than waiting on the wrong ticket', async () => {
    const { server, bridge } = harness({});

    const result = await server.callTool('browser_read', { action: 'wait', navigationId: '  ' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('navigationId');
    expect(bridge.requests).toHaveLength(0);
  });

  it('screenshot: returns an image content block with the JPEG data and the url as text', async () => {
    const { server, bridge } = harness({
      'vmark.browser.screenshot': () => ({
        success: true,
        data: { url: 'https://shop.example.com/cart', image: 'BASE64JPEG' },
      }),
    });

    const result = await server.callTool('browser_read', { action: 'screenshot', tabId: 'ai-1' });

    expect(bridge.getRequestsOfType('vmark.browser.screenshot')[0].request).toEqual({
      type: 'vmark.browser.screenshot', tabId: 'ai-1',
    });
    expect(result.isError).toBeUndefined();
    const image = result.content.find((c) => c.type === 'image');
    expect(image).toEqual({ type: 'image', data: 'BASE64JPEG', mimeType: 'image/jpeg' });
    // The url rides along as text so the model knows what it is looking at.
    expect(result.content.some((c) => c.type === 'text' && c.text?.includes('shop.example.com'))).toBe(true);
  });

  it('screenshot: omits tabId to target the focused tab', async () => {
    const { server, bridge } = harness({
      'vmark.browser.screenshot': () => ({ success: true, data: { url: 'https://x.com', image: 'AA' } }),
    });
    await server.callTool('browser_read', { action: 'screenshot' });
    expect(bridge.getRequestsOfType('vmark.browser.screenshot')[0].request).toEqual({
      type: 'vmark.browser.screenshot',
    });
  });

  it('screenshot: reports a missing image as an error rather than a broken block', async () => {
    const { server } = harness({
      'vmark.browser.screenshot': () => ({ success: true, data: { url: 'https://x.com' } }),
    });
    const result = await server.callTool('browser_read', { action: 'screenshot' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no image');
  });

  it('wait_for: forwards a single condition and the bounded timeout', async () => {
    const { server, bridge } = harness({
      'vmark.browser.wait_for': () => ({ success: true, data: { matched: true } }),
    });
    await server.callTool('browser_read', { action: 'wait_for', text: 'Done', timeoutMs: 3000 });
    expect(bridge.getRequestsOfType('vmark.browser.wait_for')[0].request).toEqual({
      type: 'vmark.browser.wait_for', text: 'Done', timeoutMs: 3000,
    });
  });

  it('wait_for: refuses zero or multiple conditions without touching the bridge', async () => {
    const { server, bridge } = harness({
      'vmark.browser.wait_for': () => ({ success: true, data: {} }),
    });
    expect((await server.callTool('browser_read', { action: 'wait_for' })).isError).toBe(true);
    expect(
      (await server.callTool('browser_read', { action: 'wait_for', text: 'a', role: 'button' })).isError,
    ).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.wait_for')).toHaveLength(0);
  });

  it('query: forwards selector + fields', async () => {
    const { server, bridge } = harness({ 'vmark.browser.query': () => ({ success: true, data: { count: 0, elements: [] } }) });
    await server.callTool('browser_read', { action: 'query', selector: 'table', fields: { attributes: true } });
    expect(bridge.getRequestsOfType('vmark.browser.query')[0].request).toEqual({
      type: 'vmark.browser.query', selector: 'table', fields: { attributes: true },
    });
  });

  it('extract: omits tabId when none is given so the webview reads the focused tab', async () => {
    const { server, bridge } = harness({
      'vmark.browser.extract': () => ({ success: true, data: { title: 'T', markdown: '# T', truncated: false } }),
    });
    await server.callTool('browser_read', { action: 'extract' });
    expect(bridge.getRequestsOfType('vmark.browser.extract')[0].request).toEqual({
      type: 'vmark.browser.extract',
    });
  });

  it('wait_for: a role without a name is forwarded as the role alone', async () => {
    const { server, bridge } = harness({
      'vmark.browser.wait_for': () => ({ success: true, data: { matched: true } }),
    });
    await server.callTool('browser_read', { action: 'wait_for', role: 'button' });
    expect(bridge.getRequestsOfType('vmark.browser.wait_for')[0].request).toEqual({
      type: 'vmark.browser.wait_for', role: 'button',
    });
  });

  it('extract: forwards to the reader-mode bridge op', async () => {
    const { server, bridge } = harness({
      'vmark.browser.extract': () => ({ success: true, data: { title: 'T', markdown: '# T', truncated: false } }),
    });
    await server.callTool('browser_read', { action: 'extract', tabId: 'b1' });
    expect(bridge.getRequestsOfType('vmark.browser.extract')[0].request).toEqual({
      type: 'vmark.browser.extract', tabId: 'b1',
    });
  });

  it('workflow_status: forwards the runId; rejects a missing one', async () => {
    const { server, bridge } = harness({
      'vmark.browser.workflow_status': () => ({ success: true, data: { status: 'running', completedSteps: 0 } }),
    });
    await server.callTool('browser_read', { action: 'workflow_status', runId: 'wfrun-1' });
    expect(bridge.getRequestsOfType('vmark.browser.workflow_status')[0].request).toEqual({
      type: 'vmark.browser.workflow_status', runId: 'wfrun-1',
    });
    const bad = await server.callTool('browser_read', { action: 'workflow_status' });
    expect(bad.isError).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.workflow_status')).toHaveLength(1);
  });

  it('query: refuses a missing selector', async () => {
    const { server, bridge } = harness({ 'vmark.browser.query': () => ({ success: true, data: {} }) });
    expect((await server.callTool('browser_read', { action: 'query' })).isError).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.query')).toHaveLength(0);
  });

  it.each([
    ['wait', { action: 'wait' }],
    ['wait_for', { action: 'wait_for', text: 'Done' }],
  ])('%s: refuses an out-of-range timeoutMs', async (_label, args) => {
    const { server, bridge } = harness({});

    for (const timeoutMs of [0, 12_001, 1.5, 'soon']) {
      const result = await server.callTool('browser_read', { ...args, timeoutMs });
      expect(result.isError, String(timeoutMs)).toBe(true);
      expect(toolText(result)).toContain('timeoutMs must be an integer from 1 to 9000');
    }
    expect(bridge.requests).toHaveLength(0);
  });

  it('refuses an unknown action', async () => {
    const { server, bridge } = harness({});

    const result = await server.callTool('browser_read', { action: 'teleport' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('unknown action: teleport');
    expect(bridge.requests).toHaveLength(0);
  });
});

// The property the split exists to guarantee. `readOnlyHint: true` is a promise
// to every client that auto-approves this tool; these assertions are what stop
// a future action from quietly breaking it.
describe('browser_read tool — the read-only guarantee', () => {
  it('never sends a mutating bridge request, whatever the caller asks for', async () => {
    const bridge = new MockBridge();
    for (const type of [
      'vmark.browser.read', 'vmark.browser.screenshot', 'vmark.browser.query',
      'vmark.browser.console', 'vmark.browser.wait', 'vmark.browser.wait_for',
    ]) {
      bridge.setResponseHandler(type, () => ({ success: true, data: { image: 'AA' } }));
    }
    const server = new VMarkMcpServer({ bridge });
    registerBrowserReadTool(server);

    // Every action the tool advertises, plus the mutating verbs a caller might
    // try to smuggle in by name now that they live on the sibling tool.
    const attempts: Record<string, unknown>[] = [
      { action: 'read' },
      { action: 'screenshot' },
      { action: 'query', selector: 'body' },
      { action: 'console' },
      { action: 'wait' },
      { action: 'wait_for', text: 'Done' },
      { action: 'act', operation: 'click', role: 'button', name: 'Delete' },
      { action: 'execute_js', script: 'document.body.remove()' },
      { action: 'style', selector: 'body', set: { display: 'none' } },
      { action: 'open', url: 'https://evil.example.com' },
      { action: 'navigate', url: 'https://evil.example.com' },
      { action: 'session_save', handle: 'work' },
      { action: 'session_load', handle: 'work' },
      { action: 'console_clear' },
    ];
    for (const args of attempts) {
      await server.callTool('browser_read', args);
    }

    const MUTATING = [
      'vmark.browser.act', 'vmark.browser.open', 'vmark.browser.navigate',
      'vmark.browser.style', 'vmark.browser.execute_js',
      'vmark.browser.session.save', 'vmark.browser.session.load',
    ];
    for (const type of MUTATING) {
      expect(bridge.getRequestsOfType(type), type).toHaveLength(0);
    }
  });

  it('never asks the app to drain the console buffer', async () => {
    // `clear: true` evaluates `e.textContent = "[]"` in the page — a DOM write.
    // Passing it must not reach the bridge from the read-only tool, even though
    // the app-side handler still understands the flag for `console_clear`.
    const bridge = new MockBridge();
    bridge.setResponseHandler('vmark.browser.console', () => ({ success: true, data: { entries: [] } }));
    const server = new VMarkMcpServer({ bridge });
    registerBrowserReadTool(server);

    await server.callTool('browser_read', { action: 'console' });
    await server.callTool('browser_read', { action: 'console', clear: true });

    for (const { request } of bridge.getRequestsOfType('vmark.browser.console')) {
      expect(request).toEqual({ type: 'vmark.browser.console' });
    }
  });
});
