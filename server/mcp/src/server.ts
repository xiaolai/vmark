/**
 * VMark MCP Server - Exposes Tiptap editor APIs to AI assistants.
 */

import type { Bridge, BridgeRequest } from './bridge/types.js';
import { checkOutboundRequest } from './bridge/operationSchemas.js';
import type {
  ToolDefinition,
  ToolHandler,
  ToolCallResult,
  McpServerInterface,
} from './types.js';
import { jsonResult } from './utils/toolOutput.js';

/**
 * Tool registration info.
 */
interface ToolRegistration {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * VMark MCP Server configuration.
 */
export interface VMarkMcpServerConfig {
  /** Bridge for communication with VMark app */
  bridge: Bridge;
  /** Server name */
  name?: string;
  /** Server version */
  version?: string;
}

/**
 * VMark MCP Server - Main server class.
 * Implements McpServerInterface for testability.
 *
 * Tools only. The pruned surface exposes no MCP *resources* — `session.get_state`
 * replaced the `vmark://document/*` and `vmark://windows/*` URIs with a single
 * round-trip — so the registry, the `resources/*` handlers, and the capability
 * declaration that advertised them were removed rather than left asserting a
 * capability the server could not honour (audit 20260728 §4).
 */
export class VMarkMcpServer implements McpServerInterface {
  public readonly tools: Map<string, ToolRegistration> = new Map();

  private bridge: Bridge;
  private serverName: string;
  private serverVersion: string;

  constructor(config: VMarkMcpServerConfig) {
    this.bridge = config.bridge;
    this.serverName = config.name ?? 'vmark';
    // Fallback for tests / direct construction only. The shipped path
    // (cli.ts → createVMarkMcpServer) passes the real sidecar VERSION.
    this.serverVersion = config.version ?? '0.1.0';
  }

  /**
   * Get the bridge instance.
   */
  getBridge(): Bridge {
    return this.bridge;
  }

  /**
   * Get server info.
   */
  getServerInfo(): { name: string; version: string } {
    return {
      name: this.serverName,
      version: this.serverVersion,
    };
  }

  /**
   * Register a tool.
   */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * List all registered tools.
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Call a tool by name.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return VMarkMcpServer.errorResult(`Unknown tool: ${name}`);
    }

    // Normalize args to empty object if null/undefined/non-object
    const normalizedArgs =
      args && typeof args === 'object' && !Array.isArray(args) ? args : {};

    try {
      return await tool.handler(normalizedArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return VMarkMcpServer.errorResult(`Tool error: ${message}`);
    }
  }

  /**
   * Helper to send a bridge request with proper typing.
   *
   * A failure may carry structured `data` (the browser approval envelope — R5).
   * It is attached to the thrown error rather than dropped: a refused action is a
   * request for human consent, and discarding the envelope left the AI with an
   * error it could not act on. The message is defensive too — a failure without
   * `error` previously produced `new Error(undefined)`, i.e. an empty message.
   *
   * Every request is checked against its operation schema first (WI-15). That
   * is what makes `operationSchemas.ts` the contract rather than a comment: a
   * payload carrying a field the contract does not declare cannot quietly
   * cross the wire and land in a branch nobody knew was reachable.
   */
  async sendBridgeRequest<T>(request: BridgeRequest): Promise<T> {
    const { error: contractError, warning } = checkOutboundRequest(request);
    if (contractError) throw new Error(contractError);
    if (warning) console.warn(`[VMark MCP] ${warning}`);
    const response = await this.bridge.send<T>(request);
    if (!response.success) {
      const error = new Error(response.error || 'VMark rejected the request') as Error & {
        data?: unknown;
      };
      if (response.data !== undefined) error.data = response.data;
      throw error;
    }
    return (response.data ?? undefined) as T;
  }

  /**
   * Helper to create a successful tool result with text content.
   */
  static successResult(text: string): ToolCallResult {
    return {
      success: true,
      content: [{ type: 'text', text }],
    };
  }

  /**
   * Successful tool result with JSON content, bounded — see `utils/toolOutput`.
   * `recovery` is the instruction shown when the payload exceeds the budget.
   */
  static successJsonResult(data: unknown, recovery?: string): ToolCallResult {
    return jsonResult(data, recovery);
  }

  /**
   * Helper to create an error tool result.
   */
  static errorResult(message: string): ToolCallResult {
    return {
      success: false,
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}
