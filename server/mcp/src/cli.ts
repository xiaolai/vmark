#!/usr/bin/env node
/**
 * VMark MCP Server CLI - Sidecar entry point.
 *
 * This is the entry point for the bundled sidecar binary.
 * It starts the MCP server and connects to VMark via WebSocket.
 *
 * Port Discovery:
 * - VMark writes its bridge port to the app data directory (mcp-port file)
 * - This sidecar reads the port from that file automatically
 * - No user configuration needed!
 *
 * Usage:
 *   vmark-mcp-server              # Auto-discovers port from app data directory
 *   vmark-mcp-server --port 9223  # Manual port override (legacy)
 *   vmark-mcp-server --version    # Print version and exit
 *   vmark-mcp-server --health-check # Run self-test and exit
 */

/**
 * Package version — a hand-maintained literal, NOT injected. `pnpm build` is
 * plain `tsc` and `build:sidecar` only bundles its output; what keeps this in
 * lockstep with the app is the five-file `sed` in the bump procedure
 * (`.claude/rules/40-version-bump.md`). Edit it only through that procedure.
 */
const VERSION = '0.9.67';

/**
 * WHY `process.exitCode` AND NOT `process.exit()` ON THESE PATHS.
 *
 * `process.stdout` is ASYNCHRONOUS when it is a pipe (Node's own docs say so),
 * and `process.exit()` terminates without flushing pending writes. Every caller
 * of `--version` and `--health-check` reads them through a pipe — the app's
 * `useMcpHealthCheck.ts` spawns the binary and JSON.parses its stdout — so a
 * truncated report is a parse failure the user sees as "the sidecar is broken"
 * (audit R3 #195). Setting the code and returning lets the loop drain and the
 * write complete; nothing on either path holds a handle open, and
 * `__tests__/unit/cli.test.ts` asserts both terminate with the full payload.
 */
const WANTS_VERSION = process.argv.includes('--version') || process.argv.includes('-v');
const WANTS_HEALTH_CHECK = process.argv.includes('--health-check');

if (WANTS_VERSION) {
  console.log(VERSION);
  process.exitCode = 0;
} else if (WANTS_HEALTH_CHECK) {
  void runHealthCheck(VERSION);
}

import { createVMarkMcpServer } from './index.js';
import { runHealthCheck } from './utils/healthCheck.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { WebSocketBridge } from './bridge/websocket.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { detectClientIdentity, readClientToken } from './utils/clientIdentity.js';
import { createToolHandler } from './utils/mcpAdapters.js';
import { readPortFromFile, createAuthTokenResolver, parsePort } from './utils/portFile.js';
import { createShutdownHandler, registerShutdownTriggers } from './utils/shutdown.js';

/**
 * Parse command line arguments.
 *
 * Returns only the explicit --port override (undefined otherwise). Port-file
 * discovery is deliberately NOT folded in here: the bridge re-reads the port
 * file on every connection attempt via its portResolver, so a VMark restart
 * (new OS-assigned port + new auth token) is picked up automatically. A
 * port-file value passed as static config would shadow that resolver forever.
 *
 * FAILS FAST on a bad `--port`: a missing, unparseable or conflicting value
 * used to be dropped silently, and the bridge then fell back to port-file
 * DISCOVERY — connecting to whichever instance published the port file, i.e.
 * the one the override was steering away from (audit R2 #198).
 */
function parseArgs(argv: string[] = process.argv.slice(2)): { port: number | undefined } {
  let cliPort: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--port') continue;
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) {
      throw new UsageError('--port requires a value (1-65535)');
    }
    // Same strict parser as the port-file reader: full-string digits,
    // 1-65535. "4123junk" is rejected, not truncated to 4123.
    const parsed = parsePort(raw);
    if (parsed === undefined) {
      throw new UsageError(`--port ${JSON.stringify(raw)} is not a port number (1-65535)`);
    }
    if (cliPort !== undefined && cliPort !== parsed) {
      throw new UsageError(`--port given twice with different values (${cliPort} and ${parsed})`);
    }
    cliPort = parsed;
    i++;
  }

  return { port: cliPort };
}

/** A bad invocation, not a runtime failure: the caller exits 64. */
class UsageError extends Error {}

/**
 * Create a quiet logger for the bridge (only errors go to stderr).
 * Info/debug messages are suppressed to avoid confusing Claude Code
 * which prefixes all stderr with "[MCP Server Error]".
 */
