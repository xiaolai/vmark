/**
 * Tests for MCP adapter utilities.
 *
 * Covers toMcpContent and createToolHandler — the whole adapter surface since
 * the resources half (toMcpContents / createResourceHandler) was deleted with
 * the empty resource capability (audit 20260728 §4).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  toMcpContent,
  createToolHandler,
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
    expect(result[0]).toEqual({ type: 'text', text: 'valid' });
  });

  it('should return empty array for empty input', () => {
    expect(toMcpContent([])).toEqual([]);
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
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Bridge disconnected') });
  });

  it('should catch non-Error thrown values', async () => {
    const callTool = vi.fn().mockRejectedValue('string error');

    const handler = createToolHandler('my_tool', callTool);
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('string error') });
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
