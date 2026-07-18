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

  it('should pass through image items with data and mimeType', () => {
    const items = [
      { type: 'text', text: 'Screenshot of https://example.com' },
      { type: 'image', data: 'base64jpegdata', mimeType: 'image/jpeg' },
    ];
    expect(toMcpContent(items)).toEqual([
      { type: 'text', text: 'Screenshot of https://example.com' },
      { type: 'image', data: 'base64jpegdata', mimeType: 'image/jpeg' },
    ]);
  });

  it('should drop malformed image items (missing data or mimeType)', () => {
    const items = [
      { type: 'image', mimeType: 'image/jpeg' }, // no data
      { type: 'image', data: 'abc' }, // no mimeType
      { type: 'image', text: 'not-an-image-payload' }, // wrong field
    ];
    expect(toMcpContent(items)).toEqual([]);
  });

  it('should filter out unknown content types', () => {
    const items = [
      { type: 'text', text: 'keep' },
      { type: 'audio', text: 'discard' },
      { type: 'text', text: 'also keep' },
    ];
    const result = toMcpContent(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'text', text: 'keep' });
    expect(result[1]).toEqual({ type: 'text', text: 'also keep' });
  });

  it('should pass through embedded resource items with text contents (MCP spec)', () => {
    const items = [
      {
        type: 'resource',
        resource: { uri: 'vmark://doc/1', text: 'embedded body', mimeType: 'text/markdown' },
      },
    ];
    expect(toMcpContent(items)).toEqual([
      {
        type: 'resource',
        resource: { uri: 'vmark://doc/1', text: 'embedded body', mimeType: 'text/markdown' },
      },
    ]);
  });

  it('should pass through embedded resource items with blob contents (base64 blob field)', () => {
    const items = [
      {
        type: 'resource',
        resource: { uri: 'vmark://blob/1', blob: 'AAAA', mimeType: 'image/png' },
      },
    ];
    expect(toMcpContent(items)).toEqual([
      {
        type: 'resource',
        resource: { uri: 'vmark://blob/1', blob: 'AAAA', mimeType: 'image/png' },
      },
    ]);
  });

  it('should drop malformed resource items (no envelope, no uri, or neither text nor blob)', () => {
    const items = [
      { type: 'resource', text: 'flat legacy shape — no resource envelope' },
      { type: 'resource', resource: { text: 'no uri' } },
      { type: 'resource', resource: { uri: 'vmark://x' } }, // neither text nor blob
    ];
    expect(toMcpContent(items as Parameters<typeof toMcpContent>[0])).toEqual([]);
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

  it('should pass through blob resource contents (base64 blob field, MCP spec)', () => {
    const items = [{ uri: 'vmark://blob/1', blob: 'QUJD', mimeType: 'image/png' }];
    expect(toMcpContents(items)).toEqual([
      { uri: 'vmark://blob/1', blob: 'QUJD', mimeType: 'image/png' },
    ]);
  });

  it('should keep text and blob items while dropping items with neither', () => {
    const items = [
      { uri: 'vmark://a', text: 'textual' },
      { uri: 'vmark://b', blob: 'AAAA' },
      { uri: 'vmark://c' },
    ];
    const result = toMcpContents(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ uri: 'vmark://a', text: 'textual' });
    expect(result[1]).toMatchObject({ uri: 'vmark://b', blob: 'AAAA' });
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

  it('should deliver both text and image blocks from a tool result (browser.screenshot path)', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'Screenshot of https://example.com' },
        { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
      ],
      isError: false,
    });

    const handler = createToolHandler('browser', callTool);
    const result = await handler({ action: 'screenshot' });

    expect(result.content).toEqual([
      { type: 'text', text: 'Screenshot of https://example.com' },
      { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
    ]);
    expect(result.isError).toBe(false);
  });

  it('should round-trip embedded resource blocks through the tool handler', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'here is the doc' },
        {
          type: 'resource',
          resource: { uri: 'vmark://doc/1', text: 'embedded', mimeType: 'text/markdown' },
        },
      ],
      isError: false,
    });

    const handler = createToolHandler('document', callTool);
    const result = await handler({});

    expect(result.content).toEqual([
      { type: 'text', text: 'here is the doc' },
      {
        type: 'resource',
        resource: { uri: 'vmark://doc/1', text: 'embedded', mimeType: 'text/markdown' },
      },
    ]);
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

  it('should round-trip blob resource contents through the resource handler', async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: 'vmark://blob/1', blob: 'AAAA', mimeType: 'image/png' }],
    });

    const handler = createResourceHandler('vmark://blob/1', readResource);
    const result = await handler();

    expect(result.contents).toEqual([
      { uri: 'vmark://blob/1', blob: 'AAAA', mimeType: 'image/png' },
    ]);
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
