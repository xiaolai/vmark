/**
 * WebSocketBridge - Real WebSocket connection to VMark.
 *
 * Implements the Bridge interface for production use.
 * Connects to VMark's WebSocket server and relays MCP commands.
 */

import WebSocket from 'ws';
import type { Bridge, BridgeRequest, BridgeResponse } from './types.js';

/**
 * Logger interface for WebSocketBridge.
 * Compatible with console, pino, winston, etc.
 */
export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

/**
 * Default no-op logger (silent).
 */
const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Client identification sent during WebSocket handshake.
 */
export interface ClientIdentity {
  /** Client name (e.g., "claude-code", "codex-cli", "cursor") */
  name: string;
  /** Client version */
  version?: string;
  /** Process ID */
  pid?: number;
  /** Parent process name (helps identify which AI spawned this) */
  parentProcess?: string;
}

/**
 * Function to resolve port dynamically (e.g., read from file).
 */
export type PortResolver = () => number | undefined;

/**
 * Configuration for WebSocketBridge.
 */
export interface WebSocketBridgeConfig {
  /** Host to connect to (default: localhost) */
  host?: string;
  /** Port to connect to (default: auto-discover from app data mcp-port file) */
  port?: number;
  /** Function to resolve port dynamically (called on each connect attempt) */
  portResolver?: PortResolver;
  /** Request timeout in ms (default: 10000, aligned with Rust bridge timeout) */
  timeout?: number;
  /** Whether to auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Base delay between reconnection attempts in ms (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnection delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Optional logger for debugging (default: silent) */
  logger?: Logger;
  /** Max requests per second for rate limiting (default: 100, 0 = unlimited) */
  maxRequestsPerSecond?: number;
  /** Queue requests while disconnected if autoReconnect is enabled (default: false) */
  queueWhileDisconnected?: boolean;
  /** Maximum queue size when disconnected (default: 100) */
  maxQueueSize?: number;
  /** Client identity for VMark to identify who is connecting */
  clientIdentity?: ClientIdentity;
  /** Auth token resolver — called on each connect to get the latest token from port file */
  authTokenResolver?: () => string | undefined;
}

/**
 * Pending request waiting for response.
 */
interface PendingRequest {
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Queued request waiting for reconnection.
 */
interface QueuedRequest {
  request: BridgeRequest;
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Message format for WebSocket communication.
 */
interface WsMessage {
  id: string;
  type: 'request' | 'response' | 'status' | 'identify' | 'auth_result';
  payload: BridgeRequest | BridgeResponse;
}

/**
 * WebSocketBridge connects to VMark via WebSocket.
 */
export class WebSocketBridge implements Bridge {
  private readonly host: string;
  private port: number | undefined;
  private readonly portResolver: PortResolver | undefined;
  private readonly timeout: number;
  private readonly autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private readonly logger: Logger;
  private readonly maxRequestsPerSecond: number;
  private readonly queueWhileDisconnected: boolean;
  private readonly maxQueueSize: number;
  private readonly clientIdentity: ClientIdentity | null;
  private readonly authTokenResolver: (() => string | undefined) | undefined;
  private _authResolve: (() => void) | null = null;
  private _authReject: ((reason: string) => void) | null = null;

  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private connectionCallbacks: Set<(connected: boolean) => void> = new Set();
  private intentionalDisconnect = false;

  // Rate limiting state (token bucket)
  private rateLimitTokens: number;
  private rateLimitLastRefill: number;

  // Request queue for disconnected state
  private requestQueue: QueuedRequest[] = [];

  constructor(config: WebSocketBridgeConfig = {}) {
    this.host = config.host ?? '127.0.0.1'; // Use IPv4 explicitly to avoid IPv6 issues
    this.port = config.port; // May be undefined - will use portResolver
    this.portResolver = config.portResolver;
    this.timeout = config.timeout ?? 10000;
    this.autoReconnect = config.autoReconnect ?? true;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.reconnectDelay = config.reconnectDelay ?? 1000;
    this.maxReconnectDelay = config.maxReconnectDelay ?? 30000;
    this.logger = config.logger ?? nullLogger;
    this.maxRequestsPerSecond = config.maxRequestsPerSecond ?? 100;
    this.queueWhileDisconnected = config.queueWhileDisconnected ?? false;
    this.maxQueueSize = Math.max(1, config.maxQueueSize ?? 100);
    this.clientIdentity = config.clientIdentity ?? null;
    this.authTokenResolver = config.authTokenResolver;

    // Initialize rate limiter
    this.rateLimitTokens = this.maxRequestsPerSecond;
    this.rateLimitLastRefill = Date.now();
  }

