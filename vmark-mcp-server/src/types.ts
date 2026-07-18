/**
 * MCP Server types for tools and resources.
 */

/**
 * Tool definition as exposed by MCP server.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Resource definition as exposed by MCP server.
 */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

/**
 * Tool call result.
 */
export interface ToolCallResult {
  success: boolean;
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    /**
     * Embedded resource payload for `type: 'resource'` items (MCP spec):
     * exactly one of `text` (textual contents) or `blob` (base64 binary).
     */
    resource?: {
      uri: string;
      text?: string;
      blob?: string;
      mimeType?: string;
    };
  }>;
  isError?: boolean;
}

/**
 * Resource read result.
 */
export interface ResourceReadResult {
  contents: Array<{
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  }>;
}

/**
 * Handler function for a tool.
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolCallResult>;

/**
 * Handler function for a resource.
 */
export type ResourceHandler = (uri: string) => Promise<ResourceReadResult>;

/**
 * MCP server interface - implemented by VMarkMcpServer.
 */
export interface McpServerInterface {
  tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }>;
  resources: Map<string, { definition: ResourceDefinition; handler: ResourceHandler }>;
  listTools(): ToolDefinition[];
  listResources(): ResourceDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  readResource(uri: string): Promise<ResourceReadResult>;
}
