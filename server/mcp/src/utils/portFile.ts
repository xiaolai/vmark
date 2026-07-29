/**
 * Port-file discovery for the VMark MCP sidecar.
 *
 * Purpose: Read the `mcp-port` file VMark writes to its app data directory
 * (format: `{port}:{token}`, or legacy `{port}`), caching the last result so
 * the auth token can be served alongside the port.
 *
 * VMark rewrites the file on every launch with a fresh OS-assigned port and
 * auth token, so callers must re-read it on every connection attempt — one
 * startup read frozen as static config would dial a dead port forever after
 * a VMark restart. The bridge's portResolver / authTokenResolver hooks exist
 * for exactly that.
 *
 * @coordinates-with cli.ts (bridge wiring), bridge/websocket.ts (portResolver / authTokenResolver)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

/**
 * Tauri app identifier for path resolution.
 * Must match the identifier in tauri.conf.json.
 */
const APP_IDENTIFIER = process.env.VMARK_APP_IDENTIFIER || 'app.vmark';

/** Cached home directory to avoid repeated syscalls. */
const HOME_DIR = homedir();

/**
 * Check if an error is ENOENT (file not found).
 */
function isNotFoundError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    err.code === 'ENOENT'
  );
}

/**
 * Get the app data directory path (platform-specific).
 *
 * Uses the same path convention as Tauri's app_data_dir():
 * - macOS: ~/Library/Application Support/<identifier>
 * - Linux: $XDG_DATA_HOME/<identifier> (default: ~/.local/share)
 * - Windows: %APPDATA%/<identifier>
 */
function getAppDataDir(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME || join(HOME_DIR, '.local', 'share');
  const appDataRoaming = process.env.APPDATA || join(HOME_DIR, 'AppData', 'Roaming');

  switch (platform()) {
    case 'darwin':
      return join(HOME_DIR, 'Library', 'Application Support', APP_IDENTIFIER);
    case 'linux':
      return join(xdgDataHome, APP_IDENTIFIER);
    case 'win32':
      return join(appDataRoaming, APP_IDENTIFIER);
    default:
      // Unknown platform — best guess
      return join(HOME_DIR, '.local', 'share', APP_IDENTIFIER);
  }
}

/**
 * Get the path to the port file in the app data directory.
 */
export function getPortFilePath(): string {
  return join(getAppDataDir(), 'mcp-port');
}

/**
 * Strictly parse a TCP port string.
 *
 * The single parser for BOTH the port-file reader below and the `--port`
 * CLI argument (cli.ts): the entire string must be digits (`^\d+$`) and the
 * value must be in 1-65535. A permissive parseInt would accept trailing
 * garbage like "4123junk" and silently dial a half-parsed port.
 */
export function parsePort(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) {
    return undefined;
  }
  const port = parseInt(raw, 10);
  return port >= 1 && port <= 65535 ? port : undefined;
}

/** Result of reading the port file — port and token returned atomically. */
interface PortFileResult {
  port: number;
  token?: string;
}

/** Cached result from the last port file read. */
let _lastPortFileResult: PortFileResult | undefined;

/**
 * Read port and auth token from the port file written by VMark.
 * Port file format: `{port}:{token}` (authenticated) or `{port}` (legacy).
 * Returns the port or undefined. Result is also cached for getAuthToken().
 */
export function readPortFromFile(): number | undefined {
  const portFilePath = getPortFilePath();

  try {
    const content = readFileSync(portFilePath, 'utf8').trim();

    // Parse format: "{port}:{token}" or "{port}" (legacy)
    const colonIndex = content.indexOf(':');
    let portStr: string;
    let token: string | undefined;

    if (colonIndex > 0) {
      portStr = content.substring(0, colonIndex);
      token = content.substring(colonIndex + 1);
    } else {
      portStr = content;
    }

    const port = parsePort(portStr);
    if (port !== undefined) {
      _lastPortFileResult = { port, token };
      return port;
    }
  } catch (err) {
    if (!isNotFoundError(err)) {
      // Real error (permission denied, etc.) - log for debugging
      if (process.env.VMARK_DEBUG) {
        console.error('[VMark MCP] Failed to read port file:', err);
      }
    }
    // ENOENT is expected if VMark hasn't started yet
  }

  _lastPortFileResult = undefined;
  return undefined;
}

/** Get the auth token from the last port file read. */
export function getAuthToken(): string | undefined {
  return _lastPortFileResult?.token;
}

/**
 * Build the auth-token resolver for the WebSocket bridge.
 *
 * Without a static port the resolver serves the token cached by the last
 * readPortFromFile() call — the bridge's portResolver re-reads the file on
 * every connection attempt, keeping that cache fresh.
 *
 * With a static port (explicit --port CLI override) the bridge never
 * consults the port file for discovery, so the resolver re-reads it here to
 * harvest the auth token: the token is used when the file's port matches the
 * requested port; otherwise the connection proceeds tokenless and `warn` is
 * called once (current VMark builds reject unauthenticated connections).
 */
export function createAuthTokenResolver(
  staticPort: number | undefined,
  warn: (message: string) => void = () => {},
): () => string | undefined {
  if (staticPort === undefined) {
    return getAuthToken;
  }

  let warned = false;
  return () => {
    const filePort = readPortFromFile();
    if (filePort === staticPort) {
      return getAuthToken();
    }
    if (!warned) {
      warned = true;
      warn(
        filePort === undefined
          ? `--port ${staticPort}: port file not found — connecting without auth token (VMark may reject the connection)`
          : `--port ${staticPort}: port file reports port ${filePort} — connecting without auth token (VMark may reject the connection)`,
      );
    }
    return undefined;
  };
}
