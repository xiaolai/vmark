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

/**
 * Build a request envelope carrying an opaque label.
 *
 * The transport correlates strictly by envelope `id` and never inspects
 * `payload.type`, so the rate-limit and queueing tests below only need labels
 * distinct enough to tell concurrent requests apart. This helper is the single
 * place that fiction is admitted, instead of scattering casts across ~15 call
 * sites. Tests that DO care about a real request use the real union member.
 */
function probe(type: string): BridgeRequest {
  return { type } as unknown as BridgeRequest;
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
    vi.useRealTimers();
    await bridge.disconnect();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  /**
   * Connect a bridge AND return its SERVER-side socket deterministically.
   * `await connect()` resolves on the CLIENT 'open', which can beat the server's
   * 'connection' event under load — so reading `serverConnections[0]` right after
   * connect() races and can attach a responder to a missing socket, leaving the
   * request without a reply. Register the connection listener BEFORE connecting,
   * then await it.
   */
  async function connectAndServerSocket(b: WebSocketBridge): Promise<WsWebSocket> {
    const socket = new Promise<WsWebSocket>((resolve) => server.once('connection', resolve));
    await b.connect();
    return socket;
  }

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
      const conn = await connectAndServerSocket(bridge);

      // Set up server to not respond
      conn.on('message', () => {
        // Don't respond
      });

      const sendPromise = bridge.send({ type: 'vmark.document.read' });

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
      const conn = await connectAndServerSocket(bridge);

      // Set up server to respond
      conn.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: 'Hello World' },
        };
        conn.send(JSON.stringify(response));
      });

      const result = await bridge.send<string>({ type: 'vmark.document.read' });

      expect(result.success).toBe(true);
      expect(result.data).toBe('Hello World');
    });

    it('should handle error responses', async () => {
      const conn = await connectAndServerSocket(bridge);

      conn.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: false, error: 'Document not found' },
        };
        conn.send(JSON.stringify(response));
      });

      const result = await bridge.send({ type: 'vmark.document.read' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Document not found');
      }
    });

    it('should timeout if no response', async () => {
      const fastBridge = new WebSocketBridge({ port: TEST_PORT, autoReconnect: false });

      const conn = await connectAndServerSocket(fastBridge);

      // Server doesn't respond
      conn.on('message', () => {
        // Intentionally don't respond
      });

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const sent = expect(fastBridge.send({ type: 'vmark.document.read' })).rejects.toThrow('Request timeout');
      await vi.advanceTimersByTimeAsync(25_000);
      await sent;
      vi.useRealTimers();

      await fastBridge.disconnect();
    });

    it('should reject if not connected', async () => {
      await expect(bridge.send({ type: 'vmark.document.read' })).rejects.toThrow(
        'Not connected'
      );
    });

    it('should handle multiple concurrent requests', async () => {
      const conn = await connectAndServerSocket(bridge);

      const responses: Record<string, string> = {};
      conn.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const request = message.payload as BridgeRequest;

        // Simulate async processing with different delays
        const delay = request.type === 'vmark.document.read' ? 50 : 10;
        responses[message.id] = request.type;

        setTimeout(() => {
          const response: WsMessage = {
            id: message.id,
            type: 'response',
            payload: { success: true, data: request.type },
          };
          conn.send(JSON.stringify(response));
        }, delay);
      });

      const [result1, result2] = await Promise.all([
        bridge.send<string>({ type: 'vmark.document.read' }),
        bridge.send<string>({ type: 'vmark.selection.get' }),
      ]);

      expect(result1.data).toBe('vmark.document.read');
      expect(result2.data).toBe('vmark.selection.get');
    });

    it('should pass request payload correctly', async () => {
      const conn = await connectAndServerSocket(bridge);

      let receivedRequest: BridgeRequest | null = null;
      conn.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        receivedRequest = message.payload as BridgeRequest;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: null },
        };
        conn.send(JSON.stringify(response));
      });

      await bridge.send({
        type: 'vmark.document.write',
        content: 'Test content',
        tabId: 'main',
      });

      expect(receivedRequest).toMatchObject({
        type: 'vmark.document.write',
        content: 'Test content',
        tabId: 'main',
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
      const connectSpy = vi.spyOn(reconnectBridge, 'connect');

      // Fake the timers the reconnect loop would arm, then drive the clock far
      // past every backoff step: an armed retry would call connect().
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await reconnectBridge.disconnect();
      await vi.advanceTimersByTimeAsync(50 * 2 ** 10);

      expect(connectSpy).not.toHaveBeenCalled();
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

      // The retry timer is armed inside connect(), so the clock is faked first.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      // connect() will throw (port unavailable) but scheduleReconnect() will
      // have been called, setting an internal reconnectTimer.
      await expect(portUnavailableBridge.connect()).rejects.toThrow('Cannot determine VMark port');
      expect(vi.getTimerCount()).toBe(1);

      // disconnect() should cancel the pending timer and set intentionalDisconnect.
      await portUnavailableBridge.disconnect();
      const connectSpy = vi.spyOn(portUnavailableBridge, 'connect');

      // Drive the clock well past the would-be retry: a surviving timer would
      // call connect() again.
      await vi.advanceTimersByTimeAsync(200 * 10);
      expect(vi.getTimerCount()).toBe(0);
      expect(connectSpy).not.toHaveBeenCalled();
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
        revivalBridge.send({ type: 'vmark.document.read' })
      ).rejects.toThrow('Not connected');
      expect(internal.reconnectAttempts).toBe(0);

      await vi.waitFor(() => {
        expect(revivalBridge.isConnected()).toBe(true);
      });

      const result = await revivalBridge.send<string>({ type: 'vmark.document.read' });
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

      const result = await queueRevivalBridge.send<string>({ type: 'vmark.document.read' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('revived');

      await queueRevivalBridge.disconnect();
    });
  });

  /**
   * The per-client credential (audit 20260728 §2.1).
   *
   * The bridge's authorization principal is bound to what arrives in the auth
   * frame's `client_token`, so what matters on this side is that the sidecar
   * puts it there when it holds one — and omits the field entirely when it
   * does not, which is the pre-upgrade state and must still connect.
   */
  describe('per-client credential in the auth frame', () => {
    /** The first frame a bridge sends, parsed. */
    async function firstFrame(b: WebSocketBridge): Promise<Record<string, unknown>> {
      const frame = new Promise<Record<string, unknown>>((resolve) => {
        server.once('connection', (ws) => {
          ws.once('message', (data: Buffer) => {
            const message = JSON.parse(data.toString()) as Record<string, unknown>;
            ws.send(
              JSON.stringify({ id: 'auth', type: 'auth_result', payload: { success: true } })
            );
            resolve(message);
          });
        });
      });
      await b.connect();
      return frame;
    }

    it('sends the credential alongside the shared bridge token', async () => {
      const credentialed = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 5000,
        autoReconnect: false,
        authTokenResolver: () => 'shared-token',
        clientTokenResolver: () => 'cred-codex',
      });

      const frame = await firstFrame(credentialed);

      expect(frame.type).toBe('auth');
      expect(frame.payload).toEqual({ token: 'shared-token', client_token: 'cred-codex' });
      await credentialed.disconnect();
    });

    it('omits the field entirely when no credential is configured', async () => {
      const plain = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 5000,
        autoReconnect: false,
        authTokenResolver: () => 'shared-token',
      });

      const frame = await firstFrame(plain);

      expect(frame.payload).toEqual({ token: 'shared-token' });
      expect(frame.payload).not.toHaveProperty('client_token');
      await plain.disconnect();
    });

    /**
     * A blank credential must not become `client_token: ""` on the wire — an
     * empty credential is "no credential", and VMark refuses to match one.
     */
    it('omits the field when the resolver returns a blank credential', async () => {
      const blank = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 5000,
        autoReconnect: false,
        authTokenResolver: () => 'shared-token',
        clientTokenResolver: () => '',
      });

      const frame = await firstFrame(blank);

      expect(frame.payload).toEqual({ token: 'shared-token' });
      await blank.disconnect();
    });

    /**
     * Resolved at 'open', not at construction: a credential rewritten by an
     * Install while the sidecar runs is picked up by the next attempt.
     */
    it('re-resolves the credential on every connection attempt', async () => {
      let current = 'cred-first';
      const rotating = new WebSocketBridge({
        port: TEST_PORT,
        timeout: 5000,
        autoReconnect: false,
        authTokenResolver: () => 'shared-token',
        clientTokenResolver: () => current,
      });

      const first = await firstFrame(rotating);
      expect((first.payload as { client_token: string }).client_token).toBe('cred-first');
      await rotating.disconnect();

      current = 'cred-second';
      const second = await firstFrame(rotating);
      expect((second.payload as { client_token: string }).client_token).toBe('cred-second');
      await rotating.disconnect();
    });
  });

  describe('disconnect during CONNECTING (MCP-6)', () => {
    /**
     * Close the server and wait for its 'close', which fires only once every
     * client TCP connection is gone — so any event the orphaned socket could
     * still deliver has been delivered. A fresh server replaces it for
     * afterEach.
     */
    async function drainServer(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server = new WebSocketServer({ port: TEST_PORT });
    }

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

      // Wait until the orphaned socket's whole lifecycle is over: the stale
      // 'open', if any, must not have fired into the bridge.
      await drainServer();

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

      await drainServer();

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
      // Timing, on a fake clock (only the timers are faked; socket I/O is
      // real): timer #1 fires at t=CONNECT_TIMEOUT. Attempt #2 starts at
      // t=RECONNECT_AT and gets auth_result at t=RECONNECT_AT+AUTH_REPLY_DELAY
      // — AFTER timer #1, i.e. mid-handshake — while its own auth timeout
      // would only fire at t=RECONNECT_AT+CONNECT_TIMEOUT.
      const CONNECT_TIMEOUT = 1000;
      const RECONNECT_AT = 400;
      const AUTH_REPLY_DELAY = 800;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      // Server: complete the auth handshake only after a delay, so attempt #2
      // is still connecting (connected === false) when timer #1 fires.
      let authArrived!: () => void;
      const authReceived = new Promise<void>((resolve) => {
        authArrived = resolve;
      });
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
            authArrived();
          }
        });
      });

      const staleBridge = new WebSocketBridge({
        port: TEST_PORT,
        timeout: CONNECT_TIMEOUT,
        autoReconnect: false,
        authTokenResolver: () => 'test-token',
      });

      // Attempt #1: timer #1 armed at t=0. Supersede immediately.
      const attempt1 = staleBridge.connect();
      attempt1.catch(() => {}); // settles later — must not be unhandled
      await staleBridge.disconnect();

      await vi.advanceTimersByTimeAsync(RECONNECT_AT);
      const attempt2 = staleBridge.connect();
      // Attempt #2 has opened and sent auth; the server's reply is armed.
      await authReceived;

      // Fires timer #1 (t=CONNECT_TIMEOUT), then the auth reply.
      await vi.advanceTimersByTimeAsync(AUTH_REPLY_DELAY);

      // Attempt #2 must survive timer #1 and complete.
      await expect(attempt2).resolves.toBeUndefined();
      expect(staleBridge.isConnected()).toBe(true);

      // The superseded attempt's promise must settle (reject), not hang.
      await expect(attempt1).rejects.toThrow();

      await staleBridge.disconnect();
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

    it('should reject connect() if auth_result never arrives within timeout', async () => {
      // Simulates the wedge scenario described in audit #862: VMark accepts the
      // WebSocket and the auth message but never replies with auth_result
      // (e.g., serialization failure, sender-task hang). Without a bounded wait,
      // connect() would hang forever and block the reconnect loop.
      const AUTH_TIMEOUT = 200;
      const authBridge = new WebSocketBridge({
        port: TEST_PORT,
        timeout: AUTH_TIMEOUT,
        autoReconnect: false,
        authTokenResolver: () => 'test-token',
      });

      // Server accepts the connection and the auth message but never replies.
      const authReceived = new Promise<void>((resolve) => {
        server.once('connection', (ws) => ws.once('message', () => resolve()));
      });

      // Only the timers are faked; the socket handshake is real I/O. The auth
      // deadline is armed in the same synchronous step that writes the auth
      // frame, so once the server holds the frame the deadline is armed.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let outcome: unknown = 'pending';
      const connecting = authBridge.connect().then(
        () => (outcome = 'resolved'),
        (error: unknown) => (outcome = error)
      );
      await authReceived;

      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT - 1);
      expect(outcome).toBe('pending');

      await vi.advanceTimersByTimeAsync(1);
      await connecting;
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toContain('Auth handshake timeout');
    });
  });

  describe('connect() while an attempt is already in flight', () => {
    /** Settle state of a promise, readable without awaiting it. */
    function watch(promise: Promise<void>): { outcome: () => unknown } {
      let outcome: unknown = 'pending';
      promise.then(
        () => (outcome = 'resolved'),
        (error: unknown) => (outcome = error)
      );
      return { outcome: () => outcome };
    }

    it('resolves once the in-flight attempt connects, on its next poll', async () => {
      // The second caller polls the bridge every 100ms; only that timer is faked.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const first = bridge.connect();
      const second = watch(bridge.connect());

      await first;
      expect(bridge.isConnected()).toBe(true);
      expect(second.outcome()).toBe('pending');

      await vi.advanceTimersByTimeAsync(99);
      expect(second.outcome()).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(second.outcome()).toBe('resolved');
    });

    it('rejects when the in-flight attempt fails', async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      // Nothing listens on the port: the attempt fails with a socket error.
      const first = bridge.connect();
      const second = watch(bridge.connect());
      await expect(first).rejects.toThrow('WebSocket error');
      expect(second.outcome()).toBe('pending');

      await vi.advanceTimersByTimeAsync(100);
      expect(second.outcome()).toBeInstanceOf(Error);
      expect((second.outcome() as Error).message).toBe('Connection failed');

      // afterEach closes `server`; give it a live one to close.
      vi.useRealTimers();
      server = new WebSocketServer({ port: TEST_PORT });
    });

    it('gives up after the configured timeout while the attempt is still authenticating', async () => {
      const TIMEOUT = 200;
      const HOLD_PORT = TEST_PORT + 1;
      // A server that holds the upgrade until released, then never answers auth.
      let release!: () => void;
      const upgradeHeld = new Promise<void>((held) => {
        release = () => held();
      });
      let allowUpgrade!: () => void;
      const holdServer = new WebSocketServer({
        port: HOLD_PORT,
        verifyClient: (_info, done) => {
          allowUpgrade = () => done(true);
          release();
        },
      });
      const authReceived = new Promise<void>((resolve) => {
        holdServer.once('connection', (ws) => ws.once('message', () => resolve()));
      });
      const slowBridge = new WebSocketBridge({
        port: HOLD_PORT,
        timeout: TIMEOUT,
        autoReconnect: false,
        authTokenResolver: () => 'test-token',
      });

      try {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const first = watch(slowBridge.connect());
        const second = watch(slowBridge.connect());

        // Open the socket 50ms in, so the attempt's own auth deadline (armed at
        // open) lands at 250ms — after the waiting caller's 200ms budget.
        await upgradeHeld;
        await vi.advanceTimersByTimeAsync(50);
        allowUpgrade();
        await authReceived;

        await vi.advanceTimersByTimeAsync(149);
        expect(second.outcome()).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(second.outcome()).toBeInstanceOf(Error);
        expect((second.outcome() as Error).message).toBe('Timed out waiting for existing connection attempt');
        expect(first.outcome()).toBe('pending');

        await vi.advanceTimersByTimeAsync(50);
        expect((first.outcome() as Error).message).toContain('Auth handshake timeout');
      } finally {
        vi.useRealTimers();
        await slowBridge.disconnect();
        await new Promise<void>((resolve) => holdServer.close(() => resolve()));
      }
    });
  });

  describe('connection lost during request', () => {
    it('should reject request when connection is lost', async () => {
      await bridge.connect();

      const sendPromise = bridge.send({ type: 'vmark.document.read' });

      // Close connection from server side
      serverConnections[0].close();

      await expect(sendPromise).rejects.toThrow('Connection lost');
    });
  });

  describe('rate limiting', () => {
    // The bucket refills on Date.now(); a frozen clock means a slow machine
    // cannot cross the one-second window between sends and refill it.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T00:00:00Z') });
    });

    it('should reject requests when rate limit exceeded', async () => {
      const rateLimitedBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: false,
        maxRequestsPerSecond: 2,
      });

      const conn = await connectAndServerSocket(rateLimitedBridge);

      // Set up server to respond
      conn.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: 'ok' },
        };
        conn.send(JSON.stringify(response));
      });

      // First 2 requests should succeed
      await rateLimitedBridge.send(probe('test1'));
      await rateLimitedBridge.send(probe('test2'));

      // Third request should be rate limited
      await expect(rateLimitedBridge.send(probe('test3'))).rejects.toThrow(
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
      const windowStart = Date.now();

      const serverConn = await connectAndServerSocket(rateLimitedBridge);
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
      await rateLimitedBridge.send(probe('test1'));
      await rateLimitedBridge.send(probe('test2'));

      // One millisecond short of the window: still limited.
      vi.setSystemTime(windowStart + 999);
      await expect(rateLimitedBridge.send(probe('early'))).rejects.toThrow('Rate limit exceeded');

      // The full window has passed: the bucket refills.
      vi.setSystemTime(windowStart + 1000);
      const result = await rateLimitedBridge.send(probe('test3'));
      expect(result.success).toBe(true);

      await rateLimitedBridge.disconnect();
    });

    it('should not rate limit when maxRequestsPerSecond is 0', async () => {
      const unlimitedBridge = new WebSocketBridge({
        port: TEST_PORT,
        autoReconnect: false,
        maxRequestsPerSecond: 0, // Unlimited
      });

      const conn = await connectAndServerSocket(unlimitedBridge);

      conn.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WsMessage;
        const response: WsMessage = {
          id: message.id,
          type: 'response',
          payload: { success: true, data: 'ok' },
        };
        conn.send(JSON.stringify(response));
      });

      // Should not rate limit
      for (let i = 0; i < 10; i++) {
        const result = await unlimitedBridge.send(probe(`test${i}`));
        expect(result.success).toBe(true);
      }

      await unlimitedBridge.disconnect();
    });
  });

  describe('request queueing', () => {
    /** Close the server side and resolve once the bridge has noticed. */
    async function dropFromServer(b: WebSocketBridge): Promise<void> {
      const noticed = new Promise<void>((resolve) => {
        const unsubscribe = b.onConnectionChange((connected) => {
          if (!connected) {
            unsubscribe();
            resolve();
          }
        });
      });
      serverConnections[0].close();
      await noticed;
    }

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

      await dropFromServer(queueBridge);

      // Send while disconnected - should queue
      const sendPromise = queueBridge.send<string>(probe('queued.request'));

      // Wait for reconnection and queue flush
      const result = await sendPromise;
      expect(result.success).toBe(true);
      expect(result.data).toBe('queued-response');

      await queueBridge.disconnect();
    });

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

      await dropFromServer(queueBridge);

      // Fill the queue to capacity (maxQueueSize = 2).
      const p1 = queueBridge.send(probe('queued1'));
      const p2 = queueBridge.send(probe('queued2')).catch(() => {});

      // Third send overflows: the oldest queued request (p1) is evicted and
      // rejected, while queued3 is accepted into the queue.
      const p3 = queueBridge.send(probe('queued3')).catch(() => {});
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

      await dropFromServer(queueBridge);

      // Queue a request (don't await). send() enqueues synchronously.
      const sendPromise = queueBridge.send(probe('queued.request'));

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

      await dropFromServer(noQueueBridge);

      // Should reject immediately
      await expect(noQueueBridge.send(probe('test'))).rejects.toThrow('Not connected');

      await noQueueBridge.disconnect();
    });
  });

  describe('queue-wait timer / flush race (#959)', () => {
    it('resolves a queued request that flush completes after the queue timer fires', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      // The queue-wait timer fires while sendImmediate is still in flight
      // (sendImmediate is stubbed to resolve on demand).
      const raceBridge = new WebSocketBridge();
      const internal = raceBridge as unknown as {
        queueRequest: (r: BridgeRequest) => Promise<BridgeResponse>;
        flushRequestQueue: () => Promise<void>;
        sendImmediate: (r: BridgeRequest) => Promise<BridgeResponse>;
      };

      const success: BridgeResponse = { success: true, data: 'flushed' };
      let deliver!: (response: BridgeResponse) => void;
      internal.sendImmediate = () =>
        new Promise<BridgeResponse>((resolve) => {
          deliver = resolve;
        });

      const pending = internal.queueRequest({ type: 'vmark.session.get_state' });
      const flushed = internal.flushRequestQueue();

      // The queue-wait timer fires while the request is in flight (the queue
      // was already drained by flush) ...
      await vi.advanceTimersByTimeAsync(25_000);
      // ... and only then does the send complete.
      deliver(success);
      await flushed;

      // The request must still resolve with the success value, not reject.
      await expect(pending).resolves.toMatchObject({ success: true, data: 'flushed' });
    });

    it('still rejects with a timeout when a queued request is never flushed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const raceBridge = new WebSocketBridge();
      const internal = raceBridge as unknown as {
        queueRequest: (r: BridgeRequest) => Promise<BridgeResponse>;
      };

      const queued = expect(internal.queueRequest({ type: 'vmark.session.get_state' })).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(25_000);
      await queued;
    });
  });
});
