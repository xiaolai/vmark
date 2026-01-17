#!/usr/bin/env node
/**
 * VMark MCP Server CLI - Sidecar entry point.
 *
 * This is the entry point for the bundled sidecar binary.
 * It starts the MCP server and connects to VMark via WebSocket.
 *
 * Usage:
 *   vmark-mcp-server --port 9224
 */

import { createVMarkMcpServer } from './index.js';
import { WebSocketBridge } from './bridge/websocket.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * Parse command line arguments.
 */
function parseArgs(): { port: number } {
  const args = process.argv.slice(2);
  let port = 9224; // Default port

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const parsed = parseInt(args[i + 1], 10);
      if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
        port = parsed;
      }
      i++;
    }
  }

  return { port };
}

/**
 * Create a console logger for the bridge.
 */
const logger = {
  debug: (message: string, ...args: unknown[]) => {
    console.error('[DEBUG]', message, ...args);
  },
  info: (message: string, ...args: unknown[]) => {
    console.error('[INFO]', message, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.error('[WARN]', message, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error('[ERROR]', message, ...args);
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
 * Main entry point.
 */
async function main(): Promise<void> {
  const { port } = parseArgs();

  console.error(`[VMark MCP Server] Starting on port ${port}...`);

  // Create WebSocket bridge to connect to VMark
  const bridge = new WebSocketBridge({
    port,
    autoReconnect: true,
    maxReconnectAttempts: Infinity, // Keep trying to reconnect
    logger,
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
    // Each tool has its own inputSchema defined in the tool definition
    // We use a passthrough schema that accepts any object
    mcpServer.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.object({}).passthrough(),
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

  // Connect to VMark first
  try {
    await bridge.connect();
    console.error('[VMark MCP Server] Connected to VMark');
  } catch {
    console.error('[VMark MCP Server] Initial connection failed, will retry in background');
  }

  // Start the MCP server with stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error('[VMark MCP Server] MCP server started');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.error('[VMark MCP Server] Shutting down...');
    await bridge.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('[VMark MCP Server] Shutting down...');
    await bridge.disconnect();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[VMark MCP Server] Fatal error:', error);
  process.exit(1);
});