  /**
   * Resolve the port to connect to.
   * Uses static port if set, otherwise calls portResolver.
   */
  /** Send client identification message. */
  private sendIdentify(): void {
    if (this.clientIdentity && this.ws) {
      const identifyMsg = {
        id: 'identify',
        type: 'identify',
        payload: this.clientIdentity,
      };
      try {
        this.ws.send(JSON.stringify(identifyMsg));
      } catch (error) {
        this.logger.warn('Failed to send identify message:', error);
      }
    }
  }

  private resolvePort(): number | undefined {
    if (this.port !== undefined) {
      return this.port;
    }
    if (this.portResolver) {
      const resolved = this.portResolver();
      if (resolved !== undefined) {
        this.logger.debug(`Port resolved from file: ${resolved}`);
      }
      return resolved;
    }
    return undefined;
  }

  /**
   * Get the WebSocket URL.
   */
  private getUrl(port: number): string {
    return `ws://${this.host}:${port}`;
  }

  /**
   * Generate a unique request ID.
   */
  private nextRequestId(): string {
    return `req_${++this.requestId}_${Date.now()}`;
  }

  /**
   * Check rate limit and consume a token if available.
   * Returns true if request can proceed, false if rate limited.
   */
  private checkRateLimit(): boolean {
    // Rate limiting disabled
    if (this.maxRequestsPerSecond <= 0) {
      return true;
    }

    const now = Date.now();
    const elapsed = now - this.rateLimitLastRefill;

    // Refill tokens based on elapsed time
    if (elapsed >= 1000) {
      const refillCount = Math.floor(elapsed / 1000) * this.maxRequestsPerSecond;
      this.rateLimitTokens = Math.min(
        this.maxRequestsPerSecond,
        this.rateLimitTokens + refillCount
      );
      this.rateLimitLastRefill = now - (elapsed % 1000);
    }

    if (this.rateLimitTokens > 0) {
      this.rateLimitTokens--;
      return true;
    }

    return false;
  }

