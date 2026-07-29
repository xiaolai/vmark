/**
 * WebSocketBridge configuration surface.
 *
 * Holds the public option types (`WebSocketBridgeConfig`, `Logger`,
 * `ClientIdentity`, `PortResolver`) and the ONE place their defaults are
 * applied. `websocket.ts` re-exports the public names, so this split is
 * invisible to consumers.
 */

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
 *
 * **Display only.** VMark shows `name` in Settings > Integrations and in its
 * logs; it reaches no authorization decision there. Authorization binds to the
 * verified credential from `clientTokenResolver` instead — `name` is a guess
 * (see `utils/clientIdentity.ts`) and used to be forgeable by anyone holding
 * the shared bridge token (audit 20260728 §2.1).
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
  /** Host to connect to (default: '127.0.0.1' — the IPv4 literal, not 'localhost') */
  host?: string;
  /** Port to connect to (default: auto-discover from app data mcp-port file) */
  port?: number;
  /** Function to resolve port dynamically (called on each connect attempt) */
  portResolver?: PortResolver;
  /** Connection / auth-handshake timeout in ms (default: 10000) */
  timeout?: number;
  /**
   * Pending-request timeout in ms (default: 25000). Must exceed the Rust
   * bridge's worst case of 20s (10s initial wait + 10s wake-and-retry,
   * server.rs) — a shorter value discards retry results that the bridge
   * successfully recovered, so the AI client sees a timeout even though
   * the write WAS applied (audit H21).
   */
  requestTimeout?: number;
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
  /**
   * Per-client credential resolver — called on each connect for the token
   * VMark issued to THIS AI client (`VMARK_MCP_TOKEN` in its MCP config).
   *
   * Separate from `authTokenResolver` because the two do different jobs: the
   * auth token decides whether the connection is allowed, this one decides who
   * the connection IS. Returning `undefined` connects normally, unidentified.
   */
  clientTokenResolver?: () => string | undefined;
}

/**
 * `WebSocketBridgeConfig` with every default applied — what the bridge and its
 * collaborators actually read. Immutable: nothing reassigns a field after
 * construction, including `port` (a static port always wins over the resolver).
 */
export interface ResolvedBridgeConfig {
  readonly host: string;
  readonly port: number | undefined;
  readonly portResolver: PortResolver | undefined;
  readonly timeout: number;
  readonly requestTimeout: number;
  readonly autoReconnect: boolean;
  readonly maxReconnectAttempts: number;
  readonly reconnectDelay: number;
  readonly maxReconnectDelay: number;
  readonly logger: Logger;
  readonly maxRequestsPerSecond: number;
  readonly queueWhileDisconnected: boolean;
  readonly maxQueueSize: number;
  readonly clientIdentity: ClientIdentity | null;
  readonly authTokenResolver: (() => string | undefined) | undefined;
  readonly clientTokenResolver: (() => string | undefined) | undefined;
}

/**
 * Apply the documented defaults to a caller-supplied config.
 */
export function resolveBridgeConfig(
  config: WebSocketBridgeConfig = {}
): ResolvedBridgeConfig {
  return {
    host: config.host ?? '127.0.0.1', // Use IPv4 explicitly to avoid IPv6 issues
    port: config.port, // May be undefined - will use portResolver
    portResolver: config.portResolver,
    timeout: config.timeout ?? 10000,
    // Must exceed the Rust bridge's 20s wake-and-retry worst case (audit H21).
    requestTimeout: config.requestTimeout ?? 25000,
    autoReconnect: config.autoReconnect ?? true,
    maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
    reconnectDelay: config.reconnectDelay ?? 1000,
    maxReconnectDelay: config.maxReconnectDelay ?? 30000,
    logger: config.logger ?? nullLogger,
    maxRequestsPerSecond: config.maxRequestsPerSecond ?? 100,
    queueWhileDisconnected: config.queueWhileDisconnected ?? false,
    maxQueueSize: Math.max(1, config.maxQueueSize ?? 100),
    clientIdentity: config.clientIdentity ?? null,
    authTokenResolver: config.authTokenResolver,
    clientTokenResolver: config.clientTokenResolver,
  };
}
