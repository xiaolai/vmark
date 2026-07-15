// WI-2.5/R5 — the browser tool's approval path.
// WI-P1.3 — the `screenshot` action (returns a base64 JPEG image content block).
//
// A refused action is NOT an ordinary error: it is a request for human consent.
// The bridge failure carries a structured envelope ({needsApproval, operation,
// url}); the tool must turn that into actionable guidance for the AI, not an
// opaque throw. Before this, BridgeResponse forbade `data` on failure and
// sendBridgeRequest did `throw new Error(response.error)` — with no `error`
// field the AI received an EMPTY error and never learned consent was pending.
import { describe, it, expect, vi } from 'vitest';
import { isNeedsApproval, type BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerBrowserTool } from '../../../src/tools/browser.js';
import { MockBridge } from '../../mocks/mockBridge.js';

describe('isNeedsApproval', () => {
  it('recognizes the approval envelope', () => {
    expect(isNeedsApproval({ needsApproval: true, operation: 'click', url: 'https://a.com' })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isNeedsApproval(null)).toBe(false);
    expect(isNeedsApproval(undefined)).toBe(false);
    expect(isNeedsApproval({})).toBe(false);
    expect(isNeedsApproval({ needsApproval: false })).toBe(false);
    expect(isNeedsApproval('needsApproval')).toBe(false);
    // Truthy-but-not-true must not pass: authority is never inferred loosely.
    expect(isNeedsApproval({ needsApproval: 'yes' })).toBe(false);
  });

  it('rejects a malformed envelope missing string operation/url', () => {
    // Consumers render `operation`/`url` directly; a bare {needsApproval:true}
    // would produce `'undefined' on undefined`. The guard must demand both.
    expect(isNeedsApproval({ needsApproval: true })).toBe(false);
    expect(isNeedsApproval({ needsApproval: true, operation: 'click' })).toBe(false);
    expect(isNeedsApproval({ needsApproval: true, url: 'https://a.com' })).toBe(false);
    expect(isNeedsApproval({ needsApproval: true, operation: 3, url: 'https://a.com' })).toBe(false);
    // Empty strings are not actionable guidance.
    expect(isNeedsApproval({ needsApproval: true, operation: '', url: 'https://a.com' })).toBe(false);
    expect(isNeedsApproval({ needsApproval: true, operation: 'click', url: '' })).toBe(false);
  });
});

