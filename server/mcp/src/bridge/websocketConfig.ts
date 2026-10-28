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
 * the shared bridge token.
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
  /**
   * The user's name for this session, for grouping its edits in VMark.
   * Untrusted, display and grouping only; validated before it is set (see
   * `utils/sessionLabel.ts`). Omitted, not empty, when there is none.
   */
  sessionLabel?: string;
}

/**
 * Function to resolve port dynamically (e.g., read from file).
 */
type PortResolver = () => number | undefined;

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
   * bridge's worst case of 23s (3s for the write lock + 10s initial wait +
   * 10s wake-and-retry) — a shorter value discards retry results that the
   * bridge successfully recovered, so the AI client sees a timeout even
   * though the write WAS applied. A value of 23000 or less is refused
   * (RangeError).
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
  /** Maximum queue size when disconnected (default: 100; a positive integer, else RangeError) */
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
 * The Rust bridge's worst case for one routed request: 3 s for the write lock
 * (a write that cannot get it is refused WRITE_BUSY, not applied) + 10 s
 * initial wait + 10 s wake-and-retry (wake_retry.rs).
 * A coherence request's run is bounded the same way: past 20 s Rust answers
 * TIMEOUT (for a write, outcome unknown) and the run keeps the write lock until
 * it ends (mcp_bridge/coherence_dispatch.rs).
 * Restates Rust's `WRITE_LOCK_WAIT` + `REQUEST_TIMEOUT_TOTAL`
 * (mcp_bridge/state.rs); `bridgeWorstCaseParity.test.ts` fails when they drift.
 */
export const BRIDGE_WORST_CASE_MS = 23_000;
/** The longest delay `setTimeout` holds; a longer one fires at once. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * The pending-request timeout, refused unless it outlasts the bridge's worst
 * case: a shorter one reports a write the bridge recovered as timed out.
 * @edge-case NaN, Infinity and delays past the timer limit are refused too —
 * `setTimeout` treats them as an immediate timeout — and so is a fraction of
 * a millisecond.
 */
function requestTimeoutOf(value: number | undefined): number {
  const timeout = value ?? 25000;
  if (!Number.isSafeInteger(timeout) || timeout <= BRIDGE_WORST_CASE_MS || timeout > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      `requestTimeout must be a whole number of ms more than ${BRIDGE_WORST_CASE_MS} ms (the bridge's wake-and-retry worst case) and at most ${MAX_TIMER_DELAY_MS} ms, got ${timeout}`
    );
  }
  return timeout;
}

/**
 * The disconnected-queue cap, refused unless it is a positive safe integer.
 * @edge-case NaN makes the cap comparison permanently false (an unbounded
 * queue); fractions, zero and negatives are refused rather than clamped.
 */
function maxQueueSizeOf(value: number | undefined): number {
  const size = value ?? 100;
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError(`maxQueueSize must be a positive integer, got ${size}`);
  }
  return size;
}

/** A timer delay: a whole number of ms, positive and no longer than `setTimeout` holds. */
function delayOf(field: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new RangeError(`${field} must be a whole number of ms, more than 0 and at most ${MAX_TIMER_DELAY_MS}, got ${value}`);
  }
  return value;
}

/** A count: a non-negative safe integer. */
function countOf(field: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer, got ${value}`);
  }
  return value;
}

/** A static port, when one is given: an integer from 1 to 65535. */
function portOf(value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65_535)) {
    throw new RangeError(`port must be an integer from 1 to 65535, got ${value}`);
  }
  return value;
}

/**
 * The rate limit: a non-negative finite rate, 0 meaning unlimited. A fraction
 * is a rate, not a mistake (0.5 admits one request every two seconds), so
 * unlike the delays it need not be a whole number.
 * @edge-case NaN would make the token bucket refuse every request forever.
 */
function rateOf(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`maxRequestsPerSecond must be a finite number of 0 (unlimited) or more, got ${value}`);
  }
  return value;
}

/** The reconnect backoff: its cap may not be shorter than its base. */
function backoffOf(config: WebSocketBridgeConfig): { reconnectDelay: number; maxReconnectDelay: number } {
  const reconnectDelay = delayOf('reconnectDelay', config.reconnectDelay ?? 1000);
  const maxReconnectDelay = delayOf('maxReconnectDelay', config.maxReconnectDelay ?? 30000);
  if (maxReconnectDelay < reconnectDelay) {
    throw new RangeError(`maxReconnectDelay (${maxReconnectDelay}) must not be less than reconnectDelay (${reconnectDelay})`);
  }
  return { reconnectDelay, maxReconnectDelay };
}

/**
 * Apply the documented defaults to a caller-supplied config.
 * @throws RangeError when a numeric option is outside its range: a
 * `requestTimeout` that cannot outlast the bridge's worst case, a
 * `maxQueueSize` that is not a positive integer, a delay a timer cannot hold,
 * a negative or fractional count, a fractional delay, a port outside
 * 1–65535, a non-finite or negative rate, or a backoff cap below its base.
 */
export function resolveBridgeConfig(
  config: WebSocketBridgeConfig = {}
): ResolvedBridgeConfig {
  return {
    host: config.host ?? '127.0.0.1', // Use IPv4 explicitly to avoid IPv6 issues
    port: portOf(config.port), // May be undefined - will use portResolver
    portResolver: config.portResolver,
    timeout: delayOf('timeout', config.timeout ?? 10000),
    requestTimeout: requestTimeoutOf(config.requestTimeout),
    autoReconnect: config.autoReconnect ?? true,
    maxReconnectAttempts: countOf('maxReconnectAttempts', config.maxReconnectAttempts ?? 10),
    ...backoffOf(config),
    logger: config.logger ?? nullLogger,
    maxRequestsPerSecond: rateOf(config.maxRequestsPerSecond ?? 100),
    queueWhileDisconnected: config.queueWhileDisconnected ?? false,
    maxQueueSize: maxQueueSizeOf(config.maxQueueSize),
    clientIdentity: config.clientIdentity ?? null,
    authTokenResolver: config.authTokenResolver,
    clientTokenResolver: config.clientTokenResolver,
  };
}
