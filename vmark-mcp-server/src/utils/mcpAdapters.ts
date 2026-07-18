/**
 * MCP adapter utilities.
 *
 * Purpose: Convert between VMark server types and MCP SDK types,
 * with proper error wrapping per project conventions.
 *
 * @coordinates-with cli.ts (consumer of these adapters)
 */

/**
 * Content item from VMark server tool results.
 * Mirrors ToolCallResult['content'][number] in src/types.ts — keep in sync.
 */
interface VMarkContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri?: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

/**
 * Resource content item from VMark server resource results.
 * Mirrors ResourceReadResult['contents'][number] in src/types.ts — keep in sync.
 */
interface VMarkResourceItem {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}

/**
 * MCP SDK text content format.
 */
interface McpTextContent {
  type: 'text';
  text: string;
}

/**
 * MCP SDK image content format (base64 payload, e.g. browser.screenshot).
 */
interface McpImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/**
 * MCP SDK embedded resource content format (MCP spec: text OR base64 blob).
 */
interface McpEmbeddedResource {
  type: 'resource';
  resource:
    | { uri: string; text: string; mimeType?: string }
    | { uri: string; blob: string; mimeType?: string };
}

/**
 * Union of MCP SDK content blocks the sidecar forwards.
 */
type McpContentItem = McpTextContent | McpImageContent | McpEmbeddedResource;

/**
 * MCP SDK resource content format (text or base64 blob variant).
 * Index signature required for compatibility with MCP SDK's ReadResourceCallback.
 */
type McpResourceContent =
  | { [key: string]: unknown; uri: string; text: string; mimeType?: string }
  | { [key: string]: unknown; uri: string; blob: string; mimeType?: string };

/**
 * MCP SDK tool call result.
 * Index signature required for compatibility with MCP SDK's CallToolCallback.
 */
interface McpToolResult {
  [key: string]: unknown;
  content: McpContentItem[];
  isError?: boolean;
}

/**
 * MCP SDK resource read result.
 * Index signature required for compatibility with MCP SDK's ReadResourceCallback.
 */
interface McpResourceResult {
  [key: string]: unknown;
  contents: McpResourceContent[];
}

/**
 * Tool call function signature (matches VMarkMcpServer.callTool).
 */
type CallToolFn = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ content: VMarkContentItem[]; isError?: boolean }>;

/**
 * Resource read function signature (matches VMarkMcpServer.readResource).
 */
type ReadResourceFn = (
  uri: string
) => Promise<{ contents: VMarkResourceItem[] }>;

/**
 * Convert VMark content items to MCP SDK content format.
 * Passes through text, image, and embedded resource blocks (all supported
 * natively by the MCP SDK); drops malformed items and unknown types.
 */
export function toMcpContent(
  items: VMarkContentItem[]
): McpContentItem[] {
  const result: McpContentItem[] = [];
  for (const item of items) {
    if (item.type === 'text' && typeof item.text === 'string') {
      result.push({ type: 'text', text: item.text });
    } else if (
      item.type === 'image' &&
      typeof item.data === 'string' &&
      typeof item.mimeType === 'string'
    ) {
      result.push({ type: 'image', data: item.data, mimeType: item.mimeType });
    } else if (item.type === 'resource' && item.resource) {
      const { uri, text, blob, mimeType } = item.resource;
      if (typeof uri !== 'string') {
        continue; // Malformed: an embedded resource without a URI
      }
      if (typeof text === 'string') {
        result.push({ type: 'resource', resource: { uri, text, mimeType } });
      } else if (typeof blob === 'string') {
        result.push({ type: 'resource', resource: { uri, blob, mimeType } });
      }
      // Neither text nor blob: malformed, dropped
    }
  }
  return result;
}

/**
 * Convert VMark resource contents to MCP SDK format.
 * Keeps text items and blob items (base64 binary contents per the MCP spec);
 * drops items carrying neither.
 */
export function toMcpContents(
  items: VMarkResourceItem[]
): McpResourceContent[] {
  const result: McpResourceContent[] = [];
  for (const item of items) {
    if (typeof item.text === 'string') {
      result.push({ uri: item.uri, text: item.text, mimeType: item.mimeType });
    } else if (typeof item.blob === 'string') {
      result.push({ uri: item.uri, blob: item.blob, mimeType: item.mimeType });
    }
  }
  return result;
}

/**
 * Create an error-wrapped tool handler callback for MCP SDK registration.
 *
 * Wraps the VMark server's callTool + toMcpContent pipeline in try/catch.
 * On error, returns a proper MCP error response instead of rejecting.
 */
export function createToolHandler(
  toolName: string,
  callTool: CallToolFn
): (args: Record<string, unknown>) => Promise<McpToolResult> {
  return async (args) => {
    try {
      const result = await callTool(toolName, args);
      return {
        content: toMcpContent(result.content),
        isError: result.isError,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}

/**
 * Create an error-wrapped resource handler callback for MCP SDK registration.
 *
 * Wraps the VMark server's readResource + toMcpContents pipeline in try/catch.
 * On error, re-throws with descriptive context.
 */
export function createResourceHandler(
  resourceUri: string,
  readResource: ReadResourceFn
): () => Promise<McpResourceResult> {
  return async () => {
    try {
      const result = await readResource(resourceUri);
      return { contents: toMcpContents(result.contents) };
    } catch (error) {
      throw new Error(
        `Resource read failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  };
}