// Integration through the REAL server + a MockBridge — not a fabricated,
// pre-decorated Error. This exercises core-types → sendBridgeRequest →
// toErrorResult end to end, so a regression in ANY of them is caught.
describe('browser tool — integration via server.callTool', () => {
  function harness(handlers: Partial<Record<string, () => BridgeResponse>>) {
    const bridge = new MockBridge();
    for (const [type, handler] of Object.entries(handlers)) {
      bridge.setResponseHandler(type, handler as () => BridgeResponse);
    }
    const server = new VMarkMcpServer({ bridge });
    registerBrowserTool(server);
    return { server, bridge };
  }

  it('read: sends {type, tabId} and returns the snapshot as JSON', async () => {
    const snapshot = { url: 'https://x.com', snapshot: [{ role: 'button', name: 'Go' }] };
    const { server, bridge } = harness({
      'vmark.browser.read': () => ({ success: true, data: snapshot }),
    });

    const result = await server.callTool('browser', { action: 'read', tabId: 'tab-2' });

    const req = bridge.getRequestsOfType('vmark.browser.read');
    expect(req).toHaveLength(1);
    expect(req[0].request).toEqual({ type: 'vmark.browser.read', tabId: 'tab-2' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(snapshot);
  });

  it('click: forwards operation/role/name and no text field', async () => {
    const { server, bridge } = harness({
      'vmark.browser.act': () => ({ success: true, data: { ok: true } }),
    });

    await server.callTool('browser', {
      action: 'act', operation: 'click', role: 'button', name: 'Publish',
    });

    const req = bridge.getRequestsOfType('vmark.browser.act')[0].request;
    expect(req).toEqual({
      type: 'vmark.browser.act', operation: 'click', role: 'button', name: 'Publish',
    });
    expect('text' in req).toBe(false);
  });

  it('act by ref: forwards {operation, ref} with no role/name', async () => {
    const { server, bridge } = harness({
      'vmark.browser.act': () => ({ success: true, data: { ok: true } }),
    });
    await server.callTool('browser', { action: 'act', operation: 'click', ref: 'e5' });
    const req = bridge.getRequestsOfType('vmark.browser.act')[0].request as Record<string, unknown>;
    expect(req).toEqual({ type: 'vmark.browser.act', operation: 'click', ref: 'e5' });
    expect('role' in req).toBe(false);
  });

  it('act: refuses ref and role/name together, never touching the bridge', async () => {
    const { server, bridge } = harness({
      'vmark.browser.act': () => ({ success: true, data: {} }),
    });
    const result = await server.callTool('browser', {
      action: 'act', operation: 'click', ref: 'e5', role: 'button', name: 'X',
    });
    expect(result.isError).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.act')).toHaveLength(0);
  });

  it('type: propagates the text payload', async () => {
    const { server, bridge } = harness({
      'vmark.browser.act': () => ({ success: true, data: { ok: true } }),
    });

    await server.callTool('browser', {
      action: 'act', operation: 'type', role: 'textbox', name: 'Title', text: 'Hello',
    });

    const req = bridge.getRequestsOfType('vmark.browser.act')[0].request;
    expect(req).toMatchObject({ operation: 'type', role: 'textbox', name: 'Title', text: 'Hello' });
  });

  it('type: forwards an explicit empty string (intentional clear)', async () => {
    const { server, bridge } = harness({
      'vmark.browser.act': () => ({ success: true, data: { ok: true } }),
    });

    await server.callTool('browser', {
      action: 'act', operation: 'type', role: 'textbox', name: 'Title', text: '',
    });

    const req = bridge.getRequestsOfType('vmark.browser.act')[0].request as { text?: unknown };
    expect(req.text).toBe('');
  });

  it('type: refuses when text is omitted, never touching the bridge', async () => {
    const { server, bridge } = harness({
      'vmark.browser.act': () => ({ success: true, data: { ok: true } }),
    });

    const result = await server.callTool('browser', {
      action: 'act', operation: 'type', role: 'textbox', name: 'Title',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("'type' requires");
    expect(bridge.getRequestsOfType('vmark.browser.act')).toHaveLength(0);
  });

  it('rejects a blank tabId instead of silently using the active tab', async () => {
    const { server, bridge } = harness({
      'vmark.browser.read': () => ({ success: true, data: {} }),
    });

    const result = await server.callTool('browser', { action: 'read', tabId: '   ' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('tabId');
    expect(bridge.requests).toHaveLength(0);
  });

  it('surfaces a bridge approval refusal (success:false + data) as guidance', async () => {
    // The bridge fails WITH an approval envelope on `data`. This is the exact
    // shape the previous test faked; here it flows through the real stack.
    const { server } = harness({
      'vmark.browser.act': () => ({
        success: false,
        error: 'blocked',
        data: { needsApproval: true, operation: 'click', url: 'https://blog.example.com' },
      }),
    });

    const result = await server.callTool('browser', {
      action: 'act', operation: 'click', role: 'button', name: 'Publish',
    });

    const text = result.content.map((c) => c.text).join('\n');
    expect(result.isError).toBe(true);
    expect(text).toContain('approval');
    expect(text).toContain('click');
    expect(text).toContain('https://blog.example.com');
  });

  it('reports an ordinary bridge failure (no approval data) as a plain error', async () => {
    const { server } = harness({
      'vmark.browser.read': () => ({ success: false, error: 'no active browser tab' }),
    });

    const result = await server.callTool('browser', { action: 'read' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no active browser tab');
  });

  it('open: forwards the URL and bounded timeout', async () => {
    const { server, bridge } = harness({
      'vmark.browser.open': () => ({
        success: true,
        data: { tabId: 'ai-1', navigationId: 'nav-1', loading: false },
      }),
    });
    const result = await server.callTool('browser', {
      action: 'open', url: 'https://example.com', timeoutMs: 5000,
    });
    expect(bridge.getRequestsOfType('vmark.browser.open')[0].request).toEqual({
      type: 'vmark.browser.open', url: 'https://example.com', timeoutMs: 5000,
    });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ tabId: 'ai-1' });
  });

  it('navigate: rejects an invalid timeout before touching the bridge', async () => {
    const { server, bridge } = harness({
      'vmark.browser.navigate': () => ({ success: true, data: {} }),
    });
    const result = await server.callTool('browser', {
      action: 'navigate', url: 'https://example.com', timeoutMs: 12_001,
    });
    expect(result.isError).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.navigate')).toHaveLength(0);
  });

  it('wait: forwards an existing navigation ticket without creating a navigation', async () => {
    const { server, bridge } = harness({
      'vmark.browser.wait': () => ({ success: true, data: { navigationId: 'nav-2', loading: false } }),
    });
    await server.callTool('browser', {
      action: 'wait', tabId: 'ai-1', navigationId: 'nav-2', timeoutMs: 100,
    });
    expect(bridge.getRequestsOfType('vmark.browser.wait')[0].request).toEqual({
      type: 'vmark.browser.wait', tabId: 'ai-1', navigationId: 'nav-2', timeoutMs: 100,
    });
  });

  it('screenshot: returns an image content block with the JPEG data and the url as text', async () => {
    const { server, bridge } = harness({
      'vmark.browser.screenshot': () => ({
        success: true,
        data: { url: 'https://shop.example.com/cart', image: 'BASE64JPEG' },
      }),
    });

    const result = await server.callTool('browser', { action: 'screenshot', tabId: 'ai-1' });

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
    await server.callTool('browser', { action: 'screenshot' });
    expect(bridge.getRequestsOfType('vmark.browser.screenshot')[0].request).toEqual({
      type: 'vmark.browser.screenshot',
    });
  });

  it('screenshot: reports a missing image as an error rather than a broken block', async () => {
    const { server } = harness({
      'vmark.browser.screenshot': () => ({ success: true, data: { url: 'https://x.com' } }),
    });
    const result = await server.callTool('browser', { action: 'screenshot' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no image');
  });

  it('wait_for: forwards a single condition and the bounded timeout', async () => {
    const { server, bridge } = harness({
      'vmark.browser.wait_for': () => ({ success: true, data: { matched: true } }),
    });
    await server.callTool('browser', { action: 'wait_for', text: 'Done', timeoutMs: 3000 });
    expect(bridge.getRequestsOfType('vmark.browser.wait_for')[0].request).toEqual({
      type: 'vmark.browser.wait_for', text: 'Done', timeoutMs: 3000,
    });
  });

  it('wait_for: refuses zero or multiple conditions without touching the bridge', async () => {
    const { server, bridge } = harness({
      'vmark.browser.wait_for': () => ({ success: true, data: {} }),
    });
    expect((await server.callTool('browser', { action: 'wait_for' })).isError).toBe(true);
    expect(
      (await server.callTool('browser', { action: 'wait_for', text: 'a', role: 'button' })).isError,
    ).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.wait_for')).toHaveLength(0);
  });
});

describe('registerBrowserTools — approval handling', () => {
  /** Minimal harness: capture the handler `registerBrowserTool` registers. */
  async function harness(sendBridgeRequest: (req: unknown) => Promise<unknown>) {
    const { registerBrowserTool } = await import('../../../src/tools/browser.js');
    let handler!: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
    const server = {
      registerTool: (_config: unknown, h: typeof handler) => {
        handler = h;
      },
      sendBridgeRequest: vi.fn(sendBridgeRequest),
    };
    registerBrowserTool(server as never);
    return { handler, server };
  }

  it('surfaces an approval request as actionable guidance, not an empty error', async () => {
    // The sidecar throws when the bridge reports failure; the approval envelope
    // rides on the thrown error.
    const { handler } = await harness(async () => {
      const err = new Error("approval required: 'click' on https://blog.example.com") as Error & {
        data?: unknown;
      };
      err.data = { needsApproval: true, operation: 'click', url: 'https://blog.example.com' };
      throw err;
    });

    const result = await handler({
      action: 'act',
      operation: 'click',
      role: 'button',
      name: 'Publish',
    });

    const text = result.content.map((c) => c.text).join('\n');
    // The AI must be able to tell the human WHAT is being asked for.
    expect(text).toContain('approval');
    expect(text).toContain('click');
    expect(text).toContain('https://blog.example.com');
    // And it must not look like a success.
    expect(result.isError).toBe(true);
  });

  it('still reports ordinary failures as errors', async () => {
    const { handler } = await harness(async () => {
      throw new Error('no active browser tab');
    });

    const result = await handler({ action: 'act', operation: 'click', role: 'button', name: 'X' });
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).toContain('no active browser tab');
    expect(result.isError).toBe(true);
  });

  it('rejects an act with a missing role or name instead of targeting the first element', async () => {
    const { handler, server } = await harness(async () => ({}));
    const result = await handler({ action: 'act', operation: 'click', role: '', name: '' });
    expect(result.isError).toBe(true);
    expect(server.sendBridgeRequest).not.toHaveBeenCalled();
  });
});
