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
import { toolJson, toolText } from '../../utils/toolResult.js';

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

  it('act scroll: forwards a delta scroll', async () => {
    const { server, bridge } = harness({ 'vmark.browser.act': () => ({ success: true, data: { scrolled: true } }) });
    await server.callTool('browser', { action: 'act', operation: 'scroll', dy: 400 });
    expect(bridge.getRequestsOfType('vmark.browser.act')[0].request).toEqual({
      type: 'vmark.browser.act', operation: 'scroll', dy: 400,
    });
  });

  it('act scroll: refuses both ref and dy', async () => {
    const { server, bridge } = harness({ 'vmark.browser.act': () => ({ success: true, data: {} }) });
    const r = await server.callTool('browser', { action: 'act', operation: 'scroll', ref: 'e1', dy: 10 });
    expect(r.isError).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.act')).toHaveLength(0);
  });

  it('act key: forwards key + modifiers', async () => {
    const { server, bridge } = harness({ 'vmark.browser.act': () => ({ success: true, data: { dispatched: true } }) });
    await server.callTool('browser', { action: 'act', operation: 'key', key: 'Enter', modifiers: { ctrl: true } });
    expect(bridge.getRequestsOfType('vmark.browser.act')[0].request).toEqual({
      type: 'vmark.browser.act', operation: 'key', key: 'Enter', modifiers: { ctrl: true },
    });
  });

  it('act key: refuses a missing key name', async () => {
    const { server, bridge } = harness({ 'vmark.browser.act': () => ({ success: true, data: {} }) });
    const r = await server.callTool('browser', { action: 'act', operation: 'key' });
    expect(r.isError).toBe(true);
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

  it('rejects a blank tabId instead of silently mutating the active tab', async () => {
    const { server, bridge } = harness({
      'vmark.browser.act': () => ({ success: true, data: {} }),
    });

    const result = await server.callTool('browser', {
      action: 'act', operation: 'click', role: 'button', name: 'Delete', tabId: '   ',
    });

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
    expect(toolJson(result)).toMatchObject({ tabId: 'ai-1' });
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

  it('style: forwards selector + set, and refuses when no op is given', async () => {
    const { server, bridge } = harness({ 'vmark.browser.style': () => ({ success: true, data: { styled: true } }) });
    await server.callTool('browser', { action: 'style', selector: '.overlay', set: { display: 'none' } });
    expect(bridge.getRequestsOfType('vmark.browser.style')[0].request).toEqual({
      type: 'vmark.browser.style', selector: '.overlay', set: { display: 'none' },
    });
    expect((await server.callTool('browser', { action: 'style', selector: '.x' })).isError).toBe(true);
  });

  it('execute_js: forwards the script, and refuses a missing one', async () => {
    const { server, bridge } = harness({ 'vmark.browser.execute_js': () => ({ success: true, data: { result: 1, untrusted: true } }) });
    await server.callTool('browser', { action: 'execute_js', script: 'return 1;' });
    expect(bridge.getRequestsOfType('vmark.browser.execute_js')[0].request).toEqual({
      type: 'vmark.browser.execute_js', script: 'return 1;',
    });
    expect((await server.callTool('browser', { action: 'execute_js' })).isError).toBe(true);
  });

  it('execute_js: refuses an oversized script before it crosses the bridge', async () => {
    const { server, bridge } = harness({ 'vmark.browser.execute_js': () => ({ success: true, data: {} }) });
    const r = await server.callTool('browser', { action: 'execute_js', script: 'x'.repeat(64 * 1024 + 1) });
    expect(r.isError).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.execute_js')).toHaveLength(0);
  });

  it('console_clear: always drains, so the caller cannot get a silent no-op read', async () => {
    // The draining half of the old `console` action. `clear` is no longer a
    // caller-supplied flag — this action IS the drain, so it must send
    // clear:true unconditionally rather than depend on an argument the schema
    // no longer advertises.
    const { server, bridge } = harness({ 'vmark.browser.console': () => ({ success: true, data: { entries: [] } }) });
    await server.callTool('browser', { action: 'console_clear' });
    await server.callTool('browser', { action: 'console_clear', clear: false });
    for (const { request } of bridge.getRequestsOfType('vmark.browser.console')) {
      expect(request).toEqual({ type: 'vmark.browser.console', clear: true });
    }
    expect(bridge.getRequestsOfType('vmark.browser.console')).toHaveLength(2);
  });

  it('close: forwards the AI-owned tabId; refuses to guess a tab', async () => {
    const { server, bridge } = harness({
      'vmark.browser.close': () => ({ success: true, data: { closed: 'b1' } }),
    });
    const closed = await server.callTool('browser', { action: 'close', tabId: 'b1' });
    expect(closed.isError).not.toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.close')[0].request).toEqual({
      type: 'vmark.browser.close',
      tabId: 'b1',
    });
    // Unlike navigate, close never falls back to the focused tab: an omitted id
    // must not close whatever the user happens to be looking at.
    const none = await server.callTool('browser', { action: 'close' });
    expect(none.isError).toBe(true);
    expect(none.content[0]?.type === 'text' ? none.content[0].text : '').toContain('tabId');
    expect(bridge.getRequestsOfType('vmark.browser.close')).toHaveLength(1);
  });

  it('workflow_run: forwards source/inputs/allowRepeat; rejects a blank source', async () => {
    const { server, bridge } = harness({
      'vmark.browser.workflow_run': () => ({ success: true, data: { runId: 'wfrun-1', steps: 2 } }),
    });
    await server.callTool('browser', {
      action: 'workflow_run',
      source: '1. action: click "OK"',
      inputs: { a: 'b' },
      allowRepeat: true,
    });
    expect(bridge.getRequestsOfType('vmark.browser.workflow_run')[0].request).toEqual({
      type: 'vmark.browser.workflow_run',
      source: '1. action: click "OK"',
      inputs: { a: 'b' },
      allowRepeat: true,
    });
    const blank = await server.callTool('browser', { action: 'workflow_run', source: '   ' });
    expect(blank.isError).toBe(true);
    const none = await server.callTool('browser', { action: 'workflow_run' });
    expect(none.isError).toBe(true);
  });

  it('workflow_cancel: forwards the runId; rejects a missing one', async () => {
    const { server, bridge } = harness({
      'vmark.browser.workflow_cancel': () => ({ success: true, data: { runId: 'wfrun-1', status: 'cancelled' } }),
    });
    await server.callTool('browser', { action: 'workflow_cancel', runId: 'wfrun-1' });
    expect(bridge.getRequestsOfType('vmark.browser.workflow_cancel')[0].request).toEqual({
      type: 'vmark.browser.workflow_cancel',
      runId: 'wfrun-1',
    });
    const bad = await server.callTool('browser', { action: 'workflow_cancel' });
    expect(bad.isError).toBe(true);
  });

  it('workflow_record: forwards recordOp + optional site; rejects a missing recordOp', async () => {
    const { server, bridge } = harness({
      'vmark.browser.workflow_record': () => ({ success: true, data: { status: 'recording', tabId: 'b1' } }),
    });
    // With a site.
    await server.callTool('browser', { action: 'workflow_record', tabId: 'b1', recordOp: 'start', site: 'blog' });
    expect(bridge.getRequestsOfType('vmark.browser.workflow_record')[0].request).toEqual({
      type: 'vmark.browser.workflow_record',
      tabId: 'b1',
      recordOp: 'start',
      site: 'blog',
    });
    // Without a tabId or a site (the tabId-absent and site-absent branches).
    await server.callTool('browser', { action: 'workflow_record', recordOp: 'stop' });
    expect(bridge.getRequestsOfType('vmark.browser.workflow_record')[1].request).toEqual({
      type: 'vmark.browser.workflow_record',
      recordOp: 'stop',
    });
    // A missing/invalid recordOp is rejected before touching the bridge.
    const bad = await server.callTool('browser', { action: 'workflow_record' });
    expect(bad.isError).toBe(true);
  });

  it('session_save / session_load: forward the handle; reject a bad one', async () => {
    const { server, bridge } = harness({
      'vmark.browser.session.save': () => ({ success: true, data: { handle: 'work', summary: '0 cookie(s)' } }),
      'vmark.browser.session.load': () => ({ success: true, data: { loaded: true } }),
    });
    await server.callTool('browser', { action: 'session_save', handle: 'work_login' });
    expect(bridge.getRequestsOfType('vmark.browser.session.save')[0].request).toEqual({
      type: 'vmark.browser.session.save', handle: 'work_login',
    });
    await server.callTool('browser', { action: 'session_load', handle: 'work_login' });
    expect(bridge.getRequestsOfType('vmark.browser.session.load')[0].request).toEqual({
      type: 'vmark.browser.session.load', handle: 'work_login',
    });
    // A path-traversal-ish handle never reaches the bridge.
    expect((await server.callTool('browser', { action: 'session_load', handle: '../secrets' })).isError).toBe(true);
    expect(bridge.getRequestsOfType('vmark.browser.session.load')).toHaveLength(1);
  });

  // Refusal branches. The SDK now rejects an out-of-range `timeoutMs` against
  // the declared Zod bounds before the handler runs, but a direct `callTool`
  // (this suite, and any non-validating client) still reaches these guards —
  // they are the last line before a malformed act touches a live page.
  it('act: refuses an unknown operation before reaching the bridge', async () => {
    const { server, bridge } = harness({});

    const result = await server.callTool('browser', {
      action: 'act', operation: 'drag', role: 'button', name: 'Go',
    });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("must be 'click', 'type', 'scroll', or 'key'");
    expect(bridge.requests).toHaveLength(0);
  });

  it.each([
    ['open', { action: 'open' }],
    ['open (blank)', { action: 'open', url: '   ' }],
    ['navigate', { action: 'navigate' }],
    ['navigate (blank)', { action: 'navigate', url: '' }],
  ])('%s: refuses a missing or blank url', async (_label, args) => {
    const { server, bridge } = harness({});

    const result = await server.callTool('browser', args);

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('url must be a non-empty string');
    expect(bridge.requests).toHaveLength(0);
  });

  it.each([
    ['open', { action: 'open', url: 'https://x.com' }],
    ['navigate', { action: 'navigate', url: 'https://x.com' }],
  ])('%s: refuses an out-of-range timeoutMs', async (_label, args) => {
    const { server, bridge } = harness({});

    for (const timeoutMs of [0, 12_001, 1.5, 'soon']) {
      const result = await server.callTool('browser', { ...args, timeoutMs });
      expect(result.isError, String(timeoutMs)).toBe(true);
      expect(toolText(result)).toContain('timeoutMs must be an integer from 1 to 9000');
    }
    expect(bridge.requests).toHaveLength(0);
  });

  it('navigate: forwards tabId, url, and a valid timeoutMs', async () => {
    const { server, bridge } = harness({
      'vmark.browser.navigate': () => ({ success: true, data: { navigationId: 'nav-1' } }),
    });

    const result = await server.callTool('browser', {
      action: 'navigate', tabId: 'ai-1', url: 'https://x.com', timeoutMs: 3000,
    });

    expect(bridge.getRequestsOfType('vmark.browser.navigate')[0].request).toEqual({
      type: 'vmark.browser.navigate', tabId: 'ai-1', url: 'https://x.com', timeoutMs: 3000,
    });
    expect(toolJson(result)).toEqual({ navigationId: 'nav-1' });
  });

  it('style: refuses an injectCss payload over the byte cap', async () => {
    const { server, bridge } = harness({});

    const result = await server.callTool('browser', {
      action: 'style', selector: 'body', injectCss: 'a'.repeat(64 * 1024 + 1),
    });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('byte limit');
    expect(bridge.requests).toHaveLength(0);
  });

  it('refuses an unknown action', async () => {
    const { server, bridge } = harness({});

    const result = await server.callTool('browser', { action: 'teleport' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('unknown action: teleport');
    expect(bridge.requests).toHaveLength(0);
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

// WI-0.5 — the tool DESCRIPTION is the AI's only contract, and it is a shipped
// string with no other test. Two facts about it were wrong or missing on the
// surface users actually reach:
//
//   1. It claimed cookie capture was "not yet implemented" for ~5 releases after
//      it shipped, so an AI reading it would tell the user a working feature does
//      not work — and would not reach for it.
//   2. It never said the feature is macOS-only, so a Windows user's AI met an
//      opaque UNSUPPORTED_PLATFORM with nothing in its contract explaining it, and
//      would reasonably retry or ask for an approval that could never help.
//
// Asserting on prose is unusual; it is justified here because this prose is an
// interface. Both checks are anchored on the specific claim, not on wording, so
// ordinary editing does not break them.
describe('browser tool description — the AI-facing contract (WI-0.5)', () => {
  async function browserToolDescription(): Promise<string> {
    const { registerBrowserTool } = await import('../../../src/tools/browser.js');
    let description = '';
    const server = {
      registerTool: (definition: { name: string; description: string }) => {
        if (definition.name === 'browser') description = definition.description;
      },
    };
    registerBrowserTool(server as never);
    return description;
  }

  it('discloses that the embedded browser is macOS-only', async () => {
    const description = await browserToolDescription();
    expect(description).toMatch(/macOS only/i);
    // And says WHY it fails elsewhere, so the AI does not treat a platform limit
    // as a permission problem it can resolve by asking for approval.
    expect(description).toMatch(/UNSUPPORTED_PLATFORM/);
  });

  it('does not claim cookie capture is unimplemented', async () => {
    const description = await browserToolDescription();
    expect(description).not.toMatch(/cookie capture is not yet implemented/i);
    // The positive half: deleting the false claim without stating the real scope
    // would leave the AI with no idea what session_save actually captures.
    expect(description).toMatch(/localStorage AND cookies/);
  });
});

describe('browser — byte-accurate payload cap (round-2 audit finding 5)', () => {
  function guard() {
    const bridge = new MockBridge();
    const server = new VMarkMcpServer({ bridge });
    registerBrowserTool(server);
    return { server, bridge };
  }

  // `.length` counts UTF-16 code units. A 30,000-character CJK script is
  // 90,000 UTF-8 BYTES — well past the 64 KiB cap the tool advertises and the
  // app renders verbatim in its approval dialog.
  const CJK_OVER_CAP = '汉'.repeat(30_000);

  it('execute_js: rejects a multi-byte script over the BYTE cap', async () => {
    const { server, bridge } = guard();

    const result = await server.callTool('browser', { action: 'execute_js', script: CJK_OVER_CAP });

    expect(CJK_OVER_CAP.length).toBeLessThan(64 * 1024); // passes a .length check
    expect(Buffer.byteLength(CJK_OVER_CAP, 'utf8')).toBeGreaterThan(64 * 1024);
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('byte limit');
    expect(bridge.requests).toHaveLength(0);
  });

  it('style: rejects multi-byte injectCss over the BYTE cap', async () => {
    const { server, bridge } = guard();

    const result = await server.callTool('browser', {
      action: 'style', selector: 'body', injectCss: CJK_OVER_CAP,
    });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('byte limit');
    expect(bridge.requests).toHaveLength(0);
  });

  it('still accepts a multi-byte payload that fits in bytes', async () => {
    const { server, bridge } = guard();
    bridge.setResponseHandler('vmark.browser.execute_js', () => ({ success: true, data: { ok: 1 } }));

    const script = '汉'.repeat(1_000);
    const result = await server.callTool('browser', { action: 'execute_js', script });

    expect(result.isError).toBeUndefined();
    expect(bridge.getRequestsOfType('vmark.browser.execute_js')[0].request).toMatchObject({ script });
  });
});

describe('browser.open — invalid profile (round-2 audit finding 6)', () => {
  it('refuses a malformed profile instead of opening an anonymous tab', async () => {
    // Coercing it to `undefined` proceeded WITHOUT the persistent context the
    // caller asked for: the agent believes it is reusing a login and is not.
    const bridge = new MockBridge();
    bridge.setResponseHandler('vmark.browser.open', () => ({ success: true, data: { tabId: 'ai-1' } }));
    const server = new VMarkMcpServer({ bridge });
    registerBrowserTool(server);

    for (const profile of ['has space', 'bad/slash', '', '  ', 'x'.repeat(65), 42]) {
      const result = await server.callTool('browser', {
        action: 'open', url: 'https://x.com', profile,
      });
      expect(result.isError, String(profile)).toBe(true);
      expect(toolText(result)).toContain('profile');
    }
    expect(bridge.requests).toHaveLength(0);
  });

  it('still forwards a valid profile', async () => {
    const bridge = new MockBridge();
    bridge.setResponseHandler('vmark.browser.open', () => ({ success: true, data: { tabId: 'ai-1' } }));
    const server = new VMarkMcpServer({ bridge });
    registerBrowserTool(server);

    await server.callTool('browser', { action: 'open', url: 'https://x.com', profile: ' work-1 ' });

    expect(bridge.getRequestsOfType('vmark.browser.open')[0].request).toMatchObject({
      profile: 'work-1',
    });
  });
});
