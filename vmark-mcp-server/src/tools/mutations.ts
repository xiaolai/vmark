/**
 * Mutation tools - Declarative document modifications.
 *
 * These tools provide:
 * - batch_edit: Multiple operations in a single transaction
 * - apply_diff: Smart find/replace with match policies
 * - replace_text_anchored: Drift-tolerant replacement using context anchors
 */

import { VMarkMcpServer, resolveWindowId, requireStringArg, getStringArg, getNumberArg } from '../server.js';
import type {
  BatchEditResult,
  ApplyDiffResult,
  BatchOperation,
  BlockQuery,
  OperationMode,
  MatchPolicy,
  TextAnchor,
} from '../bridge/types.js';

/**
 * Register all mutation tools on the server.
 */
export function registerMutationTools(server: VMarkMcpServer): void {
  // batch_edit - Multiple operations in a transaction
  server.registerTool(
    {
      name: 'batch_edit',
      description:
        'Apply multiple edit operations in a single atomic transaction. All operations succeed ' +
        'or all fail together. Supports update, insert, delete, format, and move operations. ' +
        'Requires baseRevision for optimistic concurrency. Use mode="dryRun" to preview changes, ' +
        '"suggest" to create suggestions for user approval, or "apply" for immediate execution.',
      inputSchema: {
        type: 'object',
        properties: {
          baseRevision: {
            type: 'string',
            description:
              'The document revision this edit is based on. Get this from get_document_revision. ' +
              'If the document has changed, the operation will fail with a conflict error.',
          },
          requestId: {
            type: 'string',
            description:
              'Optional idempotency key. If provided, duplicate requests with the same ID ' +
              'will return the cached response instead of re-executing.',
          },
          mode: {
            type: 'string',
            enum: ['apply', 'suggest', 'dryRun'],
            description:
              'Execution mode. "apply" executes immediately, "suggest" creates suggestions ' +
              'for user approval, "dryRun" returns preview without changes. Default: "apply"',
          },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              oneOf: [
                {
                  properties: {
                    type: { const: 'update' },
                    nodeId: { type: 'string', description: 'ID of node to update' },
                    text: { type: 'string', description: 'New text content' },
                    attrs: { type: 'object', description: 'New node attributes' },
                  },
                  required: ['type', 'nodeId'],
                },
                {
                  properties: {
                    type: { const: 'insert' },
                    after: { type: 'string', description: 'ID of node to insert after' },
                    content: {
                      oneOf: [
                        { type: 'string', description: 'Markdown content to insert' },
                        { type: 'object', description: 'AST node to insert' },
                      ],
                    },
                  },
                  required: ['type', 'after', 'content'],
                },
                {
                  properties: {
                    type: { const: 'delete' },
                    nodeId: { type: 'string', description: 'ID of node to delete' },
                  },
                  required: ['type', 'nodeId'],
                },
                {
                  properties: {
                    type: { const: 'format' },
                    nodeId: { type: 'string', description: 'ID of node to format' },
                    marks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string' },
                          attrs: { type: 'object' },
                        },
                        required: ['type'],
                      },
                      description: 'Marks to apply',
                    },
                  },
                  required: ['type', 'nodeId', 'marks'],
                },
                {
                  properties: {
                    type: { const: 'move' },
                    nodeId: { type: 'string', description: 'ID of node to move' },
                    after: { type: 'string', description: 'ID of node to place after' },
                  },
                  required: ['type', 'nodeId', 'after'],
                },
              ],
            },
            description: 'Array of operations to execute',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['baseRevision', 'mode', 'operations'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const requestId = getStringArg(args, 'requestId');
      const mode = (args.mode as OperationMode) ?? 'apply';
      const operations = args.operations as BatchOperation[];

      if (!operations || operations.length === 0) {
        return VMarkMcpServer.errorResult('At least one operation is required');
      }

      if (operations.length > 100) {
        return VMarkMcpServer.errorResult('Maximum 100 operations per batch');
      }

      try {
        const result = await server.sendBridgeRequest<BatchEditResult>({
          type: 'mutation.batchEdit',
          baseRevision,
          requestId,
          mode,
          operations,
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to execute batch edit: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // apply_diff - Smart find/replace
  server.registerTool(
    {
      name: 'apply_diff',
      description:
        'Find and replace text with configurable match handling. Use scopeQuery to limit ' +
        'the search area. matchPolicy controls behavior when multiple matches are found: ' +
        '"first" replaces only the first match, "all" replaces all, "nth" replaces a specific ' +
        'occurrence, "error_if_multiple" returns matches for disambiguation.',
      inputSchema: {
        type: 'object',
        properties: {
          baseRevision: {
            type: 'string',
            description: 'The document revision this edit is based on.',
          },
          scopeQuery: {
            type: 'object',
            properties: {
              type: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
              },
              level: { type: 'number' },
              contains: { type: 'string' },
              hasMarks: { type: 'array', items: { type: 'string' } },
            },
            description: 'Optional query to limit search scope',
          },
          original: {
            type: 'string',
            description: 'The text to find',
          },
          replacement: {
            type: 'string',
            description: 'The text to replace with',
          },
          matchPolicy: {
            type: 'string',
            enum: ['first', 'all', 'nth', 'error_if_multiple'],
            description:
              'How to handle multiple matches. "first": replace first only, ' +
              '"all": replace all occurrences, "nth": replace specific occurrence (requires nth param), ' +
              '"error_if_multiple": return matches for disambiguation',
          },
          nth: {
            type: 'number',
            description: 'Which occurrence to replace (0-indexed). Required if matchPolicy is "nth".',
          },
          mode: {
            type: 'string',
            enum: ['apply', 'suggest', 'dryRun'],
            description: 'Execution mode. Default: "apply"',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['baseRevision', 'original', 'replacement', 'matchPolicy'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const scopeQuery = args.scopeQuery as BlockQuery | undefined;
      const original = requireStringArg(args, 'original');
      const replacement = requireStringArg(args, 'replacement');
      const matchPolicy = args.matchPolicy as MatchPolicy;
      const nth = getNumberArg(args, 'nth');
      const mode = (args.mode as OperationMode) ?? 'apply';

      if (matchPolicy === 'nth' && nth === undefined) {
        return VMarkMcpServer.errorResult('nth parameter is required when matchPolicy is "nth"');
      }

      try {
        const result = await server.sendBridgeRequest<ApplyDiffResult>({
          type: 'mutation.applyDiff',
          baseRevision,
          scopeQuery,
          original,
          replacement,
          matchPolicy,
          nth,
          mode,
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to apply diff: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // replace_text_anchored - Drift-tolerant replacement
  server.registerTool(
    {
      name: 'replace_text_anchored',
      description:
        'Replace text using context anchors for drift tolerance. Useful when the exact position ' +
        'may have shifted due to other edits. The anchor includes before/after context that ' +
        'must match within a similarity threshold for the replacement to proceed.',
      inputSchema: {
        type: 'object',
        properties: {
          baseRevision: {
            type: 'string',
            description: 'The document revision this edit is based on.',
          },
          anchor: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'The exact text to replace',
              },
              beforeContext: {
                type: 'string',
                description: 'Expected text before the target (about 30 chars recommended)',
              },
              afterContext: {
                type: 'string',
                description: 'Expected text after the target (about 30 chars recommended)',
              },
              maxDistance: {
                type: 'number',
                description: 'Maximum character distance the text can drift from expected position',
              },
            },
            required: ['text', 'beforeContext', 'afterContext', 'maxDistance'],
            description: 'Context anchor for drift-tolerant matching',
          },
          replacement: {
            type: 'string',
            description: 'The text to replace with',
          },
          mode: {
            type: 'string',
            enum: ['apply', 'suggest', 'dryRun'],
            description: 'Execution mode. Default: "apply"',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['baseRevision', 'anchor', 'replacement'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const anchor = args.anchor as TextAnchor;
      const replacement = requireStringArg(args, 'replacement');
      const mode = (args.mode as OperationMode) ?? 'apply';

      if (!anchor || !anchor.text || !anchor.beforeContext || !anchor.afterContext) {
        return VMarkMcpServer.errorResult('anchor must include text, beforeContext, and afterContext');
      }

      try {
        const result = await server.sendBridgeRequest<ApplyDiffResult>({
          type: 'mutation.replaceAnchored',
          baseRevision,
          anchor,
          replacement,
          mode,
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to replace text: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
