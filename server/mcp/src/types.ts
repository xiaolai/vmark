/**
 * MCP Server types for the sidecar's tool surface.
 *
 * Tools only: the pruned surface exposes no MCP resources (`session.get_state`
 * replaced them), so `ResourceDefinition` / `ResourceHandler` /
 * `ResourceReadResult` and the `resources/*` half of `McpServerInterface` were
 * deleted with the pipeline that used them (audit 20260728 §4). The
 * `type: 'resource'` member of a tool result's `content` array below is a
 * DIFFERENT spec feature — an embedded resource block inside a tool response —
 * and is unaffected.
 */

import type { ZodTypeAny } from 'zod';

/**
 * A tool's parameter (or response) shape, authored in Zod.
 *
 * Zod is the source of truth: the SDK consumes this shape directly and derives
 * the client-visible JSON Schema from it. Authoring JSON Schema by hand and
 * converting it to Zod — the previous pipeline — silently dropped every
 * keyword the in-house converter did not model (`minimum`, `maximum`,
 * `pattern`, `format`, `minLength`, `anyOf`, `allOf`, `const`, `$ref`).
 */
export type ToolShape = Record<string, ZodTypeAny>;

/**
 * Behavioural hints a client can show or gate on (MCP `annotations`).
 *
 * All five are HINTS, not guarantees — the spec is explicit that clients must
 * not make trust decisions on annotations from an untrusted server.
 *
 * NOTE ON COMPOSITE TOOLS: VMark exposes seven tools that each multiplex many
 * actions behind an `action` enum. A single tool cannot be both
 * `readOnlyHint: true` (for `document.read`) and `destructiveHint: true` (for
 * `document.write`). Every tool here therefore declares the SAFEST accurate
 * value — the most dangerous behaviour any of its actions can reach. A tool
 * that can mutate never claims to be read-only.
 */
export interface ToolAnnotations {
  /** True only if NO action of the tool modifies anything. */
  readOnlyHint?: boolean;
  /** May destroy or irreversibly overwrite state. Meaningful only when not read-only. */
  destructiveHint?: boolean;
  /** Repeating the same call has no additional effect. Meaningful only when not read-only. */
  idempotentHint?: boolean;
  /** Interacts with an unbounded external domain (the web, arbitrary local paths). */
  openWorldHint?: boolean;
}

/**
 * Tool definition as exposed by MCP server.
 */
export interface ToolDefinition {
  name: string;
  /** Human-readable display name for clients that render a tool picker. */
  title?: string;
  description: string;
  /** Parameter shape, authored in Zod. */
  inputSchema: ToolShape;
  /**
   * Response shape, authored in Zod. Declaring it obliges EVERY non-error
   * result of the tool to carry conforming `structuredContent` — the SDK
   * turns a missing or non-conforming payload into an error.
   */
  outputSchema?: ToolShape;
  annotations?: ToolAnnotations;
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
  /**
   * Machine-readable payload for tools that declare an `outputSchema`. The
   * serialized JSON text block above is still emitted alongside it, per the
   * spec's back-compat guidance for clients that predate structured content.
   */
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Handler function for a tool.
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolCallResult>;

/**
 * MCP server interface - implemented by VMarkMcpServer.
 */
export interface McpServerInterface {
  tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }>;
  listTools(): ToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}
