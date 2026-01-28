/**
 * Tests for MockBridge class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockBridge } from './mockBridge.js';

describe('MockBridge', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = new MockBridge();
  });

  describe('connection management', () => {
    it('should start connected by default', () => {
      expect(bridge.isConnected()).toBe(true);
    });

    it('should start disconnected when configured', () => {
      const disconnectedBridge = new MockBridge({ connected: false });
      expect(disconnectedBridge.isConnected()).toBe(false);
    });

    it('should connect when connect() is called', async () => {
      const disconnectedBridge = new MockBridge({ connected: false });
      await disconnectedBridge.connect();
      expect(disconnectedBridge.isConnected()).toBe(true);
    });

    it('should disconnect when disconnect() is called', async () => {
      await bridge.disconnect();
      expect(bridge.isConnected()).toBe(false);
    });

    it('should notify callbacks on connection change', async () => {
      const callback = vi.fn();
      bridge.onConnectionChange(callback);

      await bridge.disconnect();
      expect(callback).toHaveBeenCalledWith(false);

      await bridge.connect();
      expect(callback).toHaveBeenCalledWith(true);
    });

    it('should unsubscribe callback when returned function is called', async () => {
      const callback = vi.fn();
      const unsubscribe = bridge.onConnectionChange(callback);

      unsubscribe();
      await bridge.disconnect();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should throw on send when disconnected and configured to throw', async () => {
      await bridge.disconnect();

      await expect(
        bridge.send({ type: 'document.getContent' })
      ).rejects.toThrow('Bridge not connected');
    });

    it('should not throw on send when disconnected if configured not to', async () => {
      const noThrowBridge = new MockBridge({ throwOnDisconnected: false });
      await noThrowBridge.disconnect();

      const response = await noThrowBridge.send({ type: 'document.getContent' });
      expect(response.success).toBe(true);
    });
  });

  describe('request recording', () => {
    it('should record all requests', async () => {
      await bridge.send({ type: 'document.getContent' });
      await bridge.send({ type: 'selection.get' });

      expect(bridge.requests).toHaveLength(2);
      expect(bridge.requests[0].request.type).toBe('document.getContent');
      expect(bridge.requests[1].request.type).toBe('selection.get');
    });

    it('should include timestamp in recorded requests', async () => {
      const before = Date.now();
      await bridge.send({ type: 'document.getContent' });
      const after = Date.now();

      expect(bridge.requests[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(bridge.requests[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should filter requests by type', async () => {
      await bridge.send({ type: 'document.getContent' });
      await bridge.send({ type: 'selection.get' });
      await bridge.send({ type: 'document.getContent' });

      const documentRequests = bridge.getRequestsOfType('document.getContent');
      expect(documentRequests).toHaveLength(2);
    });

    it('should clear requests', async () => {
      await bridge.send({ type: 'document.getContent' });
      bridge.clearRequests();

      expect(bridge.requests).toHaveLength(0);
    });
  });

  describe('document operations', () => {
    it('should get empty content initially', async () => {
      const response = await bridge.send({ type: 'document.getContent' });

      expect(response.success).toBe(true);
      expect(response.data).toBe('');
    });

    it('should set and get content', async () => {
      bridge.setContent('Hello, world!');

      const response = await bridge.send({ type: 'document.getContent' });

      expect(response.success).toBe(true);
      expect(response.data).toBe('Hello, world!');
    });

    it('should update metadata when content is set', () => {
      bridge.setContent('Hello world');

      const state = bridge.getWindowState();
      expect(state?.metadata.characterCount).toBe(11);
      expect(state?.metadata.wordCount).toBe(2);
      expect(state?.metadata.isModified).toBe(true);
    });

    it('should set content via send on empty document', async () => {
      // Ensure document is empty (default state)
      expect(bridge.getWindowState()?.content).toBe('');

      const result = await bridge.send({ type: 'document.setContent', content: 'New content' });
      expect(result.success).toBe(true);

      const response = await bridge.send({ type: 'document.getContent' });
      expect(response.data).toBe('New content');
    });

    it('should reject setContent on non-empty document', async () => {
      bridge.setContent('existing content');

      const result = await bridge.send({ type: 'document.setContent', content: 'New content' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('only allowed on empty documents');
      expect(result.error).toContain('document_insert_at_cursor');
      // Content unchanged
      expect(bridge.getWindowState()?.content).toBe('existing content');
    });

    it('should insert at cursor', async () => {
      bridge.setContent('Hello world');
      bridge.setCursorPosition(6); // After "Hello "

      await bridge.send({ type: 'document.insertAtCursor', text: 'beautiful ' });

      const response = await bridge.send({ type: 'document.getContent' });
      expect(response.data).toBe('Hello beautiful world');
    });

    it('should insert at specific position', async () => {
      bridge.setContent('Hello world');

      await bridge.send({
        type: 'document.insertAtPosition',
        text: 'cruel ',
        position: 6,
      });

      const response = await bridge.send({ type: 'document.getContent' });
      expect(response.data).toBe('Hello cruel world');
    });
  });

  describe('selection operations', () => {
    it('should get empty selection initially', async () => {
      const response = await bridge.send({ type: 'selection.get' });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        text: '',
        range: { from: 0, to: 0 },
        isEmpty: true,
      });
    });

    it('should set and get selection', async () => {
      bridge.setContent('Hello world');
      bridge.setSelection(0, 5);

      const response = await bridge.send({ type: 'selection.get' });

      expect(response.data).toEqual({
        text: 'Hello',
        range: { from: 0, to: 5 },
        isEmpty: false,
      });
    });

    it('should set selection via send', async () => {
      bridge.setContent('Hello world');

      await bridge.send({ type: 'selection.set', from: 6, to: 11 });

      const response = await bridge.send({ type: 'selection.get' });
      expect(response.data).toMatchObject({
        text: 'world',
        range: { from: 6, to: 11 },
      });
    });

    it('should replace selection', async () => {
      bridge.setContent('Hello world');
      bridge.setSelection(6, 11);

      await bridge.send({ type: 'selection.replace', text: 'universe' });

      const content = await bridge.send({ type: 'document.getContent' });
      expect(content.data).toBe('Hello universe');
    });

    it('should delete selection', async () => {
      bridge.setContent('Hello cruel world');
      bridge.setSelection(6, 12); // "cruel "

      await bridge.send({ type: 'selection.delete' });

      const content = await bridge.send({ type: 'document.getContent' });
      expect(content.data).toBe('Hello world');
    });
  });

  describe('search and replace', () => {
    it('should find matches in document', async () => {
      bridge.setContent('Hello world, hello universe');

      const response = await bridge.send({
        type: 'document.search',
        query: 'hello',
        caseSensitive: false,
      });

      expect(response.success).toBe(true);
      const data = response.data as { count: number; matches: unknown[] };
      expect(data.count).toBe(2);
      expect(data.matches).toHaveLength(2);
    });

    it('should respect case sensitivity', async () => {
      bridge.setContent('Hello world, hello universe');

      const response = await bridge.send({
        type: 'document.search',
        query: 'Hello',
        caseSensitive: true,
      });

      const data = response.data as { count: number };
      expect(data.count).toBe(1);
    });

    it('should replace first occurrence', async () => {
      bridge.setContent('foo bar foo baz');

      await bridge.send({
        type: 'document.replace',
        search: 'foo',
        replace: 'qux',
        all: false,
      });

      const content = await bridge.send({ type: 'document.getContent' });
      expect(content.data).toBe('qux bar foo baz');
    });

    it('should replace all occurrences', async () => {
      bridge.setContent('foo bar foo baz');

      const response = await bridge.send({
        type: 'document.replace',
        search: 'foo',
        replace: 'qux',
        all: true,
      });

      const data = response.data as { count: number };
      expect(data.count).toBe(2);

      const content = await bridge.send({ type: 'document.getContent' });
      expect(content.data).toBe('qux bar qux baz');
    });
  });

  describe('cursor context', () => {
    it('should get cursor context', async () => {
      bridge.setContent('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
      bridge.setCursorPosition(14); // In "Line 3"

      const response = await bridge.send({
        type: 'cursor.getContext',
        linesBefore: 2,
        linesAfter: 2,
      });

      expect(response.success).toBe(true);
      const data = response.data as {
        currentLine: string;
        before: string;
        after: string;
      };
      expect(data.currentLine).toBe('Line 3');
      expect(data.before).toContain('Line 1');
      expect(data.after).toContain('Line 4');
    });

    it('should set cursor position via send', async () => {
      bridge.setContent('Hello world');

      await bridge.send({ type: 'cursor.setPosition', position: 5 });

      const state = bridge.getWindowState();
      expect(state?.cursorPosition).toBe(5);
    });
  });

  describe('metadata and outline', () => {
    it('should get metadata', async () => {
      bridge.setContent('# Hello\n\nSome content here.');
      bridge.setMetadata({ filePath: '/path/to/file.md', title: 'Hello' });

      const response = await bridge.send({ type: 'metadata.get' });

      expect(response.success).toBe(true);
      const data = response.data as { filePath: string; title: string };
      expect(data.filePath).toBe('/path/to/file.md');
      expect(data.title).toBe('Hello');
    });

    it('should extract outline from headings', async () => {
      bridge.setContent('# Heading 1\n\nContent\n\n## Heading 2\n\nMore content');

      const response = await bridge.send({ type: 'outline.get' });

      expect(response.success).toBe(true);
      const data = response.data as Array<{ level: number; text: string }>;
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ level: 1, text: 'Heading 1' });
      expect(data[1]).toMatchObject({ level: 2, text: 'Heading 2' });
    });
  });

  describe('multi-window support', () => {
    it('should list windows', async () => {
      bridge.addWindow('second', { title: 'Second Doc' });

      const response = await bridge.send({ type: 'windows.list' });

      expect(response.success).toBe(true);
      const data = response.data as Array<{ label: string }>;
      expect(data).toHaveLength(2);
    });

    it('should get focused window', async () => {
      const response = await bridge.send({ type: 'windows.getFocused' });

      expect(response.success).toBe(true);
      expect(response.data).toBe('main');
    });

    it('should operate on specific window', async () => {
      bridge.addWindow('second');
      bridge.setContent('Main content', 'main');
      bridge.setContent('Second content', 'second');

      const mainResponse = await bridge.send({
        type: 'document.getContent',
        windowId: 'main',
      });
      const secondResponse = await bridge.send({
        type: 'document.getContent',
        windowId: 'second',
      });

      expect(mainResponse.data).toBe('Main content');
      expect(secondResponse.data).toBe('Second content');
    });

    it('should operate on focused window when windowId is "focused"', async () => {
      bridge.addWindow('second');
      bridge.setContent('Main content', 'main');
      bridge.setContent('Second content', 'second');
      bridge.setFocusedWindow('second');

      const response = await bridge.send({
        type: 'document.getContent',
        windowId: 'focused',
      });

      expect(response.data).toBe('Second content');
    });

    it('should only list AI-exposed windows', async () => {
      bridge.addWindow('private', { isAiExposed: false });

      const response = await bridge.send({ type: 'windows.list' });

      const data = response.data as Array<{ label: string }>;
      expect(data).toHaveLength(1);
      expect(data[0].label).toBe('main');
    });
  });

  describe('error handling', () => {
    it('should return error for unknown request type', async () => {
      const response = await bridge.send({
        type: 'unknown.type' as 'document.getContent',
      });

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.error).toContain('Unknown request type');
        expect(response.code).toBe('UNKNOWN_REQUEST');
      }
    });

    it('should throw programmed error', async () => {
      bridge.setNextError(new Error('Programmed error'));

      await expect(bridge.send({ type: 'document.getContent' })).rejects.toThrow(
        'Programmed error'
      );
    });

    it('should clear programmed error after throw', async () => {
      bridge.setNextError(new Error('Programmed error'));

      await expect(bridge.send({ type: 'document.getContent' })).rejects.toThrow();

      // Next request should succeed
      const response = await bridge.send({ type: 'document.getContent' });
      expect(response.success).toBe(true);
    });
  });

  describe('custom response handlers', () => {
    it('should use custom handler when set', async () => {
      bridge.setResponseHandler('document.getContent', () => ({
        success: true,
        data: 'Custom response',
      }));

      const response = await bridge.send({ type: 'document.getContent' });

      expect(response.data).toBe('Custom response');
    });

    it('should clear custom handler', async () => {
      bridge.setResponseHandler('document.getContent', () => ({
        success: true,
        data: 'Custom response',
      }));
      bridge.clearResponseHandler('document.getContent');
      bridge.setContent('Real content');

      const response = await bridge.send({ type: 'document.getContent' });

      expect(response.data).toBe('Real content');
    });
  });

  describe('latency simulation', () => {
    it('should simulate latency', async () => {
      const slowBridge = new MockBridge({ latency: 50 });

      const start = Date.now();
      await slowBridge.send({ type: 'document.getContent' });
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(45); // Allow some variance
    });
  });

  describe('reset', () => {
    it('should reset to initial state', async () => {
      bridge.setContent('Some content');
      bridge.addWindow('second');
      await bridge.send({ type: 'document.getContent' });

      bridge.reset();

      expect(bridge.requests).toHaveLength(0);
      const response = await bridge.send({ type: 'document.getContent' });
      expect(response.data).toBe('');

      const windows = await bridge.send({ type: 'windows.list' });
      expect((windows.data as unknown[]).length).toBe(1);
    });
  });
});
