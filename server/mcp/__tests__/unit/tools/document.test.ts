/**
 * `document` tool — arg validation, bridge dispatch, structured output.
 *
 * The read/write spine of the surface was at 5.3% statement coverage: every
 * branch below (the save opt-out, the STALE-guard passthrough, the two
 * required-arg refusals, the unknown-action refusal) shipped untested.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerDocumentTool } from '../../../src/tools/document.js';
import { MAX_OUTPUT_BYTES } from '../../../src/utils/toolOutput.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { toolJson, toolText } from '../../utils/toolResult.js';

function harness(handlers: Record<string, (r: BridgeRequest) => BridgeResponse> = {}) {
  const bridge = new MockBridge();
  for (const [type, handler] of Object.entries(handlers)) {
    bridge.setResponseHandler(type, handler);
  }
  const server = new VMarkMcpServer({ bridge });
  registerDocumentTool(server);
  return { server, bridge };
}

/** The Zod shape an MCP client is validated against, as registered. */
function documentInputShape() {
  return harness().server.tools.get('document')!.definition.inputSchema;
}

const READ_PAYLOAD = {
  content: '# Title',
  revision: 'r1',
  filePath: '/tmp/a.md',
  kind: 'markdown',
  dirty: false,
};

describe('document.read', () => {
  it('forwards the focused tab when tabId is omitted', async () => {
    const { server, bridge } = harness({
      'vmark.document.read': () => ({ success: true, data: READ_PAYLOAD }),
    });

    const result = await server.callTool('document', { action: 'read' });

    expect(bridge.getRequestsOfType('vmark.document.read')[0].request).toEqual({
      type: 'vmark.document.read',
      tabId: undefined,
    });
    expect(result.isError).toBeUndefined();
    expect(toolJson(result)).toEqual(READ_PAYLOAD);
  });

  it('forwards an explicit tabId and mirrors the payload into structuredContent', async () => {
    const { server, bridge } = harness({
      'vmark.document.read': () => ({ success: true, data: READ_PAYLOAD }),
    });

    const result = await server.callTool('document', { action: 'read', tabId: 'tab-7' });

    expect(bridge.getRequestsOfType('vmark.document.read')[0].request).toMatchObject({
      tabId: 'tab-7',
    });
    expect(result.structuredContent).toEqual(READ_PAYLOAD);
  });

  it('refuses a non-string tabId rather than forwarding garbage', async () => {
    // It used to be dropped to `undefined`, which the frontend reads as "the
    // focused tab" — a garbled id silently retargeted the call.
    const { server, bridge } = harness({
      'vmark.document.read': () => ({ success: true, data: READ_PAYLOAD }),
    });

    const result = await server.callTool('document', { action: 'read', tabId: 42 });

    expect(result.isError).toBe(true);
    expect(bridge.requests).toHaveLength(0);
  });

  it('surfaces a bridge failure as a tool error', async () => {
    const { server } = harness({
      'vmark.document.read': () => ({ success: false, error: 'INVALID_TAB' }),
    });

    const result = await server.callTool('document', { action: 'read' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('INVALID_TAB');
  });

  it('bounds an oversized document and tells the agent not to write it back', async () => {
    // The whole reason `document.read` needed a bound: an unbounded read gets
    // silently clipped by the client, and a write-back from a clipped read
    // destroys everything the agent never saw.
    const { server } = harness({
      'vmark.document.read': () => ({
        success: true,
        data: { ...READ_PAYLOAD, content: 'x'.repeat(MAX_OUTPUT_BYTES + 5_000) },
      }),
    });

    const result = await server.callTool('document', { action: 'read' });

    const text = toolText(result);
    expect(text).toContain('OUTPUT TRUNCATED');
    expect(text).toContain('do not write back from this read');
    expect(text).toContain('selection.get');
    // The structured channel is withheld, not shipped whole — clients feed it
    // to the model too, so mirroring the payload would defeat the bound.
    expect(result.structuredContent).toMatchObject({ truncated: true });
    expect(result.structuredContent?.content).toBeUndefined();
  });
});

describe('document.write', () => {
  it('sends content and expected_revision, and omits `save` when defaulted', async () => {
    const { server, bridge } = harness({
      'vmark.document.write': () => ({
        success: true,
        data: { revision: 'r2', saved: true },
      }),
    });

    const result = await server.callTool('document', {
      action: 'write',
      content: 'new body',
      expected_revision: 'r1',
    });

    // `save` absent means "use the app default (true)". Forwarding an explicit
    // `true` would be equivalent but noisier; forwarding `undefined` would
    // reach the app as a present-but-undefined key.
    expect(bridge.getRequestsOfType('vmark.document.write')[0].request).toEqual({
      type: 'vmark.document.write',
      tabId: undefined,
      content: 'new body',
      expected_revision: 'r1',
    });
    expect(result.structuredContent).toEqual({ revision: 'r2', saved: true });
  });

  it('forwards an explicit save:false opt-out', async () => {
    const { server, bridge } = harness({
      'vmark.document.write': () => ({
        success: true,
        data: { revision: 'r2', saved: false, save_skipped: 'opt_out' },
      }),
    });

    const result = await server.callTool('document', {
      action: 'write',
      content: 'x',
      save: false,
    });

    expect(bridge.getRequestsOfType('vmark.document.write')[0].request).toMatchObject({
      save: false,
    });
    expect(result.structuredContent).toMatchObject({ save_skipped: 'opt_out' });
  });

  it('treats save:true as the default and does not forward it', async () => {
    const { server, bridge } = harness({
      'vmark.document.write': () => ({ success: true, data: { revision: 'r2', saved: true } }),
    });

    await server.callTool('document', { action: 'write', content: 'x', save: true });

    expect(
      'save' in (bridge.getRequestsOfType('vmark.document.write')[0].request as object),
    ).toBe(false);
  });

  it('exposes the save_error branch structurally', async () => {
    const { server } = harness({
      'vmark.document.write': () => ({
        success: true,
        data: { revision: 'r2', saved: false, save_error: 'EROFS: read-only file system' },
      }),
    });

    const result = await server.callTool('document', { action: 'write', content: 'x' });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      saved: false,
      save_error: expect.stringContaining('EROFS'),
    });
  });

  it('refuses a missing content without touching the bridge', async () => {
    const { server, bridge } = harness();

    const result = await server.callTool('document', { action: 'write' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('content');
    expect(bridge.requests).toHaveLength(0);
  });

  it('refuses a non-string content', async () => {
    const { server, bridge } = harness();

    const result = await server.callTool('document', { action: 'write', content: 123 });

    expect(result.isError).toBe(true);
    expect(bridge.requests).toHaveLength(0);
  });

  it('accepts an empty string content (an intentional clear)', async () => {
    const { server, bridge } = harness({
      'vmark.document.write': () => ({ success: true, data: { revision: 'r2', saved: true } }),
    });

    const result = await server.callTool('document', { action: 'write', content: '' });

    expect(result.isError).toBeUndefined();
    expect(bridge.getRequestsOfType('vmark.document.write')[0].request).toMatchObject({
      content: '',
    });
  });

  it('surfaces a STALE rejection with the up-to-date revision', async () => {
    const { server } = harness({
      'vmark.document.write': () => ({
        success: false,
        error: '{"error":"STALE","current_revision":"r9"}',
      }),
    });

    const result = await server.callTool('document', {
      action: 'write',
      content: 'x',
      expected_revision: 'r1',
    });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('r9');
  });
});

describe('document.transform', () => {
  it.each(['cjk-format', 'cjk-spacing', 'cjk-punctuation'])(
    'forwards kind=%s with the expected_revision',
    async (kind) => {
      const { server, bridge } = harness({
        'vmark.document.transform': () => ({ success: true, data: { revision: 'r3' } }),
      });

      const result = await server.callTool('document', {
        action: 'transform',
        kind,
        tabId: 'tab-1',
        expected_revision: 'r2',
      });

      expect(bridge.getRequestsOfType('vmark.document.transform')[0].request).toEqual({
        type: 'vmark.document.transform',
        tabId: 'tab-1',
        kind,
        expected_revision: 'r2',
      });
      expect(result.structuredContent).toEqual({ revision: 'r3' });
    },
  );

  it('refuses a missing kind without touching the bridge', async () => {
    const { server, bridge } = harness();

    const result = await server.callTool('document', { action: 'transform' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('kind');
    expect(bridge.requests).toHaveLength(0);
  });
});

describe('document — invalid actions', () => {
  it.each([undefined, '', 'delete', 42, null])('refuses action=%p', async (action) => {
    const { server, bridge } = harness();

    const result = await server.callTool('document', { action });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('Invalid action');
    expect(bridge.requests).toHaveLength(0);
  });
});

describe('document — blank tabId (round-2 audit finding 4)', () => {
  // The frontend resolves tabId with `if (tabIdArg)`, so an empty string is
  // FALSY and silently means "the focused tab". `document.write` with
  // `tabId: ""` therefore replaced and SAVED the wrong document. An invalid
  // target must be refused, never quietly redirected.
  it.each([
    ['read', { action: 'read', tabId: '' }],
    ['read (whitespace)', { action: 'read', tabId: '   ' }],
    ['write', { action: 'write', tabId: '', content: 'x' }],
    ['transform', { action: 'transform', tabId: '', kind: 'cjk-format' }],
  ])('%s: refuses a blank tabId without touching the bridge', async (_label, args) => {
    const { server, bridge } = harness({
      'vmark.document.read': () => ({ success: true, data: READ_PAYLOAD }),
      'vmark.document.write': () => ({ success: true, data: { saved: true } }),
      'vmark.document.transform': () => ({ success: true, data: { revision: 'r2' } }),
    });

    const result = await server.callTool('document', args);

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('tabId');
    expect(bridge.requests).toHaveLength(0);
  });

  it('refuses a non-string tabId rather than silently ignoring it', async () => {
    // Dropping a garbled id also falls through to the focused tab — the same
    // wrong-document write, reached by a different route.
    const { server, bridge } = harness({
      'vmark.document.write': () => ({ success: true, data: { saved: true } }),
    });

    const result = await server.callTool('document', { action: 'write', tabId: 42, content: 'x' });

    expect(result.isError).toBe(true);
    expect(bridge.requests).toHaveLength(0);
  });

  it('rejects a blank tabId at the schema layer too', () => {
    const shape = z.object(documentInputShape());
    expect(shape.safeParse({ action: 'read', tabId: '' }).success).toBe(false);
    expect(shape.safeParse({ action: 'read', tabId: '  ' }).success).toBe(false);
    expect(shape.safeParse({ action: 'read', tabId: 'tab-1' }).success).toBe(true);
    expect(shape.safeParse({ action: 'read' }).success).toBe(true);
  });
});

describe('document.write — STALE carries machine-readable detail (finding 8)', () => {
  // `current_revision` is declared in the output schema but was unreachable:
  // STALE came back as an isError text block with no structuredContent, so the
  // agent had to regex prose for the token it needs to retry.
  it('surfaces the parsed STALE envelope in structuredContent', async () => {
    const { server } = harness({
      'vmark.document.write': () => ({
        success: false,
        error: '{"error":"STALE","message":"Document has changed since the last read","current_revision":"r9"}',
      }),
    });

    const result = await server.callTool('document', {
      action: 'write',
      content: 'x',
      expected_revision: 'r1',
    });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('r9');
    expect(result.structuredContent).toMatchObject({
      error: 'STALE',
      current_revision: 'r9',
    });
  });

  it('surfaces a STALE from transform the same way', async () => {
    const { server } = harness({
      'vmark.document.transform': () => ({
        success: false,
        error: '{"error":"STALE","current_revision":"r7"}',
      }),
    });

    const result = await server.callTool('document', {
      action: 'transform',
      kind: 'cjk-spacing',
      expected_revision: 'r1',
    });

    expect(result.structuredContent).toMatchObject({ error: 'STALE', current_revision: 'r7' });
  });

  it('leaves a non-STALE structured error as a plain error result', async () => {
    const { server } = harness({
      'vmark.document.write': () => ({
        success: false,
        error: '{"error":"INVALID_TAB","message":"tabId could not be resolved"}',
      }),
    });

    const result = await server.callTool('document', { action: 'write', content: 'x' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('leaves a non-JSON bridge error as a plain error result', async () => {
    const { server } = harness({
      'vmark.document.write': () => ({ success: false, error: 'bridge disconnected' }),
    });

    const result = await server.callTool('document', { action: 'write', content: 'x' });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('bridge disconnected');
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('document — malformed bridge errors stay plain errors', () => {
  it.each([
    ['truncated JSON', '{"error":"STALE"'],
    ['a JSON array', '["STALE"]'],
    ['JSON null', 'null'],
    ['a STALE without a revision', '{"error":"STALE"}'],
  ])('%s', async (_label, error) => {
    const { server } = harness({
      'vmark.document.write': () => ({ success: false, error }),
    });

    const result = await server.callTool('document', { action: 'write', content: 'x' });

    expect(result.isError).toBe(true);
    // Only a well-formed STALE object earns a structured channel; anything
    // else must not be presented to the agent as branchable data.
    if (error === '{"error":"STALE"}') {
      expect(result.structuredContent).toEqual({ error: 'STALE' });
      expect(toolText(result)).toContain('unknown');
    } else {
      expect(result.structuredContent).toBeUndefined();
    }
  });
});

describe('document.read — truncation is character-safe (finding 1)', () => {
  it.each([
    ['CJK', '汉'],
    ['emoji', '😀'],
    ['RTL', 'مرحبا'],
    ['combining marks', 'é'],
  ])('%s: the preview is an uncorrupted prefix of the document', async (_label, unit) => {
    const content = unit.repeat(MAX_OUTPUT_BYTES);
    const { server } = harness({
      'vmark.document.read': () => ({ success: true, data: { ...READ_PAYLOAD, content } }),
    });

    const result = await server.callTool('document', { action: 'read' });

    const preview = String(result.structuredContent?.preview);
    // A UTF-8 round trip is lossless only when there is no lone surrogate —
    // `String.prototype.slice` produced exactly that at a pair boundary.
    expect(Buffer.from(preview, 'utf8').toString('utf8')).toBe(preview);
    expect(preview.startsWith('{\n  "content": "')).toBe(true);
    expect(Buffer.byteLength(toolText(result), 'utf8')).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  });
});
