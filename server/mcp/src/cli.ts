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
const VERSION = '0.9.32';

/**
 * Handle --version flag.
 */
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

/**
 * Handle --health-check flag.
 * Validates that the binary is functional without requiring VMark connection.
 */
if (process.argv.includes('--health-check')) {
  runHealthCheck();
  // runHealthCheck() calls process.exit() so main() below won't run
}

async function runHealthCheck(): Promise<void> {
  // Note: no import self-test here. The server module is statically imported
  // below (hoisted, evaluated before any of this runs), so an import failure
  // crashes the process before runHealthCheck — a dynamic re-import could
  // only ever return the already-cached module and can't catch anything.
  try {
    // 1. Create a mock bridge that doesn't connect (implements Bridge interface)
    const mockBridge = {
      send: async (): Promise<never> => {
        throw new Error('Health check mode - no VMark connection');
      },
      isConnected: (): boolean => false,
      connect: async (): Promise<void> => {},
      disconnect: async (): Promise<void> => {},
      onConnectionChange: (): (() => void) => () => {},
    };

    // 2. Can we instantiate the server and list tools?
    const server = createVMarkMcpServer(mockBridge, { version: VERSION });
    const allTools = server.listTools();

    // 3. Validate we have the expected number of tools
    if (allTools.length === 0) {
      throw new Error('No tools registered');
    }
    if (allTools.length !== EXPECTED_TOOL_COUNT) {
      throw new Error(
        `Tool count mismatch: got ${allTools.length}, expected ${EXPECTED_TOOL_COUNT}. ` +
        `Update EXPECTED_TOOL_COUNT in index.ts when adding/removing tools.`
      );
    }

    // 4. Validate tool schemas are valid
    for (const tool of allTools) {
      if (!tool.name || !tool.inputSchema) {
        throw new Error(`Invalid tool definition: ${tool.name}`);
      }
    }

    // Success - output structured result. `resourceCount` is a constant 0 (the
    // pruned surface exposes no MCP resources); the field stays because the
    // app's health check declares it required and renders it in Settings →
    // Integrations (src/hooks/useMcpHealthCheck.ts).
    const result = {
      status: 'ok',
      version: VERSION,
      toolCount: allTools.length,
      resourceCount: 0,
      tools: allTools.map((t) => t.name),
    };

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    const result = {
      status: 'error',
      version: VERSION,
      error: error instanceof Error ? error.message : String(error),
    };

    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

import { createVMarkMcpServer, EXPECTED_TOOL_COUNT } from './index.js';
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
 */
function parseArgs(): { port: number | undefined } {
  const args = process.argv.slice(2);
  let cliPort: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      // Same strict parser as the port-file reader: full-string digits,
      // 1-65535. "4123junk" is rejected, not truncated to 4123.
      const parsed = parsePort(args[i + 1]);
      if (parsed !== undefined) {
        cliPort = parsed;
      }
      i++;
    }
  }

  return { port: cliPort };
}

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
  const { port } = parseArgs();
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
  const mcpServer = new McpServer(
    {
      name: 'vmark-mcp-server',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
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

  // Connect to VMark first (errors logged by bridge)
  try {
    await bridge.connect();
  } catch {
    // Will retry in background via autoReconnect
  }

  // Start the MCP server with stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
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

// Only run main() if not doing health check (health check exits via process.exit)
if (!process.argv.includes('--health-check')) {
  main().catch((error) => {
    console.error('[VMark MCP Server] Fatal error:', error);
    process.exit(1);
  });
}