  /**
   * Connect to VMark WebSocket server.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connecting) {
      // Wait for existing connection attempt with a timeout
      return new Promise((resolve, reject) => {
        let elapsed = 0;
        const maxWait = this.timeout; // Derive from configured connection timeout
        const checkConnection = () => {
          if (this.connected) {
            resolve();
          } else if (!this.connecting) {
            reject(new Error('Connection failed'));
          } else if (elapsed >= maxWait) {
            reject(new Error('Timed out waiting for existing connection attempt'));
          } else {
            elapsed += 100;
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    }

    // Reject and clear stale auth callbacks from a previous connection attempt
    if (this._authReject) {
      this._authReject('Connection superseded by new attempt');
    }
    this._authResolve = null;
    this._authReject = null;

    this.connecting = true;
    this.intentionalDisconnect = false;

    // Resolve port dynamically (may read from file)
    const port = this.resolvePort();
    if (port === undefined) {
      this.connecting = false;
      // Port file not present yet (VMark hasn't started). If autoReconnect is
      // enabled, schedule a retry so the sidecar keeps polling until VMark
      // writes the port file. Without this call the reconnect loop never starts
      // because handleDisconnect() (which normally triggers scheduleReconnect)
      // is never reached when no WebSocket is created. See issue #524.
      //
      // Don't count port-discovery polls against reconnectAttempts — those are
      // for real connection failures. Reset attempts so the sidecar keeps trying
      // until VMark starts.
      if (this.autoReconnect && !this.intentionalDisconnect) {
        this.logger.debug('Port not available yet, scheduling reconnect (not counted against limit)...');
        const savedAttempts = this.reconnectAttempts;
        this.scheduleReconnect();
        this.reconnectAttempts = savedAttempts;
      }
      throw new Error(
        'Cannot determine VMark port. Is VMark running? ' +
          'The port file (mcp-port) was not found in the app data directory.'
      );
    }

    const url = this.getUrl(port);

    return new Promise((resolve, reject) => {
      try {
        // Clean up any previous WebSocket instance to prevent memory leaks
        // and duplicate message handling on reconnection
        if (this.ws) {
          this.ws.removeAllListeners();
          if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
          }
          this.ws = null;
        }

        this.ws = new WebSocket(url);

        const connectionTimeout = setTimeout(() => {
          if (!this.connected) {
            this.ws?.close();
            this.connecting = false;
            // Let the caller (scheduleReconnect's catch block) handle reconnection
            reject(new Error(`Connection timeout to ${url}`));
          }
        }, this.timeout);

        this.ws.on('open', () => {
          clearTimeout(connectionTimeout);

          // Send auth token if available (required by VMark bridge)
          const authToken = this.authTokenResolver?.();
          if (authToken) {
            const authMsg = {
              id: 'auth',
              type: 'auth',
              payload: { token: authToken },
            };
            try {
              this.ws!.send(JSON.stringify(authMsg));
            } catch (error) {
              this.logger.warn('Failed to send auth message:', error);
              this.connecting = false;
              reject(new Error('Failed to send auth message'));
              return;
            }

            // Wait for auth_result before marking connected.
            // The message handler will call the stored callback.
            this._authResolve = () => {
              this.connected = true;
              this.connecting = false;
              this.reconnectAttempts = 0;

              // Send identify after auth succeeds
              this.sendIdentify();
              this.notifyConnectionChange(true);
              this.flushRequestQueue().catch((error) => {
                this.logger.error('Failed to flush request queue:', error);
              });
              resolve();
            };
            this._authReject = (reason: string) => {
              this.connecting = false;
              reject(new Error(`Auth failed: ${reason}`));
            };
          } else {
            // No auth token — connect immediately (legacy mode)
            this.connected = true;
            this.connecting = false;
            this.reconnectAttempts = 0;
            this.sendIdentify();
            this.notifyConnectionChange(true);
            this.flushRequestQueue().catch((error) => {
              this.logger.error('Failed to flush request queue:', error);
            });
            resolve();
          }
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
          this.handleMessage(data);
        });

        this.ws.on('close', () => {
          this.handleDisconnect();
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(connectionTimeout);
          if (!this.connected) {
            this.connecting = false;
            // Let the caller (scheduleReconnect's catch block) handle reconnection
            reject(new Error(`WebSocket error: ${error.message}`));
          }
          // If already connected, error will trigger close event
        });
      } catch (error) {
        this.connecting = false;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Disconnect from VMark.
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    // Reject all queued requests
    for (const queued of this.requestQueue) {
      queued.reject(new Error('Connection closed'));
    }
    this.requestQueue = [];

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.connected = false;
    this.connecting = false;
    this.notifyConnectionChange(false);
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a request to VMark.
   */
  async send<T = unknown>(
    request: BridgeRequest
  ): Promise<BridgeResponse & { data: T }> {
    // Check rate limit
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded');
    }

    // Queue if disconnected and queueing is enabled
    if (!this.isConnected()) {
      if (
        this.queueWhileDisconnected &&
        this.autoReconnect &&
        !this.intentionalDisconnect &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        return this.queueRequest(request);
      }
      throw new Error('Not connected to VMark');
    }

    return this.sendImmediate(request);
  }

