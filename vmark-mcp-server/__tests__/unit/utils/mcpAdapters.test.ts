/**
 * Tests for MCP adapter utilities.
 *
 * Covers toMcpContent, toMcpContents, createToolHandler, and createResourceHandler.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  toMcpContent,
  toMcpContents,
  createToolHandler,
  createResourceHandler,
} from '../../../src/utils/mcpAdapters.js';

describe('toMcpContent', () => {
  it('should convert text items', () => {
    const items = [{ type: 'text', text: 'hello' }];
    expect(toMcpContent(items)).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('should filter out non-text items', () => {
    const items = [
      { type: 'text', text: 'keep' },
      { type: 'image', text: 'discard' },
      { type: 'text', text: 'also keep' },
    ];
    const result = toMcpContent(items);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('keep');
    expect(result[1].text).toBe('also keep');
  });

  it('should filter out items without text', () => {
    const items = [
      { type: 'text' },
      { type: 'text', text: 'valid' },
    ];
    const result = toMcpContent(items);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('valid');
  });

  it('should return empty array for empty input', () => {
    expect(toMcpContent([])).toEqual([]);
  });
});

describe('toMcpContents', () => {
  it('should convert resource items', () => {
    const items = [{ uri: 'vmark://doc', text: 'content', mimeType: 'text/markdown' }];
    expect(toMcpContents(items)).toEqual([
      { uri: 'vmark://doc', text: 'content', mimeType: 'text/markdown' },
    ]);
  });

  it('should filter out items without text', () => {
    const items = [
      { uri: 'vmark://a', text: 'keep' },
      { uri: 'vmark://b' },
    ];
    const result = toMcpContents(items as Array<{ uri: string; text?: string }>);
    expect(result).toHaveLength(1);
    expect(result[0].uri).toBe('vmark://a');
  });

  it('should return empty array for empty input', () => {
    expect(toMcpContents([])).toEqual([]);
  });
});

describe('createToolHandler', () => {
  it('should return tool result on success', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
      isError: false,
    });

    const handler = createToolHandler('my_tool', callTool);
    const result = await handler({ arg: 'value' });

    expect(callTool).toHaveBeenCalledWith('my_tool', { arg: 'value' });
    expect(result.content).toEqual([{ type: 'text', text: 'result' }]);
    expect(result.isError).toBe(false);
  });

  it('should catch Error and return isError response', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('Bridge disconnected'));

    const handler = createToolHandler('my_tool', callTool);
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Bridge disconnected');
  });

  it('should catch non-Error thrown values', async () => {
    const callTool = vi.fn().mockRejectedValue('string error');

    const handler = createToolHandler('my_tool', callTool);
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('string error');
  });

  it('should catch errors from toMcpContent conversion', async () => {
    // Simulate callTool returning malformed content that causes toMcpContent to fail
    const callTool = vi.fn().mockResolvedValue({
      content: null, // null will cause .filter() to throw
      isError: false,
    });

    const handler = createToolHandler('my_tool', callTool);
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});

describe('createResourceHandler', () => {
  it('should return resource contents on success', async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: 'vmark://doc', text: 'content' }],
    });

    const handler = createResourceHandler('vmark://doc', readResource);
    const result = await handler();

    expect(readResource).toHaveBeenCalledWith('vmark://doc');
    expect(result.contents).toEqual([{ uri: 'vmark://doc', text: 'content' }]);
  });

  it('should wrap Error and re-throw with context', async () => {
    const readResource = vi.fn().mockRejectedValue(new Error('Connection lost'));

    const handler = createResourceHandler('vmark://doc', readResource);

    await expect(handler()).rejects.toThrow('Resource read failed: Connection lost');
  });

  it('should wrap non-Error thrown values and re-throw', async () => {
    const readResource = vi.fn().mockRejectedValue(42);

    const handler = createResourceHandler('vmark://doc', readResource);

    await expect(handler()).rejects.toThrow('Resource read failed: 42');
  });

  it('should catch errors from toMcpContents conversion', async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: null, // null will cause .filter() to throw
    });

    const handler = createResourceHandler('vmark://doc', readResource);

    await expect(handler()).rejects.toThrow('Resource read failed:');
  });
});
