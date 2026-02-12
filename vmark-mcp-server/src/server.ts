/**
 * VMark MCP Server - Exposes Tiptap editor APIs to AI assistants.
 */

import type { Bridge, BridgeRequest, WindowId } from './bridge/types.js';
import type {
  ToolDefinition,
  ToolHandler,
  ResourceDefinition,
  ResourceHandler,
  ToolCallResult,
  ResourceReadResult,
  McpServerInterface,
} from './types.js';

/**
 * Tool registration info.
 */
interface ToolRegistration {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * Resource registration info.
 */
interface ResourceRegistration {
  definition: ResourceDefinition;
  handler: ResourceHandler;
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
 */
export class VMarkMcpServer implements McpServerInterface {
  public readonly tools: Map<string, ToolRegistration> = new Map();
  public readonly resources: Map<string, ResourceRegistration> = new Map();

  private bridge: Bridge;
  private serverName: string;
  private serverVersion: string;

  constructor(config: VMarkMcpServerConfig) {
    this.bridge = config.bridge;
    this.serverName = config.name ?? 'vmark';
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
   * Register a resource.
   */
  registerResource(definition: ResourceDefinition, handler: ResourceHandler): void {
    this.resources.set(definition.uri, { definition, handler });
  }

  /**
   * List all registered tools.
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * List all registered resources.
   */
  listResources(): ResourceDefinition[] {
    return Array.from(this.resources.values()).map((r) => r.definition);
  }

  /**
   * Call a tool by name.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Normalize args to empty object if null/undefined/non-object
    const normalizedArgs =
      args && typeof args === 'object' && !Array.isArray(args) ? args : {};

    try {
      return await tool.handler(normalizedArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{ type: 'text', text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }

  /**
   * Read a resource by URI.
   */
  async readResource(uri: string): Promise<ResourceReadResult> {
    const resource = this.resources.get(uri);
    if (!resource) {
      throw new Error(`Unknown resource: ${uri}`);
    }

    return await resource.handler(uri);
  }

  /**
   * Helper to send a bridge request with proper typing.
   */
  async sendBridgeRequest<T>(request: BridgeRequest): Promise<T> {
    const response = await this.bridge.send<T>(request);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
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
   * Helper to create a successful tool result with JSON content.
   */
  static successJsonResult(data: unknown): ToolCallResult {
    return {
      success: true,
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
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

  /**
   * Helper to create a resource result.
   */
  static resourceResult(uri: string, text: string, mimeType?: string): ResourceReadResult {
    return {
      contents: [{ uri, text, mimeType }],
    };
  }
}

/**
 * Resolve windowId parameter, defaulting to 'focused'.
 */
export function resolveWindowId(windowId?: string): WindowId {
  return windowId ?? 'focused';
}

/**
 * Validate that a value is a non-negative integer.
 * Returns an error message if invalid, or null if valid.
 */
export function validateNonNegativeInteger(
  value: unknown,
  fieldName: string
): string | null {
  if (typeof value !== 'number') {
    return `${fieldName} must be a number`;
  }
  if (!Number.isFinite(value)) {
    return `${fieldName} must be a finite number`;
  }
  if (!Number.isInteger(value)) {
    return `${fieldName} must be an integer`;
  }
  if (value < 0) {
    return `${fieldName} must be non-negative`;
  }
  return null;
}

// ============ Typed Arg Extractors ============

/**
 * Tool arguments record type.
 */
export type ToolArgs = Record<string, unknown>;

/**
 * Extract a string argument, returning undefined if not present or not a string.
 */
export function getStringArg(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Extract a required string argument.
 * Throws if not present or empty.
 */
export function requireStringArg(args: ToolArgs, key: string): string {
  const value = getStringArg(args, key);
  if (value === undefined || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

/**
 * Extract a required string argument that may be empty.
 * Throws if not present (undefined), but allows empty strings.
 * Use for fields like replacement text where "" is a valid value (deletion).
 */
export function requireStringArgAllowEmpty(args: ToolArgs, key: string): string {
  const value = getStringArg(args, key);
  if (value === undefined) {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

/**
 * Extract a number argument, returning undefined if not present or not a number.
 */
export function getNumberArg(args: ToolArgs, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Extract a required number argument.
 * Throws if not present.
 */
export function requireNumberArg(args: ToolArgs, key: string): number {
  const value = getNumberArg(args, key);
  if (value === undefined) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

/**
 * Extract a boolean argument, returning undefined if not present or not a boolean.
 */
export function getBooleanArg(args: ToolArgs, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Extract windowId argument with 'focused' as default.
 */
export function getWindowIdArg(args: ToolArgs): WindowId {
  return resolveWindowId(getStringArg(args, 'windowId'));
}