  /**
   * Queue a request for later when reconnected.
   */
  private queueRequest<T = unknown>(
    request: BridgeRequest
  ): Promise<BridgeResponse & { data: T }> {
    // Check queue capacity before creating the promise.
    // Since JS is single-threaded, the check + push below is atomic
    // (no other code runs between them), preventing queue overflow.
    if (this.requestQueue.length >= this.maxQueueSize) {
      // Drop oldest requests to make room, preventing unbounded growth
      while (this.requestQueue.length >= this.maxQueueSize) {
        const dropped = this.requestQueue.shift();
        if (dropped) {
          dropped.reject(new Error(`Request dropped — queue overflow (type: ${dropped.request.type})`));
          this.logger.warn(`Dropped oldest queued request due to queue overflow: ${dropped.request.type}`);
        }
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from queue if still pending
        const idx = this.requestQueue.findIndex((q) => q.request === request);
        if (idx !== -1) {
          this.requestQueue.splice(idx, 1);
        }
        reject(new Error(`Queued request ${request.type} timed out`));
      }, this.timeout);

      this.requestQueue.push({
        request,
        resolve: (value: BridgeResponse) => { clearTimeout(timer); (resolve as (response: BridgeResponse) => void)(value); },
        reject: (err: Error) => { clearTimeout(timer); reject(err); },
      });

      this.logger.debug(`Request queued (queue size: ${this.requestQueue.length})`);
    });
  }

  /**
   * Send a request immediately (internal use).
   */
  private sendImmediate<T = unknown>(
    request: BridgeRequest
  ): Promise<BridgeResponse & { data: T }> {
    const id = this.nextRequestId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${request.type}`));
      }, this.timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (response: BridgeResponse) => void,
        reject,
        timer,
      });

      const message: WsMessage = {
        id,
        type: 'request',
        payload: request,
      };

      try {
        this.ws!.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Flush queued requests after reconnection.
   */
  private async flushRequestQueue(): Promise<void> {
    if (this.requestQueue.length === 0) {
      return;
    }

    this.logger.debug(`Flushing ${this.requestQueue.length} queued requests`);
    const queue = [...this.requestQueue];
    this.requestQueue = [];

    for (const { request, resolve, reject } of queue) {
      try {
        const response = await this.sendImmediate(request);
        resolve(response);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Subscribe to connection state changes.
   */
  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connectionCallbacks.add(callback);
    return () => this.connectionCallbacks.delete(callback);
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(data: WebSocket.RawData): void {
    try {
      const message = JSON.parse(data.toString()) as WsMessage;

      // Handle auth_result from server
      if (message.type === 'auth_result') {
        const success = (message.payload as { success?: boolean })?.success;
        if (success && this._authResolve) {
          this._authResolve();
          this._authResolve = null;
          this._authReject = null;
        } else if (this._authReject) {
          const error = (message.payload as { error?: string })?.error ?? 'Unknown auth error';
          this._authReject(error);
          this._authResolve = null;
          this._authReject = null;
        }
        return;
      }

      if (message.type !== 'response') {
        // Ignore status and other non-response messages
        return;
      }

      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        this.logger.warn('Received response for unknown request:', message.id);
        return;
      }

      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.id);
      pending.resolve(message.payload as BridgeResponse);
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Handle WebSocket disconnect.
   */
  private handleDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;

    // Remove all listeners before dereferencing to prevent stale handlers
    // from firing and interfering with a new connection
    if (this.ws) {
      this.ws.removeAllListeners();
    }
    this.ws = null;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection lost'));
      this.pendingRequests.delete(id);
    }

    if (wasConnected) {
      this.notifyConnectionChange(false);
    }

    // Auto-reconnect if enabled and not intentional
    if (
      this.autoReconnect &&
      !this.intentionalDisconnect &&
      this.reconnectAttempts < this.maxReconnectAttempts
    ) {
      this.scheduleReconnect();
    } else {
      // Reconnection won't be attempted — drain queued requests immediately
      // instead of letting them hang until their individual timeouts.
      for (const queued of this.requestQueue) {
        queued.reject(new Error('Connection lost and reconnection not available'));
      }
      this.requestQueue = [];
    }
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    // Guard against exceeding max reconnect attempts.
    // Guard against exceeding max reconnect attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.warn(
        `Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`
      );
      // Reject all queued requests since we won't reconnect
      for (const queued of this.requestQueue) {
        queued.reject(new Error('Max reconnect attempts exceeded'));
      }
      this.requestQueue = [];
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    this.logger.debug(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.connect();
        this.logger.info('Reconnected successfully');
      } catch (error) {
        this.logger.debug(
          `Reconnect attempt ${this.reconnectAttempts} failed:`,
          error instanceof Error ? error.message : error
        );
        // Schedule next attempt if allowed (connect no longer self-schedules)
        if (
          this.autoReconnect &&
          !this.intentionalDisconnect &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * Notify connection state change.
   */
  private notifyConnectionChange(connected: boolean): void {
    for (const callback of this.connectionCallbacks) {
      try {
        callback(connected);
      } catch (error) {
        this.logger.error('Connection callback error:', error);
      }
    }
  }
}
