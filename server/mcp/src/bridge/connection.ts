/**
 * Socket lifecycle for one connection attempt: dispose, wait, open.
 *
 * Everything here is attempt-local by construction — the caller's CURRENT
 * socket is reached only through the hooks, never captured. That is the
 * invariant that keeps a stale timer from killing a newer connection.
 */

import WebSocket from 'ws';
import type { AuthHandshake } from './authHandshake.js';
import type { Logger, ResolvedBridgeConfig } from './websocketConfig.js';

/**
 * Resolve the port to connect to.
 * Uses static port if set, otherwise calls portResolver.
 */
function resolvePort(config: ResolvedBridgeConfig): number | undefined {
  if (config.port !== undefined) {
    return config.port;
  }
  if (config.portResolver) {
    const resolved = config.portResolver();
    if (resolved !== undefined) {
      config.logger.debug(`Port resolved from file: ${resolved}`);
    }
    return resolved;
  }
  return undefined;
}

/**
 * Get the WebSocket URL to dial, or undefined while the port is still unknown.
 *
 * Called on EVERY attempt: a static port always wins, but a resolver is
 * re-consulted so a VMark restart (new port in the port file) is picked up by
 * the retry instead of being shadowed forever.
 */
export function resolveEndpoint(config: ResolvedBridgeConfig): string | undefined {
  const port = resolvePort(config);
  return port === undefined ? undefined : `ws://${config.host}:${port}`;
}

/**
 * Detach and dispose a WebSocket instance (idempotent).
 *
 * Listeners are removed FIRST so a socket still mid-handshake cannot fire a
 * stale 'open'/'close' into the bridge after `this.ws` is nulled. The
 * no-op 'error' listener is required because ws aborts a CONNECTING
 * handshake by emitting 'error', and an unhandled 'error' event would
 * crash the process. CONNECTING sockets are closed too — not just OPEN
 * ones. Single implementation shared by connect()'s pre-cleanup,
 * disconnect(), and handleDisconnect() so the paths cannot drift.
 */
