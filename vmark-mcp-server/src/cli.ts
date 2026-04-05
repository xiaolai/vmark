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

// Package version (injected at build time or read from package.json)
const VERSION = '0.6.32';

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
  try {
    // 1. Can we import the server module?
    const { createVMarkMcpServer } = await import('./index.js');

    // 2. Create a mock bridge that doesn't connect (implements Bridge interface)
    const mockBridge = {
      send: async (): Promise<never> => {
        throw new Error('Health check mode - no VMark connection');
      },
      isConnected: (): boolean => false,
      connect: async (): Promise<void> => {},
      disconnect: async (): Promise<void> => {},
      onConnectionChange: (): (() => void) => () => {},
    };

    // 3. Can we instantiate the server and list tools?
    const server = createVMarkMcpServer(mockBridge);
    const allTools = server.listTools();
    const resources = server.listResources();

    // 4. Validate we have the expected number of tools
    if (allTools.length === 0) {
      throw new Error('No tools registered');
    }
    if (allTools.length !== EXPECTED_TOOL_COUNT) {
      throw new Error(
        `Tool count mismatch: got ${allTools.length}, expected ${EXPECTED_TOOL_COUNT}. ` +
        `Update EXPECTED_TOOL_COUNT in index.ts when adding/removing tools.`
      );
    }

    // 5. Validate tool schemas are valid
    for (const tool of allTools) {
      if (!tool.name || !tool.inputSchema) {
        throw new Error(`Invalid tool definition: ${tool.name}`);
      }
    }

    // Success - output structured result
    const result = {
      status: 'ok',
      version: VERSION,
      toolCount: allTools.length,
      resourceCount: resources.length,
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
import { WebSocketBridge, ClientIdentity } from './bridge/websocket.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z, ZodTypeAny } from 'zod';
import { readFileSync } from 'fs';
import { getParentProcessName } from './utils/parentProcess.js';
import { createToolHandler, createResourceHandler } from './utils/mcpAdapters.js';
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
function getPortFilePath(): string {
  return join(getAppDataDir(), 'mcp-port');
}

/** Cached auth token from the last port file read. */
let _lastAuthToken: string | undefined;

/**
 * Read port from the port file written by VMark.
 * Port file format: `{port}:{token}` (authenticated) or `{port}` (legacy).
 * Returns port number or undefined. Auth token is cached in `_lastAuthToken`.
 */
function readPortFromFile(): number | undefined {
  const portFilePath = getPortFilePath();

  try {
    const content = readFileSync(portFilePath, 'utf8').trim();

    // Parse format: "{port}:{token}" or "{port}" (legacy)
    const colonIndex = content.indexOf(':');
    let portStr: string;

    if (colonIndex > 0) {
      portStr = content.substring(0, colonIndex);
      _lastAuthToken = content.substring(colonIndex + 1);
    } else {
      portStr = content;
      _lastAuthToken = undefined;
    }

    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
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

  return undefined;
}

/** Get the auth token from the last port file read. */
function getAuthToken(): string | undefined {
  return _lastAuthToken;
}

/**
 * Parse command line arguments.
 * Port resolution order:
 * 1. --port CLI argument (manual override)
 * 2. Port file in app data directory (mcp-port) — auto-discovery
 * 3. Default to undefined (will retry reading port file on connect)
 */
function parseArgs(): { port: number | undefined } {
  const args = process.argv.slice(2);
  let cliPort: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const parsed = parseInt(args[i + 1], 10);
      if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
        cliPort = parsed;
      }
      i++;
    }
  }

  // CLI port takes precedence, then port file, then undefined (will retry)
  const port = cliPort ?? readPortFromFile();

  return { port };
}

/**
 * Detect client identity based on environment and parent process.
 */
