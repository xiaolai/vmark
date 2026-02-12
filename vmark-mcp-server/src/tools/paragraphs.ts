/**
 * Paragraph tools - Operations for flat documents without headings.
 *
 * These tools provide:
 * - read_paragraph: Read a paragraph by index or content match
 * - write_paragraph: Modify paragraph content
 */

import { VMarkMcpServer, resolveWindowId, requireStringArg, getStringArg, getBooleanArg } from '../server.js';
import type {
  ParagraphTarget,
  ParagraphInfo,
  ParagraphOperation,
  WriteParagraphResult,
  OperationMode,
  BridgeRequest,
} from '../bridge/types.js';

/**
 * Register all paragraph tools on the server.
 */
export function registerParagraphTools(server: VMarkMcpServer): void {
  // read_paragraph - Read a paragraph by index or content match
  server.registerTool(
    {
      name: 'read_paragraph',
      description:
        'Read a paragraph from the document. Useful for documents without headings. ' +
        'Can target by index (0-indexed) or by text the paragraph contains.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'object',
            properties: {
              index: {
                type: 'number',
                description: '0-indexed paragraph number',
              },
              containing: {
                type: 'string',
                description: 'Text the paragraph contains (partial match)',
              },
            },
            description: 'How to identify the target paragraph',
          },
          includeContext: {
            type: 'boolean',
            description: 'Include surrounding paragraphs for context. Default: false',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['target'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const target = args.target as ParagraphTarget;
      const includeContext = getBooleanArg(args, 'includeContext') ?? false;

      if (!target || (target.index === undefined && !target.containing)) {
        return VMarkMcpServer.errorResult('target must specify index or containing');
      }

      if (target.index !== undefined && target.index < 0) {
        return VMarkMcpServer.errorResult('target.index must be a non-negative number');
      }

      try {
        const request: BridgeRequest = {
          type: 'paragraph.read',
          target,
          includeContext,
          windowId,
        };
        const result = await server.sendBridgeRequest<ParagraphInfo>(request);

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to read paragraph: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // write_paragraph - Modify paragraph content
  server.registerTool(
    {
      name: 'write_paragraph',
      description:
        'Modify a paragraph in the document. Supports replace, append, prepend, or delete operations. ' +
        'Creates a suggestion for user approval unless auto-approve is enabled.',
      inputSchema: {
        type: 'object',
        properties: {
          baseRevision: {
            type: 'string',
            description: 'The document revision this edit is based on.',
          },
          target: {
            type: 'object',
            properties: {
              index: {
                type: 'number',
                description: '0-indexed paragraph number',
              },
              containing: {
                type: 'string',
                description: 'Text the paragraph contains (partial match)',
              },
            },
            description: 'How to identify the target paragraph',
          },
          operation: {
            type: 'string',
            enum: ['replace', 'append', 'prepend', 'delete'],
            description: 'Operation to perform on the paragraph',
          },
          content: {
            type: 'string',
            description: 'New content (required except for delete)',
          },
          mode: {
            type: 'string',
            enum: ['apply', 'suggest'],
            description: 'Execution mode. Default: "suggest"',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['baseRevision', 'target', 'operation'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const target = args.target as ParagraphTarget;
      const operation = args.operation as ParagraphOperation;
      const content = getStringArg(args, 'content');
      const mode = (args.mode as OperationMode) ?? 'suggest';

      if (!target || (target.index === undefined && !target.containing)) {
        return VMarkMcpServer.errorResult('target must specify index or containing');
      }

      if (target.index !== undefined && target.index < 0) {
        return VMarkMcpServer.errorResult('target.index must be a non-negative number');
      }

      if (operation !== 'delete' && !content) {
        return VMarkMcpServer.errorResult('content is required for non-delete operations');
      }

      try {
        const request: BridgeRequest = {
          type: 'paragraph.write',
          baseRevision,
          target,
          operation,
          content,
          mode,
          windowId,
        };
        const result = await server.sendBridgeRequest<WriteParagraphResult>(request);

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to write paragraph: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
