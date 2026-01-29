#!/usr/bin/env node
/**
 * VMark MCP Server CLI - Sidecar entry point.
 *
 * This is the entry point for the bundled sidecar binary.
 * It starts the MCP server and connects to VMark via WebSocket.
 *
 * Port Discovery:
 * - VMark writes its bridge port to ~/.vmark/mcp-port
 * - This sidecar reads the port from that file automatically
 * - No user configuration needed!
 *
 * Usage:
 *   vmark-mcp-server              # Auto-discovers port from ~/.vmark/mcp-port
 *   vmark-mcp-server --port 9223  # Manual port override (legacy)
 *   vmark-mcp-server --version    # Print version and exit
 *   vmark-mcp-server --health-check # Run self-test and exit
 */

// Package version (injected at build time or read from package.json)
const VERSION = '0.3.14';

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
}

async function runHealthCheck(): Promise<void> {
  try {
    // 1. Can we import the server module?
    const { createVMarkMcpServer } = await import('./index.js');

    // 2. Create a mock bridge that doesn't connect
    const mockBridge = {
      request: async () => {
        throw new Error('Health check mode - no VMark connection');
      },
      isConnected: () => false,
      on: () => {},
      off: () => {},
    };

    // 3. Can we instantiate the server and list tools?
    const server = createVMarkMcpServer(mockBridge as any);
    const tools = server.listTools();
    const resources = server.listResources();

    // 4. Validate we have expected tools
    if (tools.length === 0) {
      throw new Error('No tools registered');
    }

    // 5. Validate tool schemas are valid
    for (const tool of tools) {
      if (!tool.name || !tool.inputSchema) {
        throw new Error(`Invalid tool definition: ${tool.name}`);
      }
    }

    // Success - output structured result
    const result = {
      status: 'ok',
      version: VERSION,
      toolCount: tools.length,
      resourceCount: resources.length,
      tools: tools.map((t) => t.name),
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

import { createVMarkMcpServer } from './index.js';
import { WebSocketBridge, ClientIdentity } from './bridge/websocket.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z, ZodTypeAny } from 'zod';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Get the path to the port file (~/.vmark/mcp-port).
 */
function getPortFilePath(): string {
  return join(homedir(), '.vmark', 'mcp-port');
}

/**
 * Read port from the port file written by VMark.
 * Returns undefined if file doesn't exist or is invalid.
 */
function readPortFromFile(): number | undefined {
  const portFilePath = getPortFilePath();

  if (!existsSync(portFilePath)) {
    return undefined;
  }

  try {
    const content = readFileSync(portFilePath, 'utf8').trim();
    const port = parseInt(content, 10);

    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  } catch {
    // File read error - return undefined
  }

  return undefined;
}

/**
 * Parse command line arguments.
 * Port resolution order:
 * 1. --port CLI argument (manual override)
 * 2. Port file (~/.vmark/mcp-port) - auto-discovery
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
 * Get parent process name (cross-platform).
 */
function getParentProcessName(): string | undefined {
  try {
    const ppid = process.ppid;
    if (!ppid) return undefined;

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const result = execSync(`ps -p ${ppid} -o comm=`, { encoding: 'utf8' }).trim();
      return result || undefined;
    } else if (process.platform === 'win32') {
      const result = execSync(
        `wmic process where ProcessId=${ppid} get Name /format:value`,
        { encoding: 'utf8' }
      );
      const match = result.match(/Name=(.+)/);
      return match ? match[1].trim() : undefined;
    }
  } catch {
    // Ignore errors - parent process detection is best-effort
  }
  return undefined;
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
 * Convert VMark content items to MCP SDK content format.
 */
function toMcpContent(items: Array<{ type: string; text?: string }>): Array<{ type: 'text'; text: string }> {
  return items
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => ({ type: 'text' as const, text: item.text! }));
}

/**
 * Convert VMark resource contents to MCP SDK format.
 */
function toMcpContents(items: Array<{ uri: string; text?: string; mimeType?: string }>): Array<{ uri: string; text: string; mimeType?: string }> {
  return items
    .filter((item) => typeof item.text === 'string')
    .map((item) => ({
      uri: item.uri,
      text: item.text!,
      mimeType: item.mimeType,
    }));
}

/**
 * JSON Schema property definition.
 */
interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
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
 */
function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): ZodTypeAny {
  let schema: ZodTypeAny;

  // Handle enum first (takes precedence)
  if (prop.enum && prop.enum.length > 0) {
    schema = z.enum(prop.enum as [string, ...string[]]);
  } else {
    // Handle by type
    switch (prop.type) {
      case 'string':
        schema = z.string();
        break;
      case 'number':
      case 'integer':
        schema = z.number();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        schema = z.array(z.unknown());
        break;
      case 'object':
        schema = z.record(z.unknown());
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
    autoReconnect: true,
    maxReconnectAttempts: 30, // Reasonable limit to avoid infinite reconnection storms
    reconnectDelay: 2000, // Start with 2 second delay
    maxReconnectDelay: 60000, // Max 1 minute between attempts
    logger,
    clientIdentity,
  });

  // Create the VMark MCP server with all tools
  const vmarkServer = createVMarkMcpServer(bridge);

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

  // Register all tools from the VMark server
  for (const tool of vmarkServer.listTools()) {
    // Convert JSON Schema to Zod schema for proper parameter exposure
    const zodSchema = jsonSchemaToZod(tool.inputSchema as JsonSchemaInput);

    mcpServer.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: zodSchema,
      },
      async (args) => {
        const result = await vmarkServer.callTool(tool.name, args);
        return {
          content: toMcpContent(result.content),
          isError: result.isError,
        };
      }
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
      async () => {
        const result = await vmarkServer.readResource(resource.uri);
        return {
          contents: toMcpContents(result.contents),
        };
      }
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

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await bridge.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await bridge.disconnect();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[VMark MCP Server] Fatal error:', error);
  process.exit(1);
});