function detectClientIdentity(): ClientIdentity {
  const pid = process.pid;
  const parentProcess = getParentProcessName();

  // Check for Claude Code (sets CLAUDE_CODE_VERSION or similar env vars)
  if (process.env.CLAUDE_CODE_ENTRYPOINT || parentProcess?.includes('claude')) {
    return {
      name: 'claude-code',
      version: process.env.CLAUDE_CODE_VERSION,
      pid,
      parentProcess,
    };
  }

  // Check for Codex CLI
  if (process.env.CODEX_HOME || parentProcess?.includes('codex')) {
    return {
      name: 'codex-cli',
      version: process.env.CODEX_VERSION,
      pid,
      parentProcess,
    };
  }

  // Check for Cursor
  if (parentProcess?.toLowerCase().includes('cursor')) {
    return {
      name: 'cursor',
      pid,
      parentProcess,
    };
  }

  // Check for Windsurf
  if (parentProcess?.toLowerCase().includes('windsurf')) {
    return {
      name: 'windsurf',
      pid,
      parentProcess,
    };
  }

  // Unknown client - use parent process name if available
  return {
    name: parentProcess || 'unknown',
    pid,
    parentProcess,
  };
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
 * JSON Schema property definition.
 */
interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  // For oneOf (union types)
  oneOf?: JsonSchemaProperty[];
  // For arrays with typed items
  items?: JsonSchemaProperty;
  // For nested objects
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * JSON Schema input schema definition.
 */
interface JsonSchemaInput {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * Convert a JSON Schema property to a Zod schema.
 * Handles: enum, oneOf, nested objects, arrays with typed items, integer vs number.
 */
function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): ZodTypeAny {
  let schema: ZodTypeAny;

  // Handle enum first (takes precedence)
  if (prop.enum && prop.enum.length > 0) {
    schema = z.enum(prop.enum as [string, ...string[]]);
  }
  // Handle oneOf (union type)
  else if (prop.oneOf && prop.oneOf.length > 0) {
    const variants = prop.oneOf.map((variant) => jsonSchemaPropertyToZod(variant as JsonSchemaProperty));
    if (variants.length === 1) {
      schema = variants[0];
    } else {
      schema = z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
    }
  }
  // Handle by type
  else {
    switch (prop.type) {
      case 'string':
        schema = z.string();
        break;
      case 'number':
        schema = z.number();
        break;
      case 'integer':
        schema = z.number().int();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        // Use typed items if available
        if (prop.items) {
          schema = z.array(jsonSchemaPropertyToZod(prop.items as JsonSchemaProperty));
        } else {
          schema = z.array(z.unknown());
        }
        break;
      case 'object':
        // Use nested properties if available
        if (prop.properties) {
          const shape: Record<string, ZodTypeAny> = {};
          const required = new Set(prop.required ?? []);
          for (const [key, subProp] of Object.entries(prop.properties)) {
            let zodProp = jsonSchemaPropertyToZod(subProp);
            if (!required.has(key)) {
              zodProp = zodProp.optional();
            }
            shape[key] = zodProp;
          }
          schema = z.object(shape);
        } else {
          schema = z.record(z.unknown());
        }
        break;
      default:
        schema = z.unknown();
    }
  }

  // Add description if present
  if (prop.description) {
    schema = schema.describe(prop.description);
  }

  return schema;
}

/**
 * Convert a JSON Schema to a Zod object schema.
 * This preserves the schema structure so Claude can understand what parameters are expected.
 */
function jsonSchemaToZod(inputSchema: JsonSchemaInput): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};
  const required = new Set(inputSchema.required ?? []);

  if (inputSchema.properties) {
    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      let zodProp = jsonSchemaPropertyToZod(prop);

      // Make optional if not required
      if (!required.has(key)) {
        zodProp = zodProp.optional();
      }

      shape[key] = zodProp;
    }
  }

  return z.object(shape);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const { port } = parseArgs();
  const clientIdentity = detectClientIdentity();

  // Create WebSocket bridge to connect to VMark
  // Uses port resolver for dynamic port discovery on each connection attempt
  const bridge = new WebSocketBridge({
    port, // May be undefined - will use portResolver
    portResolver: readPortFromFile, // Re-read port file on each connection attempt
    authTokenResolver: getAuthToken, // Auth token parsed from port file alongside port
    autoReconnect: true,
    maxReconnectAttempts: 30, // Reasonable limit to avoid infinite reconnection storms
    reconnectDelay: 2000, // Start with 2 second delay
    maxReconnectDelay: 60000, // Max 1 minute between attempts
    logger,
    clientIdentity,
  });

  // Create the VMark MCP server with all tools
  const vmarkServer = createVMarkMcpServer(bridge);
  const allTools = vmarkServer.listTools();

  // Create high-level MCP server
  const mcpServer = new McpServer(
    {
      name: 'vmark-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Register all tools
  for (const tool of allTools) {
    // Convert JSON Schema to Zod schema for proper parameter exposure
    const zodSchema = jsonSchemaToZod(tool.inputSchema as JsonSchemaInput);

    mcpServer.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: zodSchema,
      },
      createToolHandler(tool.name, (name, args) => vmarkServer.callTool(name, args))
    );
  }

  // Register all resources from the VMark server
  for (const resource of vmarkServer.listResources()) {
    mcpServer.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: resource.mimeType,
      },
      createResourceHandler(resource.uri, (uri) => vmarkServer.readResource(uri))
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

  // Handle graceful shutdown (guard against double-signal)
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await bridge.disconnect();
    } catch {
      // Ignore errors during shutdown
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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
