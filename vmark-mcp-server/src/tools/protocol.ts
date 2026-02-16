/**
 * Protocol tools - AI-Oriented MCP Design foundation.
 *
 * These tools provide:
 * - Capabilities discovery (get_capabilities)
 * - Document revision tracking (get_document_revision)
 */

import { VMarkMcpServer, resolveWindowId } from '../server.js';
import type { Capabilities, RevisionInfo } from '../bridge/types.js';

/**
 * Current protocol version.
 */
const PROTOCOL_VERSION = '1.0.0';

/**
 * Supported node types for AST queries.
 */
const SUPPORTED_NODE_TYPES = [
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'horizontalRule',
  'image',
  'hardBreak',
  'text',
];

/**
 * Supported query operators for block queries.
 */
const SUPPORTED_QUERY_OPERATORS = ['type', 'contains', 'level', 'index', 'hasMarks'];

/**
 * Protocol limits.
 */
const LIMITS = {
  maxBatchSize: 100,
  maxPayloadBytes: 1048576, // 1MB
  maxRequestsPerSecond: 10,
  maxConcurrentRequests: 3,
};

/**
 * Register all protocol tools on the server.
 */
export function registerProtocolTools(server: VMarkMcpServer): void {
  // get_capabilities - Discover server capabilities
  server.registerTool(
    {
      name: 'get_capabilities',
      description:
        'Get the MCP server capabilities, including supported node types, query operators, ' +
        'limits, and features. This is the recommended first call for AI agents to understand ' +
        'what operations are available and their constraints.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    async () => {
      const capabilities: Capabilities = {
        version: PROTOCOL_VERSION,
        supportedNodeTypes: SUPPORTED_NODE_TYPES,
        supportedQueryOperators: SUPPORTED_QUERY_OPERATORS,
        limits: LIMITS,
        features: {
          suggestionModeSupported: true,
          revisionTracking: true,
          idempotency: true,
        },
      };

      return VMarkMcpServer.successResult(JSON.stringify(capabilities, null, 2));
    }
  );

  // get_document_revision - Get current document revision
  server.registerTool(
    {
      name: 'get_document_revision',
      description:
        'Get the current document revision ID. Use this to check if the document has changed ' +
        'since your last operation. The revision ID changes on every document modification. ' +
        'Include this revision as baseRevision in mutation operations for optimistic concurrency.',
      inputSchema: {
        type: 'object',
        properties: {
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);

      try {
        const result = await server.sendBridgeRequest<RevisionInfo>({
          type: 'protocol.getRevision',
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get revision: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
