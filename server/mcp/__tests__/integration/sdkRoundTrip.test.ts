/**
 * In-process round trip through the REAL MCP SDK (WI-10.1, WI-10.2, WI-10.4).
 *
 * The spawned smoke test proves the binary lists its tools. This proves the
 * three things that only bite once a client actually CALLS a tool, and that
 * declaring an `outputSchema` newly makes possible:
 *
 *   1. The SDK accepts the Zod shapes `registerTool` is now handed directly.
 *   2. It validates input against them, so a bound like `timeoutMs <= 12000`
 *      is enforced before the handler runs — the whole point of WI-10.4.
 *   3. It validates `structuredContent` against the declared `outputSchema`
 *      and REJECTS a non-error result that omits or violates it. A document
 *      payload that fails here turns a successful write into a protocol error,
 *      so every action of the composite `document` tool must round-trip.
 *
 * Registration mirrors `cli.ts`'s loop exactly; keep the two in step.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVMarkMcpServer, EXPECTED_TOOL_COUNT } from '../../src/index.js';
import { createToolHandler } from '../../src/utils/mcpAdapters.js';
import type { BridgeRequest, BridgeResponse } from '../../src/bridge/core-types.js';
import { MockBridge } from '../mocks/mockBridge.js';

const WRITE_PAYLOAD = { revision: 'r2', saved: true };
const READ_PAYLOAD = {
  content: '# Title\n\nbody',
  revision: 'r1',
  filePath: '/tmp/a.md',
  kind: 'markdown',
  dirty: false,
};
const SELECTION_GET_PAYLOAD = {
  text: 'hello',
  isEmpty: false,
  range: { from: 3, to: 8 },
  mode: 'wysiwyg',
  kind: 'markdown',
  tabId: 'tab-1',
  revision: 'r1',
};
const SELECTION_SET_PAYLOAD = { revision: 'r2', replaced_chars: 5 };
const SESSION_PAYLOAD = {
  windows: [{ label: 'main', focused: true, tabs: [] }],
  capabilities: { version: '0.9.17', supportedKinds: ['markdown'], mcpProtocol: '0.3.0' },
};

describe('MCP SDK round trip (in-process transport pair)', () => {
  let client: Client;

  beforeAll(async () => {
    const bridge = new MockBridge();
    const answers: Record<string, BridgeResponse> = {
      'vmark.document.read': { success: true, data: READ_PAYLOAD },
      'vmark.document.write': { success: true, data: WRITE_PAYLOAD },
      'vmark.document.transform': { success: true, data: { revision: 'r3' } },
      'vmark.selection.get': { success: true, data: SELECTION_GET_PAYLOAD },
      'vmark.selection.set': { success: true, data: SELECTION_SET_PAYLOAD },
      'vmark.session.get_state': { success: true, data: SESSION_PAYLOAD },
      'vmark.browser.read': { success: true, data: { url: 'https://x', snapshot: [] } },
    };
    for (const [type, response] of Object.entries(answers)) {
      bridge.setResponseHandler(type, (_r: BridgeRequest) => response);
    }

    const vmark = createVMarkMcpServer(bridge, { version: '0.0.0-test' });
    const server = new McpServer(
      { name: 'vmark-mcp-server', version: '0.0.0-test' },
      { capabilities: { tools: {} } },
    );
    for (const tool of vmark.listTools()) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          annotations: tool.annotations,
        },
        createToolHandler(tool.name, (name, args) => vmark.callTool(name, args)),
      );
    }

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'round-trip-test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('accepts every tool the sidecar registers', async () => {
    // Against EXPECTED_TOOL_COUNT rather than a literal: that constant is
    // derived from TOOL_CATEGORIES (what --health-check reports) while
    // listTools reports what was actually registered, so this catches a tool
    // that ships without a category descriptor. toolContract.test.ts pins the
    // exact names.
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it('returns structuredContent alongside the text block for document.write', async () => {
    const result = await client.callTool({
      name: 'document',
      arguments: { action: 'write', content: 'new body', expected_revision: 'r1' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(WRITE_PAYLOAD);
    // Back-compat: the serialized JSON is still in a text block.
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(WRITE_PAYLOAD);
  });

  it.each([
    ['read', { action: 'read' }, READ_PAYLOAD],
    ['transform', { action: 'transform', kind: 'cjk-spacing' }, { revision: 'r3' }],
  ])(
    'satisfies the document outputSchema for the %s action too',
    async (_label, args, expected) => {
      // A composite tool shares one outputSchema. If any action's payload fails
      // validation the SDK converts a SUCCESS into a protocol error, so all
      // three must round-trip, not just the one the schema was written for.
      const result = await client.callTool({ name: 'document', arguments: args });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(expected);
    },
  );

  it.each([
    ['get', { action: 'get' }, SELECTION_GET_PAYLOAD],
    ['set', { action: 'set', content: 'world' }, SELECTION_SET_PAYLOAD],
  ])(
    'satisfies the selection outputSchema for the %s action',
    async (_label, args, expected) => {
      // `set` is the one that matters: the replacement is already committed in
      // the editor by the time the SDK validates. A schema that rejected this
      // payload would report a successful edit to the agent as a protocol
      // error. `range` — the surface's only nested object — rides on `get`.
      const result = await client.callTool({ name: 'selection', arguments: args });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(expected);
    },
  );

  it('returns structuredContent for session.get_state', async () => {
    const result = await client.callTool({
      name: 'session',
      arguments: { action: 'get_state' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(SESSION_PAYLOAD);
  });

  it('omits structuredContent for tools that declare no outputSchema', async () => {
    const result = await client.callTool({
      name: 'browser_read',
      arguments: { action: 'read' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
  });

  it('rejects an out-of-range timeoutMs at the SDK input-validation layer', async () => {
    // The bound the old converter dropped, now enforced BEFORE the handler
    // runs. The SDK reports it as an isError result (not a rejected promise),
    // so the agent sees the constraint it violated rather than a transport
    // failure.
    const result = await client.callTool({
      name: 'browser',
      arguments: { action: 'open', url: 'https://x.com', timeoutMs: 99_999 },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Input validation error');
    expect(content[0].text).toContain('timeoutMs');
    expect(content[0].text).toContain('12000');
  });

  it('rejects an unknown action value against the declared enum', async () => {
    const result = await client.callTool({
      name: 'document',
      arguments: { action: 'obliterate' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Input validation error');
    expect(content[0].text).toContain('action');
  });

  it('applies the document.save default server-side when the client omits it', async () => {
    // `save` is `.default(true)`; the SDK parses input against the schema, so
    // the handler must see `true` even though the client sent nothing.
    const result = await client.callTool({
      name: 'document',
      arguments: { action: 'write', content: 'x' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(WRITE_PAYLOAD);
  });

  it('surfaces a bridge failure as isError, skipping output validation', async () => {
    // An error result carries no structuredContent. The SDK must not reject it
    // for that — otherwise every failed write becomes a confusing schema error.
    const result = await client.callTool({
      name: 'document',
      arguments: { action: 'write' }, // missing `content`
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});
