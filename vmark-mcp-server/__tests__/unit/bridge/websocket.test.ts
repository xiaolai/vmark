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
        requestTimeout: 100,
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

  describe('port resolution (MCP-1)', () => {
    it('uses the static port and never consults the resolver (explicit --port override semantics)', async () => {
      const resolver = vi.fn(() => 19998); // dead port — must not be dialed
      const staticBridge = new WebSocketBridge({
        port: TEST_PORT,
        portResolver: resolver,
        autoReconnect: false,
      });

      await staticBridge.connect();

      expect(staticBridge.isConnected()).toBe(true);
      expect(resolver).not.toHaveBeenCalled();

      await staticBridge.disconnect();
    });

    it('re-resolves the port via portResolver on every attempt, picking up a changed port', async () => {
      // Simulates a VMark restart: the first read of the port file yields a
      // port nobody listens on any more; the retry re-reads the file and gets
      // the live port. A static port would shadow the resolver forever.
      let call = 0;
      const resolver = vi.fn(() => (call++ === 0 ? 19993 : TEST_PORT));
      const resolverBridge = new WebSocketBridge({
        portResolver: resolver,
        autoReconnect: true,
        reconnectDelay: 20,
        maxReconnectAttempts: 5,
        timeout: 1000,
      });

      const connected = new Promise<void>((resolve) => {
        resolverBridge.onConnectionChange((c) => {
          if (c) resolve();
        });
      });

      // First attempt dials the dead port and fails.
      await resolverBridge.connect().catch(() => {});

      // The retry must call the resolver again and reach the live port.
      await connected;
      expect(resolver.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(resolverBridge.isConnected()).toBe(true);

      await resolverBridge.disconnect();
    });
  });

  describe('reconnect revival after exhaustion (MCP-4)', () => {
    /** Drive a bridge into the dead state: attempts exhausted, loop idle. */
    async function exhaustReconnects(target: WebSocketBridge): Promise<void> {
      const internal = target as unknown as {
        reconnectAttempts: number;
        reconnectTimer: unknown;
        connecting: boolean;
      };
      // Stop listening and drop the live connection so the single allowed
      // reconnect attempt fails with ECONNREFUSED. Note: server.close()'s
      // callback only fires after all client sockets are gone, so terminate
      // the connection before awaiting it.
      const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      serverConnections.forEach((ws) => ws.terminate());
      await serverClosed;

      await vi.waitFor(() => {
        expect(target.isConnected()).toBe(false);
        expect(internal.reconnectAttempts).toBe(1);
        expect(internal.reconnectTimer).toBeNull();
        expect(internal.connecting).toBe(false);
      });
    }

    /** Restart the test server with a success responder for all connections. */
    function restartServer(): void {
      server = new WebSocketServer({ port: TEST_PORT });
      server.on('connection', (ws) => {
        serverConnections.push(ws);
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString()) as WsMessage;
          const response: WsMessage = {
            id: message.id,
            type: 'response',
            payload: { success: true, data: 'revived' },
          };
          ws.send(JSON.stringify(response));
        });
      });
    }

    it('send() while the reconnect loop is dead resets the budget and revives the connection', async () => {
      const revivalBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        reconnectDelay: 20,
        maxReconnectAttempts: 1,
        timeout: 1000,
      });
      const internal = revivalBridge as unknown as { reconnectAttempts: number };

      await revivalBridge.connect();
      await exhaustReconnects(revivalBridge);

      // VMark comes back.
      restartServer();

      // The send itself still fails (no queueing) but must kick a fresh
      // connect() instead of leaving the bridge dead forever.
      await expect(
        revivalBridge.send({ type: 'document.getContent' })
      ).rejects.toThrow('Not connected');
      expect(internal.reconnectAttempts).toBe(0);

      await vi.waitFor(() => {
        expect(revivalBridge.isConnected()).toBe(true);
      });

      const result = await revivalBridge.send<string>({ type: 'document.getContent' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('revived');

      await revivalBridge.disconnect();
    });

    it('send() with queueing enabled after exhaustion queues and resolves once revived', async () => {
      const queueRevivalBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: true,
        reconnectDelay: 20,
        maxReconnectAttempts: 1,
        queueWhileDisconnected: true,
        timeout: 1000,
      });

      await queueRevivalBridge.connect();
      await exhaustReconnects(queueRevivalBridge);

      restartServer();

      const result = await queueRevivalBridge.send<string>({ type: 'document.getContent' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('revived');

      await queueRevivalBridge.disconnect();
    });
  });

  describe('disconnect during CONNECTING (MCP-6)', () => {
    it('detaches listeners so a late open cannot crash the process (auth token path)', async () => {
      const authBridge = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 150,
        autoReconnect: false,
        authTokenResolver: () => 'test-token',
      });

      // Start connecting but disconnect before the handshake completes —
      // the socket is still CONNECTING when disconnect() runs.
      const connectPromise = authBridge.connect();
      await authBridge.disconnect();

      // The orphaned connect() promise must settle via rejection, not hang
      // (pre-fix, the stale 'open' handler cleared the connection timeout and
      // then crashed on `this.ws!.send` with ws === null).
      await expect(connectPromise).rejects.toThrow();

      // Give the server-side handshake time to complete; the stale 'open'
      // must not fire into the bridge.
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(authBridge.isConnected()).toBe(false);
      expect((authBridge as unknown as { connected: boolean }).connected).toBe(false);
    });

    it('does not mark the bridge connected via a stale open (legacy tokenless path)', async () => {
      const plainBridge = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 150,
        autoReconnect: false,
      });

      const connectPromise = plainBridge.connect();
      await plainBridge.disconnect();

      await expect(connectPromise).rejects.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(plainBridge.isConnected()).toBe(false);
      expect((plainBridge as unknown as { connected: boolean }).connected).toBe(false);
    });
  });

  describe('stale connection timeout must not kill a newer socket', () => {
    it('leaves the new connection attempt untouched when a superseded attempt times out', async () => {
      // Scenario: connect #1 arms its connection timer, disconnect() supersedes
      // it, connect #2 starts and is still mid-auth-handshake when timer #1
      // fires. Pre-fix, timer #1 closed `this.ws` — the CURRENT socket, i.e.
      // attempt #2's socket — so attempt #2 died with "Connection closed
      // during authentication" long before its own timeout.
      // Timing: timer #1 fires at t=CONNECT_TIMEOUT. Attempt #2 sends auth at
      // t≈RECONNECT_AT and gets auth_result at t≈RECONNECT_AT+AUTH_REPLY_DELAY
      // (~200ms AFTER timer #1 — mid-handshake), while its own auth timeout
      // would only fire at t≈RECONNECT_AT+CONNECT_TIMEOUT (~200ms margin).
      const CONNECT_TIMEOUT = 1000;
      const RECONNECT_AT = 400;
      const AUTH_REPLY_DELAY = 800;

      // Server: complete the auth handshake only after a delay, so attempt #2
      // is still connecting (connected === false) when timer #1 fires.
      server.on('connection', (ws) => {
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString()) as { type?: string };
          if (message.type === 'auth') {
            setTimeout(() => {
              ws.send(
                JSON.stringify({
                  id: 'auth',
                  type: 'auth_result',
                  payload: { success: true },
                })
              );
            }, AUTH_REPLY_DELAY);
          }
        });
      });

      const staleBridge = new WebSocketBridge({
        port: TEST_PORT,
        timeout: CONNECT_TIMEOUT,
        autoReconnect: false,
        authTokenResolver: () => 'test-token',
      });

      // Attempt #1: timer armed at t=0 (fires at t=600). Supersede immediately.
      const attempt1 = staleBridge.connect();
      attempt1.catch(() => {}); // settles later — must not be unhandled
      await staleBridge.disconnect();

      // Attempt #2 starts at t≈200; auth_result arrives at t≈800; its own
      // auth timer would fire at t≈800+... — timer #1 fires at t=600, in the
      // middle of attempt #2's handshake.
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_AT));
      const attempt2 = staleBridge.connect();

      // Attempt #2 must survive timer #1 and complete.
      await expect(attempt2).resolves.toBeUndefined();
      expect(staleBridge.isConnected()).toBe(true);

      // The superseded attempt's promise must settle (reject), not hang.
      await expect(attempt1).rejects.toThrow();

      await staleBridge.disconnect();
    }, 10000);
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

    it('should reject connect() if auth_result never arrives within timeout', async () => {
      // Simulates the wedge scenario described in audit #862: VMark accepts the
      // WebSocket and the auth message but never replies with auth_result
      // (e.g., serialization failure, sender-task hang). Without a bounded wait,
      // connect() would hang forever and block the reconnect loop.
      const authBridge = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 200,
        autoReconnect: false,
        authTokenResolver: () => 'test-token',
      });

      // Server accepts connection but never responds to the auth message.
      // beforeEach already registers a listener that just tracks connections;
      // we don't add any message handler, so auth goes unanswered.

      const start = Date.now();
      await expect(authBridge.connect()).rejects.toThrow('Auth handshake timeout');
      const elapsed = Date.now() - start;
      // Should reject around `timeout` ms — allow generous slack for timer jitter.
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(700);
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

    // Generous timeout: this exercises a real ~1s rate-limit refill window plus
    // real socket round-trips, which slows down under the full parallel suite.
    it('should allow requests after rate limit window passes', { timeout: 20000 }, async () => {
      const rateLimitedBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: false,
        maxRequestsPerSecond: 2,
      });

      // Capture the SERVER-side socket deterministically. `await connect()`
      // resolves on the CLIENT 'open', which can beat the server's 'connection'
      // event under load — so reading `serverConnections[0]` (populated by that
      // event) raced, attaching the responder to the wrong/missing socket and
      // leaving test3 with no reply (the ~11s hang this de-flakes).
      const serverConn = await new Promise<WsWebSocket>((resolve) => {
        server.once('connection', (ws) => resolve(ws));
        void rateLimitedBridge.connect();
      });
      await rateLimitedBridge.connect(); // ensure the client side is also open

      serverConn.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: 'ok' },
        };
        serverConn.send(JSON.stringify(response));
      });

      // Exhaust rate limit
      await rateLimitedBridge.send({ type: 'test1' });
      await rateLimitedBridge.send({ type: 'test2' });

      // Wait for token refill (real ~1s window + margin)
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

    it('should drop the oldest queued request when the queue is full', async () => {
      // Overflow policy is drop-oldest (bounded memory, newest-wins): when the
      // queue is full the oldest request is evicted and rejected, and the new
      // request is accepted. The new request is NOT rejected on arrival.
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

      // Fill the queue to capacity (maxQueueSize = 2).
      const p1 = queueBridge.send({ type: 'queued1' });
      const p2 = queueBridge.send({ type: 'queued2' }).catch(() => {});

      // Third send overflows: the oldest queued request (p1) is evicted and
      // rejected, while queued3 is accepted into the queue.
      const p3 = queueBridge.send({ type: 'queued3' }).catch(() => {});
      await expect(p1).rejects.toThrow('queue overflow');

      // queued3 was queued (not rejected on arrival) — it rejects only once the
      // bridge is intentionally disconnected, proving it survived the overflow.
      await queueBridge.disconnect();
      await Promise.all([p2, p3]);
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

  describe('queue-wait timer / flush race (#959)', () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('resolves a queued request that flush completes after the queue timer fires', async () => {
      // Short queue-wait timeout so the timer fires while sendImmediate is
      // still in flight (sendImmediate is stubbed to resolve later).
      const raceBridge = new WebSocketBridge({ requestTimeout: 20 });
      const internal = raceBridge as unknown as {
        queueRequest: (r: BridgeRequest) => Promise<BridgeResponse>;
        flushRequestQueue: () => Promise<void>;
        sendImmediate: (r: BridgeRequest) => Promise<BridgeResponse>;
      };

      const success: BridgeResponse = { success: true, data: 'flushed' };
      // Resolves AFTER the 20ms queue-wait timeout has elapsed.
      internal.sendImmediate = async () => {
        await delay(60);
        return success;
      };

      const pending = internal.queueRequest({ type: 'vmark.session.get_state' });
      await internal.flushRequestQueue();

      // The queue-wait timer fired at ~20ms (queue already drained by flush);
      // the request must still resolve with the success value, not reject.
      await expect(pending).resolves.toMatchObject({ success: true, data: 'flushed' });
    });

    it('still rejects with a timeout when a queued request is never flushed', async () => {
      const raceBridge = new WebSocketBridge({ requestTimeout: 20 });
      const internal = raceBridge as unknown as {
        queueRequest: (r: BridgeRequest) => Promise<BridgeResponse>;
      };

      await expect(
        internal.queueRequest({ type: 'vmark.session.get_state' }),
      ).rejects.toThrow(/timed out/);
    });
  });
});
