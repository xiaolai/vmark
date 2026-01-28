/**
 * Tests for document tools.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerDocumentTools } from '../../../src/tools/document.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { McpTestClient } from '../../utils/McpTestClient.js';

describe('document tools', () => {
  let bridge: MockBridge;
  let server: VMarkMcpServer;
  let client: McpTestClient;

  beforeEach(() => {
    bridge = new MockBridge();
    server = new VMarkMcpServer({ bridge });
    registerDocumentTools(server);
    client = new McpTestClient(server);
  });

  describe('document_get_content', () => {
    it('should be registered as a tool', () => {
      const tool = client.getTool('document_get_content');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('Get the full content');
    });

    it('should have optional windowId parameter', () => {
      const tool = client.getTool('document_get_content');
      expect(tool?.inputSchema.required).toBeUndefined();
    });

    it('should return empty content for empty document', async () => {
      const result = await client.callTool('document_get_content');

      expect(result.success).toBe(true);
      expect(McpTestClient.getTextContent(result)).toBe('');
    });

    it('should return document content', async () => {
      bridge.setContent('# Hello World\n\nThis is a test document.');

      const result = await client.callTool('document_get_content');

      expect(result.success).toBe(true);
      expect(McpTestClient.getTextContent(result)).toBe(
        '# Hello World\n\nThis is a test document.'
      );
    });

    it('should use focused window by default', async () => {
      bridge.setContent('Focused content');

      await client.callTool('document_get_content');

      const requests = bridge.getRequestsOfType('document.getContent');
      expect(requests).toHaveLength(1);
      expect((requests[0].request as { windowId?: string }).windowId).toBe('focused');
    });

    it('should use specified windowId', async () => {
      bridge.addWindow('other');
      bridge.setContent('Other content', 'other');

      const result = await client.callTool('document_get_content', {
        windowId: 'other',
      });

      expect(result.success).toBe(true);
      expect(McpTestClient.getTextContent(result)).toBe('Other content');
    });

    it('should handle bridge errors gracefully', async () => {
      bridge.setResponseHandler('document.getContent', () => ({
        success: false,
        error: 'Connection lost',
        data: null,
      }));

      const result = await client.callTool('document_get_content');

      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(McpTestClient.getTextContent(result)).toContain('Failed to get document content');
    });

    it('should handle thrown errors', async () => {
      bridge.setNextError(new Error('Network error'));

      const result = await client.callTool('document_get_content');

      expect(result.success).toBe(false);
      expect(McpTestClient.getTextContent(result)).toContain('Network error');
    });

    it('should preserve markdown formatting', async () => {
      const markdown = `# Title

## Section 1

- Item 1
- Item 2

\`\`\`javascript
const x = 1;
\`\`\`

> Quote text`;

      bridge.setContent(markdown);

      const result = await client.callTool('document_get_content');

      expect(McpTestClient.getTextContent(result)).toBe(markdown);
    });

    it('should handle unicode content', async () => {
      bridge.setContent('Hello 世界 🌍 émojis');

      const result = await client.callTool('document_get_content');

      expect(McpTestClient.getTextContent(result)).toBe('Hello 世界 🌍 émojis');
    });

    it('should handle very long content', async () => {
      const longContent = 'a'.repeat(100000);
      bridge.setContent(longContent);

      const result = await client.callTool('document_get_content');

      expect(McpTestClient.getTextContent(result)).toBe(longContent);
    });
  });

  describe('document_set_content', () => {
    it('should be registered as a tool', () => {
      const tool = client.getTool('document_set_content');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('empty');
    });

    it('should succeed on empty document', async () => {
      // Start with empty document
      bridge.setContent('');

      const result = await client.callTool('document_set_content', {
        content: '# Hello World',
      });

      expect(result.success).toBe(true);
      expect(bridge.getWindowState()?.content).toBe('# Hello World');
    });

    it('should fail on non-empty document', async () => {
      bridge.setContent('existing content');

      const result = await client.callTool('document_set_content', {
        content: 'New content',
      });

      expect(result.success).toBe(false);
      expect(McpTestClient.getTextContent(result)).toContain('only allowed on empty documents');

      // Verify content was NOT changed
      const state = bridge.getWindowState();
      expect(state?.content).toBe('existing content');
    });

    it('should suggest alternative tools in error message for non-empty docs', async () => {
      bridge.setContent('some content');

      const result = await client.callTool('document_set_content', {
        content: 'test',
      });

      const errorMessage = McpTestClient.getTextContent(result);
      expect(errorMessage).toContain('document_insert_at_cursor');
      expect(errorMessage).toContain('selection_replace');
    });
  });

  describe('document_insert_at_cursor', () => {
    it('should be registered as a tool', () => {
      const tool = client.getTool('document_insert_at_cursor');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('text');
    });

    it('should insert at cursor position', async () => {
      bridge.setContent('Hello world');
      bridge.setCursorPosition(6); // After "Hello "

      const result = await client.callTool('document_insert_at_cursor', {
        text: 'beautiful ',
      });

      expect(result.success).toBe(true);
      expect(bridge.getWindowState()?.content).toBe('Hello beautiful world');
    });

    it('should insert at start of empty document', async () => {
      await client.callTool('document_insert_at_cursor', {
        text: 'First content',
      });

      expect(bridge.getWindowState()?.content).toBe('First content');
    });

    it('should require text parameter', async () => {
      const result = await client.callTool('document_insert_at_cursor', {});

      expect(result.success).toBe(false);
      expect(McpTestClient.getTextContent(result)).toContain('text must be a string');
    });

    it('should return structured result with position', async () => {
      const result = await client.callTool('document_insert_at_cursor', {
        text: 'Hello',
      });

      expect(result.success).toBe(true);
      const content = McpTestClient.getTextContent(result);
      expect(content).toContain('"message"');
      expect(content).toContain('"position"');
      expect(content).toContain('"applied"');
    });

    it('should handle multiline insertion', async () => {
      bridge.setContent('Line 1\nLine 3');
      bridge.setCursorPosition(7); // After "Line 1\n"

      await client.callTool('document_insert_at_cursor', {
        text: 'Line 2\n',
      });

      expect(bridge.getWindowState()?.content).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should handle specified windowId', async () => {
      bridge.addWindow('other');
      bridge.setContent('Other doc', 'other');
      bridge.setCursorPosition(5, 'other');

      await client.callTool('document_insert_at_cursor', {
        text: ' great',
        windowId: 'other',
      });

      expect(bridge.getWindowState('other')?.content).toBe('Other great doc');
    });
  });

  describe('document_insert_at_position', () => {
    it('should be registered as a tool', () => {
      const tool = client.getTool('document_insert_at_position');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('text');
      expect(tool?.inputSchema.required).toContain('position');
    });

    it('should insert at specified position', async () => {
      bridge.setContent('Hello world');

      const result = await client.callTool('document_insert_at_position', {
        text: 'cruel ',
        position: 6,
      });

      expect(result.success).toBe(true);
      expect(bridge.getWindowState()?.content).toBe('Hello cruel world');
    });

    it('should insert at start (position 0)', async () => {
      bridge.setContent('World');

      await client.callTool('document_insert_at_position', {
        text: 'Hello ',
        position: 0,
      });

      expect(bridge.getWindowState()?.content).toBe('Hello World');
    });

    it('should insert at end', async () => {
      bridge.setContent('Hello');

      await client.callTool('document_insert_at_position', {
        text: ' World',
        position: 5,
      });

      expect(bridge.getWindowState()?.content).toBe('Hello World');
    });

    it('should require text parameter', async () => {
      const result = await client.callTool('document_insert_at_position', {
        position: 0,
      });

      expect(result.success).toBe(false);
    });

    it('should require position parameter', async () => {
      const result = await client.callTool('document_insert_at_position', {
        text: 'test',
      });

      expect(result.success).toBe(false);
    });

    it('should reject negative position', async () => {
      const result = await client.callTool('document_insert_at_position', {
        text: 'test',
        position: -1,
      });

      expect(result.success).toBe(false);
      expect(McpTestClient.getTextContent(result)).toContain('non-negative');
    });

    it('should return structured result with position', async () => {
      bridge.setContent('test');

      const result = await client.callTool('document_insert_at_position', {
        text: 'x',
        position: 2,
      });

      expect(result.success).toBe(true);
      const content = McpTestClient.getTextContent(result);
      expect(content).toContain('"position": 2');
      expect(content).toContain('"message"');
      expect(content).toContain('"applied"');
    });
  });

  describe('document_search', () => {
    it('should be registered as a tool', () => {
      const tool = client.getTool('document_search');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('query');
    });

    it('should find matches in document', async () => {
      bridge.setContent('Hello world, hello universe');

      const result = await client.callTool('document_search', {
        query: 'hello',
      });

      expect(result.success).toBe(true);
      const data = McpTestClient.getJsonContent<{ count: number }>(result);
      expect(data.count).toBe(2); // Case-insensitive by default
    });

    it('should return match positions', async () => {
      bridge.setContent('foo bar foo');

      const result = await client.callTool('document_search', {
        query: 'foo',
      });

      const data = McpTestClient.getJsonContent<{
        matches: Array<{ range: { from: number; to: number } }>;
      }>(result);

      expect(data.matches[0].range).toEqual({ from: 0, to: 3 });
      expect(data.matches[1].range).toEqual({ from: 8, to: 11 });
    });

    it('should support case-sensitive search', async () => {
      bridge.setContent('Hello hello HELLO');

      const result = await client.callTool('document_search', {
        query: 'hello',
        caseSensitive: true,
      });

      const data = McpTestClient.getJsonContent<{ count: number }>(result);
      expect(data.count).toBe(1);
    });

    it('should return line numbers', async () => {
      bridge.setContent('Line 1\nLine 2 with match\nLine 3');

      const result = await client.callTool('document_search', {
        query: 'match',
      });

      const data = McpTestClient.getJsonContent<{
        matches: Array<{ lineNumber: number }>;
      }>(result);

      expect(data.matches[0].lineNumber).toBe(2);
    });

    it('should return empty array for no matches', async () => {
      bridge.setContent('Hello world');

      const result = await client.callTool('document_search', {
        query: 'xyz',
      });

      const data = McpTestClient.getJsonContent<{ count: number; matches: unknown[] }>(result);
      expect(data.count).toBe(0);
      expect(data.matches).toHaveLength(0);
    });

    it('should require non-empty query', async () => {
      const result = await client.callTool('document_search', {
        query: '',
      });

      expect(result.success).toBe(false);
      expect(McpTestClient.getTextContent(result)).toContain('non-empty string');
    });

    it('should handle special characters in query', async () => {
      bridge.setContent('Price: $100 (USD)');

      const result = await client.callTool('document_search', {
        query: '$100',
      });

      const data = McpTestClient.getJsonContent<{ count: number }>(result);
      expect(data.count).toBe(1);
    });
  });

  describe('document_replace', () => {
    it('should be registered as a tool', () => {
      const tool = client.getTool('document_replace');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('search');
      expect(tool?.inputSchema.required).toContain('replace');
    });

    it('should replace first occurrence by default', async () => {
      bridge.setContent('foo bar foo');

      const result = await client.callTool('document_replace', {
        search: 'foo',
        replace: 'baz',
      });

      expect(result.success).toBe(true);
      expect(bridge.getWindowState()?.content).toBe('baz bar foo');
    });

    it('should replace all occurrences when requested', async () => {
      bridge.setContent('foo bar foo baz foo');

      const result = await client.callTool('document_replace', {
        search: 'foo',
        replace: 'qux',
        all: true,
      });

      const data = McpTestClient.getJsonContent<{ count: number }>(result);
      expect(data.count).toBe(3);
      expect(bridge.getWindowState()?.content).toBe('qux bar qux baz qux');
    });

    it('should report number of replacements', async () => {
      bridge.setContent('a a a');

      const result = await client.callTool('document_replace', {
        search: 'a',
        replace: 'b',
        all: true,
      });

      const data = McpTestClient.getJsonContent<{ count: number; message: string }>(result);
      expect(data.count).toBe(3);
      expect(data.message).toContain('3 occurrences');
    });

    it('should report when no matches found', async () => {
      bridge.setContent('Hello world');

      const result = await client.callTool('document_replace', {
        search: 'xyz',
        replace: 'abc',
      });

      const data = McpTestClient.getJsonContent<{ count: number; message: string }>(result);
      expect(data.count).toBe(0);
      expect(data.message).toContain('No matches');
    });

    it('should require non-empty search string', async () => {
      const result = await client.callTool('document_replace', {
        search: '',
        replace: 'test',
      });

      expect(result.success).toBe(false);
    });

    it('should allow empty replace string', async () => {
      bridge.setContent('Hello cruel world');

      const result = await client.callTool('document_replace', {
        search: 'cruel ',
        replace: '',
      });

      expect(result.success).toBe(true);
      expect(bridge.getWindowState()?.content).toBe('Hello world');
    });

    it('should handle replace with longer text', async () => {
      bridge.setContent('Hi');

      await client.callTool('document_replace', {
        search: 'Hi',
        replace: 'Hello World',
      });

      expect(bridge.getWindowState()?.content).toBe('Hello World');
    });

    it('should handle specified windowId', async () => {
      bridge.addWindow('other');
      bridge.setContent('foo', 'other');

      await client.callTool('document_replace', {
        search: 'foo',
        replace: 'bar',
        windowId: 'other',
      });

      expect(bridge.getWindowState('other')?.content).toBe('bar');
    });
  });

  describe('tool call recording', () => {
    it('should record all tool calls', async () => {
      bridge.setContent('test');

      await client.callTool('document_get_content');
      await client.callTool('document_insert_at_cursor', { text: 'x' });

      const history = client.getToolCallHistory();
      expect(history).toHaveLength(2);
      expect(history[0].name).toBe('document_get_content');
      expect(history[1].name).toBe('document_insert_at_cursor');
    });

    it('should allow assertion on tool calls', async () => {
      await client.callTool('document_search', { query: 'test' });

      expect(() =>
        client.assertToolCalled('document_search', { query: 'test' })
      ).not.toThrow();
    });
  });
});