const logger = {
  debug: () => {},
  info: () => {},
  warn: (message: string, ...args: unknown[]) => {
    console.error('[VMark MCP] WARN:', message, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error('[VMark MCP] ERROR:', message, ...args);
  },
};

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  let port: number | undefined;
  try {
    ({ port } = parseArgs());
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`[VMark MCP] ${error.message}`);
    process.exit(64);
  }
  const clientIdentity = detectClientIdentity();

  // Create WebSocket bridge to connect to VMark.
  // Port and auth token are re-resolved from the port file on each connection
  // attempt; `port` is only set by an explicit --port override.
  const bridge = new WebSocketBridge({
    port, // Static override from --port only — undefined means resolver discovery
    portResolver: readPortFromFile, // Re-read port file on each connection attempt
    authTokenResolver: createAuthTokenResolver(port, logger.warn), // Auth token from port file
    // The credential VMark issued to THIS AI client, from the `env` block
    // Install wrote into its MCP config. Absent on installs that predate the
    // mechanism — the bridge then connects us unidentified rather than
    // refusing, and only delegated actions are affected.
    clientTokenResolver: () => readClientToken(process.env),
    autoReconnect: true,
    maxReconnectAttempts: 30, // Reasonable limit to avoid infinite reconnection storms
    reconnectDelay: 2000, // Start with 2 second delay
    maxReconnectDelay: 60000, // Max 1 minute between attempts
    logger,
    clientIdentity,
  });

  // Handle graceful shutdown — signals AND stdio transport closure. stdin
  // EOF/close means the parent AI client exited; an orphaned sidecar must
  // exit instead of running forever on reconnect timers. Registered BEFORE
  // any await so an EOF arriving during the startup window (bridge connect,
  // MCP transport setup) cannot be missed; registerShutdownTriggers also handles
  // stdin that already ended. Double-invocation safe via createShutdownHandler.
  const shutdown = createShutdownHandler(
    () => bridge.disconnect(),
    (code) => process.exit(code),
  );
  registerShutdownTriggers(process, shutdown);

  // Create the VMark MCP server with all tools
  const vmarkServer = createVMarkMcpServer(bridge, { version: VERSION });
  const allTools = vmarkServer.listTools();

  // High-level MCP server. Metadata version is the real sidecar VERSION —
  // clients previously saw a stale hardcoded '0.1.0'.
  // `tools` only. Declaring `resources: {}` advertised resources/list and
  // resources/read on a server that registers none (audit 20260728 §4).
  // `instructions` is the initialize-time primer (WI-NB2.1) — the operational
  // core loop the model reads before any tool call; pinned by
  // instructions.test.ts and end-to-end by sdkBoundary.test.ts.
  const mcpServer = new McpServer(
    {
      name: 'vmark-mcp-server',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Register all tools. Schemas are authored in Zod (src/types.ts ToolShape) and
  // handed to the SDK unchanged — it derives the client-visible JSON Schema, so
  // every constraint a tool declares reaches the client.
  for (const tool of allTools) {
    mcpServer.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: tool.annotations,
      },
      createToolHandler(tool.name, (name, args) => vmarkServer.callTool(name, args))
    );
  }

  // Serve stdio FIRST, then dial VMark concurrently. Awaiting
  // `bridge.connect()` here made MCP initialization wait out the bridge's full
  // connect timeout whenever VMark was not listening (a stale port file, an
  // app that had quit) — and a client that times out on `initialize` drops the
  // server, so an unreachable editor took the whole tool surface with it
  // (audit R2 #200). autoReconnect owns the retry, and `sendBridgeRequest`
  // reports a disconnected bridge on its own.
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  void bridge.connect().catch(() => {
    // Logged by the bridge; autoReconnect owns the retry.
  });
}

// Catch unhandled async rejections (e.g., reconnection timers, MCP transport) (#279)
process.on('unhandledRejection', (reason) => {
  console.error('[VMark MCP] Unhandled rejection:', reason);
  // Don't exit — let reconnection recover if possible
});

// Catch uncaught synchronous exceptions
process.on('uncaughtException', (error) => {
  console.error('[VMark MCP] Uncaught exception:', error);
  process.exit(1);
});

// The server runs only when neither one-shot mode was asked for. Both of those
// now set `process.exitCode` and return rather than calling `process.exit()`
// (see the note beside them), so this guard — not an immediate exit — is what
// keeps main() from starting underneath them.
if (!WANTS_VERSION && !WANTS_HEALTH_CHECK) {
  main().catch((error) => {
    console.error('[VMark MCP Server] Fatal error:', error);
    process.exit(1);
  });
}