export function disposeSocket(socket: WebSocket | null): void {
  if (!socket) {
    return;
  }
  socket.removeAllListeners();
  socket.on('error', () => {});
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

/**
 * Wait for an already in-flight connection attempt, with a timeout.
 *
 * Polls the bridge's own flags rather than sharing the attempt's promise: the
 * attempt may have been started by the reconnect loop, which owns its result.
 *
 * @param maxWait Derived from the configured connection timeout.
 */
export function waitForExistingAttempt(
  isConnected: () => boolean,
  isConnecting: () => boolean,
  maxWait: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const checkConnection = () => {
      if (isConnected()) {
        resolve();
      } else if (!isConnecting()) {
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

/**
 * Everything `openConnection` needs from the bridge. Deliberately narrow: the
 * attempt never touches bridge state directly.
 */
interface ConnectionAttemptHooks {
  /** Dispose the previous socket, before a new one is created. */
  beforeConnect: () => void;
  /** Publish the attempt-local socket as the bridge's current socket. */
  adopt: (socket: WebSocket) => void;
  /** True once `socket` is no longer the bridge's current socket. */
  isSuperseded: (socket: WebSocket) => boolean;
  /** The bridge's `connected` flag (NOT `isConnected()` — readyState is irrelevant here). */
  isConnected: () => boolean;
  /** Set the bridge's `connecting` flag. */
  setConnecting: (connecting: boolean) => void;
  /** Handshake complete: mark connected, identify, notify, drain the queue. */
  onAuthenticated: () => void;
  onMessage: (data: WebSocket.RawData) => void;
  onClose: () => void;
}

export interface ConnectionAttemptOptions {
  url: string;
  /** Connection AND auth-handshake timeout. */
  timeout: number;
  logger: Logger;
  auth: AuthHandshake;
  /** Called at 'open' — not at attempt start — so the newest token is used. */
  authTokenResolver: (() => string | undefined) | undefined;
  /**
   * The per-client credential VMark issued to this AI client, resolved at
   * 'open' for the same reason. Optional: absent means "connect unidentified",
   * never "fail".
   */
  clientTokenResolver: (() => string | undefined) | undefined;
  hooks: ConnectionAttemptHooks;
}

/**
 * Open one connection attempt and settle when it is usable (or has failed).
 *
 * Resolves after the auth handshake completes, or immediately at 'open' when
 * no auth token is available (legacy mode).
 */
export function openConnection(options: ConnectionAttemptOptions): Promise<void> {
  const { url, timeout, logger, auth, authTokenResolver, clientTokenResolver, hooks } = options;

  return new Promise((resolve, reject) => {
    try {
      // Clean up any previous WebSocket instance to prevent memory leaks
      // and duplicate message handling on reconnection
      hooks.beforeConnect();

      // Attempt-local handle: every callback of THIS attempt must act on
      // `socket`, never the bridge's current socket, which may already belong
      // to a newer attempt by the time a timer fires.
      const socket = new WebSocket(url);
      hooks.adopt(socket);

      const connectionTimeout = setTimeout(() => {
        if (hooks.isSuperseded(socket)) {
          // This attempt was superseded (disconnect() or a newer connect())
          // and its socket was already cleaned up. Never touch the CURRENT
          // socket — a stale timer must not kill a newer connection. Still
          // settle this attempt's promise (no-op if already settled).
          reject(new Error(`Connection attempt superseded (${url})`));
          return;
        }
        if (!hooks.isConnected()) {
          // Close the attempt-local socket; its still-attached 'close'
          // listener drives handleDisconnect → reconnect scheduling.
          socket.close();
          hooks.setConnecting(false);
          // Let the caller (scheduleReconnect's catch block) handle reconnection
          reject(new Error(`Connection timeout to ${url}`));
        }
      }, timeout);

      socket.on('open', () => {
        clearTimeout(connectionTimeout);

        // Send auth token if available (required by VMark bridge)
        const authToken = authTokenResolver?.();
        if (!authToken) {
          // No auth token — connect immediately (legacy mode)
          hooks.onAuthenticated();
          resolve();
          return;
        }

        // Two credentials, two jobs: `token` is the shared bridge token and
        // decides whether we connect at all; `client_token` is the credential
        // VMark issued to this AI client and decides which principal the
        // connection authorizes as. Omitted entirely when we hold none, which
        // is the pre-upgrade state and connects unidentified.
        const clientToken = clientTokenResolver?.();
        const authMsg = {
          id: 'auth',
          type: 'auth',
          payload: clientToken
            ? { token: authToken, client_token: clientToken }
            : { token: authToken },
        };
        try {
          socket.send(JSON.stringify(authMsg));
        } catch (error) {
          logger.warn('Failed to send auth message:', error);
          hooks.setConnecting(false);
          reject(new Error('Failed to send auth message'));
          return;
        }

        auth.arm(timeout, {
          // Attempt-local socket, not the bridge's — see connectionTimeout.
          onTimeout: () => socket.close(),
          onSuccess: () => {
            hooks.onAuthenticated();
            resolve();
          },
          onFailure: (reason) => {
            hooks.setConnecting(false);
            reject(new Error(`Auth failed: ${reason}`));
          },
        });
      });

      socket.on('message', (data: WebSocket.RawData) => {
        hooks.onMessage(data);
      });

      socket.on('close', () => {
        hooks.onClose();
      });

      socket.on('error', (error: Error) => {
        clearTimeout(connectionTimeout);
        if (!hooks.isConnected()) {
          hooks.setConnecting(false);
          // Let the caller (scheduleReconnect's catch block) handle reconnection
          reject(new Error(`WebSocket error: ${error.message}`));
        }
        // If already connected, error will trigger close event
      });
    } catch (error) {
      hooks.setConnecting(false);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
