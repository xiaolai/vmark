/**
 * WebSocketBridge - Real WebSocket connection to VMark.
 *
 * Implements the Bridge interface for production use.
 * Connects to VMark's WebSocket server and relays MCP commands.
 *
 * This file is the composition root only. Its separable parts live beside it:
 * `websocketConfig` (options + defaults), `connection` (endpoint + socket
 * lifecycle), `authHandshake`, `reconnect` (retry loop), `pendingRequests`,
 * `requestQueue`, `rateLimiter`, `wsProtocol` (wire format).
 */

import WebSocket from 'ws';
import type { Bridge, BridgeRequest, BridgeResponse } from './types.js';
import { AuthHandshake } from './authHandshake.js';
import { disposeSocket, openConnection, resolveEndpoint, waitForExistingAttempt } from './connection.js';
import { PendingRequestRegistry } from './pendingRequests.js';
import { TokenBucketRateLimiter } from './rateLimiter.js';
import { ReconnectLoop } from './reconnect.js';
import { OutboundRequestQueue } from './requestQueue.js';
import { resolveBridgeConfig, type ResolvedBridgeConfig, type WebSocketBridgeConfig } from './websocketConfig.js';
import { sendIdentify, type WsMessage } from './wsProtocol.js';

type { ClientIdentity, Logger, PortResolver, WebSocketBridgeConfig } from './websocketConfig.js';

/**
 * WebSocketBridge connects to VMark via WebSocket.
 */
export class WebSocketBridge implements Bridge {
  private readonly config: ResolvedBridgeConfig;
  private readonly auth = new AuthHandshake();
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly queue: OutboundRequestQueue;
  private readonly pending: PendingRequestRegistry;
  private readonly reconnect: ReconnectLoop;

  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private connectionCallbacks: Set<(connected: boolean) => void> = new Set();
  private intentionalDisconnect = false;

  constructor(config: WebSocketBridgeConfig = {}) {
    this.config = resolveBridgeConfig(config);
    this.rateLimiter = new TokenBucketRateLimiter(this.config.maxRequestsPerSecond);
    this.queue = new OutboundRequestQueue(
      this.config.maxQueueSize,
      this.config.requestTimeout,
      this.config.logger
    );
    this.pending = new PendingRequestRegistry(this.config.requestTimeout, this.config.logger);
    this.reconnect = new ReconnectLoop(this.config, this.config.logger, {
      connect: () => this.connect(),
      mayRetry: () => this.config.autoReconnect && !this.intentionalDisconnect,
      onExhausted: () => this.queue.rejectAll('Max reconnect attempts exceeded'),
      reschedule: () => this.scheduleReconnect(),
    });
  }

  /** Reconnect budget and armed retry — kept as accessors so ReconnectLoop owns the state. */
  private get reconnectAttempts(): number { return this.reconnect.attempts; }
  private set reconnectAttempts(value: number) { this.reconnect.attempts = value; }
  private get reconnectTimer(): ReturnType<typeof setTimeout> | null { return this.reconnect.timer; }

  /** Detach and dispose the current WebSocket instance (idempotent). */
  private cleanupSocket(): void {
    disposeSocket(this.ws);
    this.ws = null;
  }

  /** Schedule a reconnection attempt. Single entry point into the retry loop. */
  private scheduleReconnect(): void {
    this.reconnect.schedule();
  }

