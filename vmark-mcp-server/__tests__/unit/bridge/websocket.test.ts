/**
 * Tests for WebSocketBridge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { WebSocketBridge } from '../../../src/bridge/websocket.js';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/types.js';

/**
 * Message format for WebSocket communication.
 */
interface WsMessage {
  id: string;
  type: 'request' | 'response';
  payload: BridgeRequest | BridgeResponse;
}

describe('WebSocketBridge', () => {
  let server: WebSocketServer;
  let bridge: WebSocketBridge;
  let serverConnections: WsWebSocket[];
  const TEST_PORT = 19224; // Use different port for tests

  beforeEach(() => {
    serverConnections = [];
    server = new WebSocketServer({ port: TEST_PORT });

    server.on('connection', (ws) => {
      serverConnections.push(ws);
    });

    bridge = new WebSocketBridge({
      port: TEST_PORT,
      timeout: 5000,
      autoReconnect: false,
    });
  });

  afterEach(async () => {
    await bridge.disconnect();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('connect', () => {
    it('should connect to WebSocket server', async () => {
      await bridge.connect();
      expect(bridge.isConnected()).toBe(true);
    });

    it('should notify connection change on connect', async () => {
      const callback = vi.fn();
      bridge.onConnectionChange(callback);

      await bridge.connect();

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('should reject if server is not available', async () => {
      const badBridge = new WebSocketBridge({
        port: 19999, // Non-existent server
        timeout: 1000,
        autoReconnect: false,
      });

      await expect(badBridge.connect()).rejects.toThrow();
    });

    it('should be idempotent when already connected', async () => {
      await bridge.connect();
      await bridge.connect(); // Should not throw
      expect(bridge.isConnected()).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from server', async () => {
      await bridge.connect();
      expect(bridge.isConnected()).toBe(true);

      await bridge.disconnect();
      expect(bridge.isConnected()).toBe(false);
    });

    it('should notify connection change on disconnect', async () => {
      await bridge.connect();

      const callback = vi.fn();
      bridge.onConnectionChange(callback);

      await bridge.disconnect();

      expect(callback).toHaveBeenCalledWith(false);
    });

    it('should reject pending requests on disconnect', async () => {
      await bridge.connect();

      // Set up server to not respond
      serverConnections[0].on('message', () => {
        // Don't respond
      });

      const sendPromise = bridge.send({ type: 'document.getContent' });

      // Disconnect while request is pending
      await bridge.disconnect();

      await expect(sendPromise).rejects.toThrow('Connection closed');
    });

    it('should be safe to call when not connected', async () => {
      await bridge.disconnect(); // Should not throw
      expect(bridge.isConnected()).toBe(false);
    });
  });

  describe('send', () => {
    it('should send request and receive response', async () => {
      await bridge.connect();

      // Set up server to respond
      serverConnections[0].on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: 'Hello World' },
        };
        serverConnections[0].send(JSON.stringify(response));
      });

      const result = await bridge.send<string>({ type: 'document.getContent' });

      expect(result.success).toBe(true);
      expect(result.data).toBe('Hello World');
    });

    it('should handle error responses', async () => {
      await bridge.connect();

      serverConnections[0].on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: false, error: 'Document not found' },
        };
        serverConnections[0].send(JSON.stringify(response));
      });

      const result = await bridge.send({ type: 'document.getContent' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Document not found');
      }
    });

    it('should timeout if no response', async () => {
      const fastBridge = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 100,
        autoReconnect: false,
      });

      await fastBridge.connect();

      // Server doesn't respond
      serverConnections[0].on('message', () => {
        // Intentionally don't respond
      });

      await expect(
        fastBridge.send({ type: 'document.getContent' })
      ).rejects.toThrow('Request timeout');

      await fastBridge.disconnect();
    });

    it('should reject if not connected', async () => {
      await expect(bridge.send({ type: 'document.getContent' })).rejects.toThrow(
        'Not connected'
      );
    });

    it('should handle multiple concurrent requests', async () => {
      await bridge.connect();

      const responses: Record<string, string> = {};
      serverConnections[0].on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const request = message.payload as BridgeRequest;

        // Simulate async processing with different delays
        const delay = request.type === 'document.getContent' ? 50 : 10;
        responses[message.id] = request.type;

        setTimeout(() => {
          const response: WsMessage = {
            id: message.id,
            type: 'response',
            payload: { success: true, data: request.type },
          };
          serverConnections[0].send(JSON.stringify(response));
        }, delay);
      });

      const [result1, result2] = await Promise.all([
        bridge.send<string>({ type: 'document.getContent' }),
        bridge.send<string>({ type: 'selection.get' }),
      ]);

      expect(result1.data).toBe('document.getContent');
      expect(result2.data).toBe('selection.get');
    });

    it('should pass request payload correctly', async () => {
      await bridge.connect();

      let receivedRequest: BridgeRequest | null = null;
      serverConnections[0].on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        receivedRequest = message.payload as BridgeRequest;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: null },
        };
        serverConnections[0].send(JSON.stringify(response));
      });

      await bridge.send({
        type: 'document.setContent',
        content: 'Test content',
        windowId: 'main',
      });

      expect(receivedRequest).toMatchObject({
        type: 'document.setContent',
        content: 'Test content',
        windowId: 'main',
      });
    });
  });

  describe('onConnectionChange', () => {
    it('should allow multiple callbacks', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bridge.onConnectionChange(callback1);
      bridge.onConnectionChange(callback2);

      await bridge.connect();

      expect(callback1).toHaveBeenCalledWith(true);
      expect(callback2).toHaveBeenCalledWith(true);
    });

    it('should allow unsubscribing', async () => {
      const callback = vi.fn();
      const unsubscribe = bridge.onConnectionChange(callback);

      await bridge.connect();
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      await bridge.disconnect();
      // Should not be called again
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconnection', () => {
    it('should auto-reconnect when enabled', async () => {
      const reconnectBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        reconnectDelay: 100,
        maxReconnectAttempts: 3,
      });

      await reconnectBridge.connect();
      expect(reconnectBridge.isConnected()).toBe(true);

      const reconnectPromise = new Promise<void>((resolve) => {
        reconnectBridge.onConnectionChange((connected) => {
          if (connected) {
            resolve();
          }
        });
      });

      // Force disconnect from server side
      serverConnections[0].close();

      // Wait for reconnection
      await reconnectPromise;
      expect(reconnectBridge.isConnected()).toBe(true);

      await reconnectBridge.disconnect();
    });

    it('should not auto-reconnect on intentional disconnect', async () => {
      const reconnectBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        reconnectDelay: 50,
      });

      await reconnectBridge.connect();

      const callback = vi.fn();
      reconnectBridge.onConnectionChange(callback);

      await reconnectBridge.disconnect();

      // Wait a bit to ensure no reconnection attempt
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should only be called once for disconnect, not for reconnect
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(false);
    });

    it('should use exponential backoff', async () => {
      // Close the server to force reconnection failures
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      const reconnectBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        reconnectDelay: 50,
        maxReconnectAttempts: 2,
      });

      // This should fail since server is closed
      await expect(reconnectBridge.connect()).rejects.toThrow();

      // Clean up
      await reconnectBridge.disconnect();

      // Restart server for afterEach cleanup
      server = new WebSocketServer({ port: TEST_PORT });
    });

    it('should schedule reconnect when port is undefined and autoReconnect is true', async () => {
      // Simulates the case where VMark has not started yet and the port file
      // does not exist. The portResolver returns undefined, connect() throws,
      // but a reconnect must still be scheduled so the sidecar retries later.
      const portUnavailableBridge = new WebSocketBridge({
        portResolver: () => undefined,
        autoReconnect: true,
        reconnectDelay: 100,
        maxReconnectAttempts: 3,
      });

      const scheduleSpy = vi.spyOn(
        portUnavailableBridge as unknown as { scheduleReconnect: () => void },
        'scheduleReconnect'
      );

      try {
        await portUnavailableBridge.connect();
      } catch {
        // Expected to throw because port is undefined
      }

      expect(scheduleSpy).toHaveBeenCalled();

      // Clean up — cancel the pending reconnect timer
      await portUnavailableBridge.disconnect();
    });

    it('should NOT schedule reconnect when port is undefined and autoReconnect is false', async () => {
      const portUnavailableBridge = new WebSocketBridge({
        portResolver: () => undefined,
        autoReconnect: false,
      });

      const scheduleSpy = vi.spyOn(
        portUnavailableBridge as unknown as { scheduleReconnect: () => void },
        'scheduleReconnect'
      );

      try {
        await portUnavailableBridge.connect();
      } catch {
        // Expected to throw
      }

      expect(scheduleSpy).not.toHaveBeenCalled();
    });

    it('should cancel reconnect timer when disconnect is called after port-unavailable retry is scheduled', async () => {
      // When port is unavailable, a reconnect is scheduled. If the user then
      // calls disconnect() explicitly, the scheduled timer must be cleared so
      // no further reconnect attempts happen.
      const portUnavailableBridge = new WebSocketBridge({
        portResolver: () => undefined,
        autoReconnect: true,
        reconnectDelay: 200,
        maxReconnectAttempts: 5,
      });

      // connect() will throw (port unavailable) but scheduleReconnect() will
      // have been called, setting an internal reconnectTimer.
      try {
        await portUnavailableBridge.connect();
      } catch {
        // Expected
      }

      // disconnect() should cancel the pending timer and set intentionalDisconnect.
      await portUnavailableBridge.disconnect();

      // After disconnect, no further reconnection should occur.
      // We verify by checking the bridge stays disconnected after the would-be
      // reconnect delay.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(portUnavailableBridge.isConnected()).toBe(false);
    });
  });

  describe('auth handshake', () => {
    it('should reject connect() if WebSocket closes during auth handshake', async () => {
      const authBridge = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 5000,
        autoReconnect: false,
        authTokenResolver: () => 'test-token',
      });

      // Server receives connection but closes it immediately after auth message
      // (simulates VMark restart or invalid token before auth_result is sent)
      server.on('connection', (ws) => {
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'auth') {
            // Close without sending auth_result
            ws.close();
          }
        });
      });

      await expect(authBridge.connect()).rejects.toThrow(
        'Connection closed during authentication'
      );
    });
  });

  describe('connection lost during request', () => {
    it('should reject request when connection is lost', async () => {
      await bridge.connect();

      const sendPromise = bridge.send({ type: 'document.getContent' });

      // Close connection from server side
      serverConnections[0].close();

      await expect(sendPromise).rejects.toThrow('Connection lost');
    });
  });

  describe('rate limiting', () => {
    it('should reject requests when rate limit exceeded', async () => {
      const rateLimitedBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: false,
        maxRequestsPerSecond: 2,
      });

      await rateLimitedBridge.connect();

      // Set up server to respond
      serverConnections[0].on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: 'ok' },
        };
        serverConnections[0].send(JSON.stringify(response));
      });

      // First 2 requests should succeed
      await rateLimitedBridge.send({ type: 'test1' });
      await rateLimitedBridge.send({ type: 'test2' });

      // Third request should be rate limited
      await expect(rateLimitedBridge.send({ type: 'test3' })).rejects.toThrow(
        'Rate limit exceeded'
      );

      await rateLimitedBridge.disconnect();
    });

    it('should allow requests after rate limit window passes', async () => {
      const rateLimitedBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: false,
        maxRequestsPerSecond: 2,
      });

      await rateLimitedBridge.connect();

      serverConnections[0].on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: 'ok' },
        };
        serverConnections[0].send(JSON.stringify(response));
      });

      // Exhaust rate limit
      await rateLimitedBridge.send({ type: 'test1' });
      await rateLimitedBridge.send({ type: 'test2' });

      // Wait for token refill
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should work again
      const result = await rateLimitedBridge.send({ type: 'test3' });
      expect(result.success).toBe(true);

      await rateLimitedBridge.disconnect();
    });

    it('should not rate limit when maxRequestsPerSecond is 0', async () => {
      const unlimitedBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: false,
        maxRequestsPerSecond: 0, // Unlimited
      });

      await unlimitedBridge.connect();

      serverConnections[0].on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: 'ok' },
        };
        serverConnections[0].send(JSON.stringify(response));
      });

      // Should not rate limit
      for (let i = 0; i < 10; i++) {
        const result = await unlimitedBridge.send({ type: `test${i}` });
        expect(result.success).toBe(true);
      }

      await unlimitedBridge.disconnect();
    });
  });

  describe('request queueing', () => {
    it('should queue requests when disconnected and queueing enabled', async () => {
      const queueBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        queueWhileDisconnected: true,
        maxQueueSize: 10,
        reconnectDelay: 100,
      });

      // Set up handler for all connections (including reconnects)
      server.on('connection', (ws) => {
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString()) as WsMessage;
          const response: WsMessage = {
            id: message.id,
            type: 'response',
            payload: { success: true, data: 'queued-response' },
          };
          ws.send(JSON.stringify(response));
        });
      });

      await queueBridge.connect();

      // Force disconnect
      serverConnections[0].close();

      // Wait for bridge to notice disconnect
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send while disconnected - should queue
      const sendPromise = queueBridge.send<string>({ type: 'queued.request' });

      // Wait for reconnection and queue flush
      const result = await sendPromise;
      expect(result.success).toBe(true);
      expect(result.data).toBe('queued-response');

      await queueBridge.disconnect();
    }, 10000);

    it('should reject when queue is full', async () => {
      const queueBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        queueWhileDisconnected: true,
        maxQueueSize: 2,
        reconnectDelay: 30000, // Very long delay to prevent reconnect
      });

      await queueBridge.connect();

      // Force disconnect
      serverConnections[0].close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Fill queue - catch to avoid unhandled rejections on disconnect
      const p1 = queueBridge.send({ type: 'queued1' }).catch(() => {});
      const p2 = queueBridge.send({ type: 'queued2' }).catch(() => {});

      // Third request should fail
      await expect(queueBridge.send({ type: 'queued3' })).rejects.toThrow('Request queue full');

      await queueBridge.disconnect();
      // Wait for queued promises to reject
      await Promise.all([p1, p2]);
    });

    it('should reject queued requests on intentional disconnect', async () => {
      const queueBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        queueWhileDisconnected: true,
        maxQueueSize: 10,
        reconnectDelay: 30000, // Very long delay to prevent reconnect during test
      });

      await queueBridge.connect();

      // Force disconnect from server side
      serverConnections[0].close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Queue a request (don't await)
      const sendPromise = queueBridge.send({ type: 'queued.request' });

      // Give it a moment to queue
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Intentionally disconnect - should reject queued request
      await queueBridge.disconnect();

      await expect(sendPromise).rejects.toThrow('Connection closed');
    });

    it('should not queue when queueWhileDisconnected is false', async () => {
      const noQueueBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        queueWhileDisconnected: false,
      });

      await noQueueBridge.connect();

      // Force disconnect
      serverConnections[0].close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should reject immediately
      await expect(noQueueBridge.send({ type: 'test' })).rejects.toThrow('Not connected');

      await noQueueBridge.disconnect();
    });
  });
});
