/**
 * Tests for VMarkMcpServer class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VMarkMcpServer } from '../../src/server.js';
import { createVMarkMcpServer } from '../../src/index.js';
import { MockBridge } from '../mocks/mockBridge.js';

describe('VMarkMcpServer', () => {
  let bridge: MockBridge;
  let server: VMarkMcpServer;

  beforeEach(() => {
    bridge = new MockBridge();
    server = new VMarkMcpServer({ bridge });
  });

  describe('constructor', () => {
    it('should use default name and version', () => {
      const info = server.getServerInfo();
      expect(info.name).toBe('vmark');
      expect(info.version).toBe('0.1.0');
    });

    it('should use custom name and version', () => {
      const customServer = new VMarkMcpServer({
        bridge,
        name: 'custom-server',
        version: '2.0.0',
      });

      const info = customServer.getServerInfo();
      expect(info.name).toBe('custom-server');
      expect(info.version).toBe('2.0.0');
    });

    it('createVMarkMcpServer threads the caller version into server info (cli VERSION path)', () => {
      // The cli passes its VERSION constant here so MCP metadata reports the
      // real sidecar version instead of the '0.1.0' fallback (Codex finding 4).
      const versionedServer = createVMarkMcpServer(bridge, { version: '9.9.9' });
      expect(versionedServer.getServerInfo().version).toBe('9.9.9');
    });
  });

  describe('getBridge', () => {
    it('should return the bridge instance', () => {
      expect(server.getBridge()).toBe(bridge);
    });
  });

  describe('registerTool', () => {
    it('should register a tool', () => {
      server.registerTool(
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: {},
        },
        async () => ({ success: true, content: [] })
      );

      expect(server.tools.has('test_tool')).toBe(true);
      expect(server.listTools()).toHaveLength(1);
    });

    it('should overwrite existing tool with same name', () => {
      server.registerTool(
        {
          name: 'test_tool',
          description: 'First version',
          inputSchema: {},
        },
        async () => ({ success: true, content: [] })
      );

      server.registerTool(
        {
          name: 'test_tool',
          description: 'Second version',
          inputSchema: {},
        },
        async () => ({ success: false, content: [] })
      );

      const tool = server.tools.get('test_tool');
      expect(tool?.definition.description).toBe('Second version');
    });
  });

  describe('listTools', () => {
    it('should return empty array when no tools registered', () => {
      expect(server.listTools()).toEqual([]);
    });

    it('should return all tool definitions', () => {
      server.registerTool(
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: {},
        },
        async () => ({ success: true, content: [] })
      );

      server.registerTool(
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: {},
        },
        async () => ({ success: true, content: [] })
      );

      const tools = server.listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('tool1');
      expect(tools.map(t => t.name)).toContain('tool2');
    });
  });

  describe('callTool', () => {
    it('should call tool handler with arguments', async () => {
      const handler = vi.fn().mockResolvedValue({
        success: true,
        content: [{ type: 'text', text: 'result' }],
      });

      server.registerTool(
        {
          name: 'my_tool',
          description: 'My tool',
          inputSchema: {},
        },
        handler
      );

      await server.callTool('my_tool', { arg1: 'value1' });

      expect(handler).toHaveBeenCalledWith({ arg1: 'value1' });
    });

    it('should return result from handler', async () => {
      server.registerTool(
        {
          name: 'my_tool',
          description: 'My tool',
          inputSchema: {},
        },
        async () => ({
          success: true,
          content: [{ type: 'text', text: 'hello' }],
        })
      );

      const result = await server.callTool('my_tool', {});

      expect(result.success).toBe(true);
      expect(result.content[0].text).toBe('hello');
    });

    it('should return error for unknown tool', async () => {
      const result = await server.callTool('nonexistent', {});

      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });

    it('should catch handler errors and return error result', async () => {
      server.registerTool(
        {
          name: 'failing_tool',
          description: 'A failing tool',
          inputSchema: {},
        },
        async () => {
          throw new Error('Handler exploded');
        }
      );

      const result = await server.callTool('failing_tool', {});

      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Handler exploded');
    });

    it('should handle non-Error thrown values', async () => {
      server.registerTool(
        {
          name: 'weird_tool',
          description: 'A weird tool',
          inputSchema: {},
        },
        async () => {
          throw 'String error';
        }
      );

      const result = await server.callTool('weird_tool', {});

      expect(result.success).toBe(false);
      expect(result.content[0].text).toContain('String error');
    });
  });

  describe('sendBridgeRequest', () => {
    it('should send request through bridge', async () => {
      bridge.setResponseHandler('vmark.document.read', () => ({
        success: true,
        data: 'Hello',
      }));

      const result = await server.sendBridgeRequest<string>({
        type: 'vmark.document.read',
      });

      expect(result).toBe('Hello');
    });

    it('should throw on bridge error', async () => {
      bridge.setResponseHandler('vmark.document.read', () => ({
        success: false,
        error: 'Bridge error',
        data: null,
      }));

      await expect(
        server.sendBridgeRequest({ type: 'vmark.document.read' })
      ).rejects.toThrow('Bridge error');
    });

    it('should attach a failure `data` envelope to the thrown error (R5 approval)', async () => {
      // The browser approval gate rides on a FAILED response's `data`. It must
      // survive the throw so the tool can render actionable consent guidance.
      const envelope = { needsApproval: true, operation: 'click', url: 'https://a.com' };
      bridge.setResponseHandler('vmark.browser.act', () => ({
        success: false,
        error: 'blocked',
        data: envelope,
      }));

      await expect(
        server.sendBridgeRequest({
          type: 'vmark.browser.act', operation: 'click', role: 'button', name: 'Publish',
        })
      ).rejects.toMatchObject({ message: 'blocked', data: envelope });
    });

    it('should give a non-empty message when the failure omits `error`', async () => {
      // A failure with no `error` field previously produced `new Error(undefined)`.
      bridge.setResponseHandler('vmark.document.read', () => ({
        success: false,
        error: '',
      }));

      await expect(
        server.sendBridgeRequest({ type: 'vmark.document.read' })
      ).rejects.toThrow('VMark rejected the request');
    });
  });

  describe('static helper methods', () => {
    describe('successResult', () => {
      it('should create text result', () => {
        const result = VMarkMcpServer.successResult('hello');

        expect(result.success).toBe(true);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toBe('hello');
      });
    });

    describe('successJsonResult', () => {
      it('should create JSON text result', () => {
        const result = VMarkMcpServer.successJsonResult({ key: 'value' });

        expect(result.success).toBe(true);
        expect(result.content[0].text).toContain('"key"');
        expect(result.content[0].text).toContain('"value"');
      });

      it('should format JSON with indentation', () => {
        const result = VMarkMcpServer.successJsonResult({ a: 1 });
        expect(result.content[0].text).toContain('\n');
      });
    });

    describe('errorResult', () => {
      it('should create error result', () => {
        const result = VMarkMcpServer.errorResult('Something went wrong');

        expect(result.success).toBe(false);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Something went wrong');
      });
    });
  });
});