  /** Connect to VMark WebSocket server. */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connecting) {
      // Wait for existing connection attempt with a timeout
      return waitForExistingAttempt(
        () => this.connected,
        () => this.connecting,
        this.config.timeout
      );
    }

    // Reject and clear stale auth callbacks from a previous connection attempt
    this.auth.supersede();

    this.connecting = true;
    this.intentionalDisconnect = false;

    // Resolve the endpoint dynamically (may read the port from file)
    const url = resolveEndpoint(this.config);
    if (url === undefined) {
      this.connecting = false;
      this.pollForPort();
      throw new Error(
        'Cannot determine VMark port. Is VMark running? ' +
          'The port file (mcp-port) was not found in the app data directory.'
      );
    }

    return openConnection({
      url,
      timeout: this.config.timeout,
      logger: this.config.logger,
      auth: this.auth,
      authTokenResolver: this.config.authTokenResolver,
      clientTokenResolver: this.config.clientTokenResolver,
      hooks: {
        beforeConnect: () => this.cleanupSocket(),
        adopt: (socket) => { this.ws = socket; },
        isSuperseded: (socket) => this.ws !== socket,
        isConnected: () => this.connected,
        setConnecting: (connecting) => { this.connecting = connecting; },
        onAuthenticated: () => this.markConnected(),
        onMessage: (data) => this.handleMessage(data),
        onClose: () => this.handleDisconnect(),
      },
    });
  }

  /**
   * Keep polling until VMark writes the port file.
   *
   * Port file not present yet (VMark hasn't started). If autoReconnect is
   * enabled, schedule a retry so the sidecar keeps polling until VMark
   * writes the port file. Without this call the reconnect loop never starts
   * because handleDisconnect() (which normally triggers scheduleReconnect)
   * is never reached when no WebSocket is created. See issue #524.
   *
   * Don't count port-discovery polls against reconnectAttempts — those are
   * for real connection failures. Reset attempts so the sidecar keeps trying
   * until VMark starts.
   */
  private pollForPort(): void {
    if (this.config.autoReconnect && !this.intentionalDisconnect) {
      this.config.logger.debug('Port not available yet, scheduling reconnect (not counted against limit)...');
      const savedAttempts = this.reconnectAttempts;
      this.scheduleReconnect();
      this.reconnectAttempts = savedAttempts;
    }
  }

  /** Adopt a completed handshake: identify, publish the change, drain the queue. */
  private markConnected(): void {
    this.connected = true;
    this.connecting = false;
    this.reconnectAttempts = 0;

    // Send identify after auth succeeds
    sendIdentify(this.ws, this.config.clientIdentity, this.config.logger);
    this.notifyConnectionChange(true);
    this.flushRequestQueue().catch((error) => {
      this.config.logger.error('Failed to flush request queue:', error);
    });
  }

  /** Disconnect from VMark. */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.reconnect.cancel();

    this.pending.rejectAll('Connection closed');
    this.queue.rejectAll('Connection closed');

    this.cleanupSocket();

    this.connected = false;
    this.connecting = false;
    this.notifyConnectionChange(false);
  }

  /** Check if connected. */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Send a request to VMark. */
  async send<T = unknown>(
    request: BridgeRequest
  ): Promise<BridgeResponse<T>> {
    // Check rate limit
    if (!this.rateLimiter.tryConsume()) {
      throw new Error('Rate limit exceeded');
    }

    // Queue if disconnected and queueing is enabled
    if (!this.isConnected()) {
      // Revive a dead reconnect loop: once maxReconnectAttempts is exhausted
      // nothing re-kicks connect(), so every later call would fail forever
      // even after VMark comes back. A send() arriving while the loop is
      // fully idle — no connect in flight, none scheduled — resets the
      // attempt budget and starts a fresh connection in the background.
      if (
        this.config.autoReconnect &&
        !this.intentionalDisconnect &&
        !this.connecting &&
        !this.reconnectTimer
      ) {
        this.reconnect.revive();
      }
      if (this.config.queueWhileDisconnected && this.reconnect.mayStillReconnect()) {
        return this.queueRequest(request);
      }
      throw new Error('Not connected to VMark');
    }

    return this.sendImmediate(request);
  }

  /** Queue a request for later when reconnected. */
  private queueRequest<T = unknown>(request: BridgeRequest): Promise<BridgeResponse<T>> {
    return this.queue.enqueue<T>(request);
  }

  /** Send a request immediately (internal use). */
  private sendImmediate<T = unknown>(request: BridgeRequest): Promise<BridgeResponse<T>> {
    return this.pending.dispatch<T>(request, (payload) => this.ws!.send(payload));
  }

  /** Flush queued requests after reconnection. */
  private async flushRequestQueue(): Promise<void> {
    // `this.sendImmediate` is looked up per request, not captured — the #959
    // regression test replaces it on the instance.
    await this.queue.flush((request) => this.sendImmediate(request));
  }

  /** Subscribe to connection state changes. */
  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connectionCallbacks.add(callback);
    return () => this.connectionCallbacks.delete(callback);
  }

  /** Handle incoming WebSocket message. */
  private handleMessage(data: WebSocket.RawData): void {
    try {
      const message = JSON.parse(data.toString()) as WsMessage;

      // Handle auth_result from server
      if (message.type === 'auth_result') {
        this.auth.settleFromResult(message.payload);
        return;
      }

      if (message.type !== 'response') {
        // Ignore status and other non-response messages
        return;
      }

      this.pending.settle(message);
    } catch (error) {
      this.config.logger.error('Failed to parse WebSocket message:', error);
    }
  }

  /** Handle WebSocket disconnect. */
  private handleDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;

    // Reject pending auth if WebSocket closed during handshake
    this.auth.abort('Connection closed during authentication');

    // Remove all listeners before dereferencing to prevent stale handlers
    // from firing and interfering with a new connection
    this.cleanupSocket();

    this.pending.rejectAll('Connection lost');

    if (wasConnected) {
      this.notifyConnectionChange(false);
    }

    // Auto-reconnect if enabled and not intentional
    if (this.reconnect.mayStillReconnect()) {
      this.scheduleReconnect();
    } else {
      // Reconnection won't be attempted — drain queued requests immediately
      // instead of letting them hang until their individual timeouts.
      this.queue.rejectAll('Connection lost and reconnection not available');
    }
  }

  /** Notify connection state change. */
  private notifyConnectionChange(connected: boolean): void {
    for (const callback of this.connectionCallbacks) {
      try {
        callback(connected);
      } catch (error) {
        this.config.logger.error('Connection callback error:', error);
      }
    }
  }
}
