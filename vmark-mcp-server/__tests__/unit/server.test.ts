/**
 * Tests for VMarkMcpServer class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VMarkMcpServer, resolveWindowId } from '../../src/server.js';
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
          inputSchema: { type: 'object', properties: {} },
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
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ success: true, content: [] })
      );

      server.registerTool(
        {
          name: 'test_tool',
          description: 'Second version',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ success: false, content: [] })
      );

      const tool = server.tools.get('test_tool');
      expect(tool?.definition.description).toBe('Second version');
    });
  });

  describe('registerResource', () => {
    it('should register a resource', () => {
      server.registerResource(
        {
          uri: 'vmark://test',
          name: 'Test',
          description: 'A test resource',
        },
        async () => ({ contents: [] })
      );

      expect(server.resources.has('vmark://test')).toBe(true);
      expect(server.listResources()).toHaveLength(1);
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
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ success: true, content: [] })
      );

      server.registerTool(
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ success: true, content: [] })
      );

      const tools = server.listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('tool1');
      expect(tools.map(t => t.name)).toContain('tool2');
    });
  });

  describe('listResources', () => {
    it('should return empty array when no resources registered', () => {
      expect(server.listResources()).toEqual([]);
    });

    it('should return all resource definitions', () => {
      server.registerResource(
        { uri: 'vmark://a', name: 'A', description: 'Resource A' },
        async () => ({ contents: [] })
      );
      server.registerResource(
        { uri: 'vmark://b', name: 'B', description: 'Resource B' },
        async () => ({ contents: [] })
      );

      const resources = server.listResources();
      expect(resources).toHaveLength(2);
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
          inputSchema: { type: 'object', properties: {} },
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
          inputSchema: { type: 'object', properties: {} },
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
          inputSchema: { type: 'object', properties: {} },
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
          inputSchema: { type: 'object', properties: {} },
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

  describe('readResource', () => {
    it('should call resource handler', async () => {
      const handler = vi.fn().mockResolvedValue({
        contents: [{ uri: 'vmark://test', text: 'content' }],
      });

      server.registerResource(
        { uri: 'vmark://test', name: 'Test', description: 'Test' },
        handler
      );

      await server.readResource('vmark://test');

      expect(handler).toHaveBeenCalledWith('vmark://test');
    });

    it('should return result from handler', async () => {
      server.registerResource(
        { uri: 'vmark://test', name: 'Test', description: 'Test' },
        async () => ({
          contents: [{ uri: 'vmark://test', text: 'hello world' }],
        })
      );

      const result = await server.readResource('vmark://test');

      expect(result.contents[0].text).toBe('hello world');
    });

    it('should throw for unknown resource', async () => {
      await expect(server.readResource('vmark://unknown')).rejects.toThrow(
        'Unknown resource'
      );
    });

    it('should wrap handler errors with resource URI context', async () => {
      server.registerResource(
        { uri: 'vmark://failing', name: 'Failing', description: 'Fails' },
        async () => {
          throw new Error('Handler exploded');
        }
      );

      await expect(server.readResource('vmark://failing')).rejects.toThrow(
        'Resource error (vmark://failing): Handler exploded'
      );
    });

    it('should handle non-Error thrown values in handler', async () => {
      server.registerResource(
        { uri: 'vmark://weird', name: 'Weird', description: 'Throws string' },
        async () => {
          throw 'String error';
        }
      );

      await expect(server.readResource('vmark://weird')).rejects.toThrow(
        'Resource error (vmark://weird): String error'
      );
    });
  });

  describe('sendBridgeRequest', () => {
    it('should send request through bridge', async () => {
      bridge.setContent('Hello');

      const result = await server.sendBridgeRequest<string>({
        type: 'document.getContent',
      });

      expect(result).toBe('Hello');
    });

    it('should throw on bridge error', async () => {
      bridge.setResponseHandler('document.getContent', () => ({
        success: false,
        error: 'Bridge error',
        data: null,
      }));

      await expect(
        server.sendBridgeRequest({ type: 'document.getContent' })
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
      bridge.setResponseHandler('document.getContent', () => ({
        success: false,
        error: '',
      }));

      await expect(
        server.sendBridgeRequest({ type: 'document.getContent' })
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

    describe('resourceResult', () => {
      it('should create resource result', () => {
        const result = VMarkMcpServer.resourceResult(
          'vmark://doc',
          'content',
          'text/markdown'
        );

        expect(result.contents).toHaveLength(1);
        expect(result.contents[0].uri).toBe('vmark://doc');
        expect(result.contents[0].text).toBe('content');
        expect(result.contents[0].mimeType).toBe('text/markdown');
      });

      it('should work without mimeType', () => {
        const result = VMarkMcpServer.resourceResult('vmark://doc', 'content');

        expect(result.contents[0].mimeType).toBeUndefined();
      });
    });
  });
});

describe('resolveWindowId', () => {
  it('should return "focused" when undefined', () => {
    expect(resolveWindowId(undefined)).toBe('focused');
  });

  it('should return "focused" when not provided', () => {
    expect(resolveWindowId()).toBe('focused');
  });

  it('should return provided windowId', () => {
    expect(resolveWindowId('main')).toBe('main');
    expect(resolveWindowId('secondary')).toBe('secondary');
  });

  it('should return "focused" string as-is', () => {
    expect(resolveWindowId('focused')).toBe('focused');
  });
});
