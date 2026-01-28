/**
 * Structure tools - AST access and document structure queries.
 *
 * These tools provide:
 * - get_document_ast: Full AST with projections and filtering
 * - get_document_digest: Quick overview for first call
 * - list_blocks: Query blocks with filters
 * - resolve_targets: Pre-flight check for mutations
 * - get_section: Access section by heading
 */

import { VMarkMcpServer, resolveWindowId, getNumberArg, getStringArg } from '../server.js';
import type {
  AstResponse,
  DocumentDigest,
  BlockInfo,
  TargetResolution,
  SectionInfo,
  AstProjection,
  BlockQuery,
} from '../bridge/types.js';

/**
 * Register all structure tools on the server.
 */
export function registerStructureTools(server: VMarkMcpServer): void {
  // get_document_ast - Get document AST with projections
  server.registerTool(
    {
      name: 'get_document_ast',
      description:
        'Get the document Abstract Syntax Tree (AST). Use projections to limit response fields ' +
        'and filters to query specific node types. Supports pagination for large documents. ' +
        'This is a detailed view - for a quick overview, use get_document_digest instead.',
      inputSchema: {
        type: 'object',
        properties: {
          projection: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['id', 'type', 'text', 'attrs', 'marks', 'children'],
            },
            description:
              'Fields to include in response. Defaults to all fields. ' +
              'Use fewer fields for faster response times.',
          },
          filter: {
            type: 'object',
            properties: {
              type: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description: 'Filter by node type(s). E.g., "heading" or ["heading", "paragraph"]',
              },
              level: {
                type: 'number',
                description: 'Filter headings by level (1-6)',
              },
              contains: {
                type: 'string',
                description: 'Filter by text content (case-insensitive)',
              },
              hasMarks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by mark types. E.g., ["bold", "link"]',
              },
            },
            description: 'Filter criteria for nodes',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of nodes to return. Default: 100',
          },
          offset: {
            type: 'number',
            description: 'Number of nodes to skip (for offset-based pagination)',
          },
          afterCursor: {
            type: 'string',
            description: 'Node ID for cursor-based pagination. Returns nodes after this ID.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const projection = args.projection as AstProjection[] | undefined;
      const filter = args.filter as BlockQuery | undefined;
      const limit = getNumberArg(args, 'limit');
      const offset = getNumberArg(args, 'offset');
      const afterCursor = getStringArg(args, 'afterCursor');

      try {
        const result = await server.sendBridgeRequest<AstResponse>({
          type: 'structure.getAst',
          projection,
          filter,
          limit,
          offset,
          afterCursor,
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get AST: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // get_document_digest - Quick overview of document
  server.registerTool(
    {
      name: 'get_document_digest',
      description:
        'Get a quick overview of the document without the full AST. Returns title, word count, ' +
        'outline (heading hierarchy), block counts, and flags for special content (images, tables, code). ' +
        'This is the ideal first call for understanding document structure.',
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
        const result = await server.sendBridgeRequest<DocumentDigest>({
          type: 'structure.getDigest',
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get digest: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // list_blocks - Query blocks with filters
  server.registerTool(
    {
      name: 'list_blocks',
      description:
        'List blocks matching a query. Returns block info including ID, type, text preview, ' +
        'and position. Use this to find specific content before mutations.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'object',
            properties: {
              type: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description: 'Filter by node type(s)',
              },
              level: {
                type: 'number',
                description: 'Filter headings by level (1-6)',
              },
              contains: {
                type: 'string',
                description: 'Filter by text content (case-insensitive)',
              },
              hasMarks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by mark types',
              },
            },
            description: 'Query criteria',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of blocks to return. Default: 50',
          },
          afterCursor: {
            type: 'string',
            description: 'Block ID for cursor-based pagination',
          },
          projection: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fields to include in response',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const query = args.query as BlockQuery | undefined;
      const limit = getNumberArg(args, 'limit');
      const afterCursor = getStringArg(args, 'afterCursor');
      const projection = args.projection as string[] | undefined;

      try {
        const result = await server.sendBridgeRequest<{ revision: string; blocks: BlockInfo[]; hasMore: boolean; nextCursor?: string }>({
          type: 'structure.listBlocks',
          query,
          limit,
          afterCursor,
          projection,
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to list blocks: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // resolve_targets - Pre-flight check for mutations
  server.registerTool(
    {
      name: 'resolve_targets',
      description:
        'Pre-flight check before mutations. Finds nodes matching a query and returns candidates ' +
        'with confidence scores. Use this to validate targets and handle ambiguity before applying edits.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'object',
            properties: {
              type: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description: 'Filter by node type(s)',
              },
              level: {
                type: 'number',
                description: 'Filter headings by level (1-6)',
              },
              contains: {
                type: 'string',
                description: 'Filter by text content (case-insensitive)',
              },
              hasMarks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by mark types',
              },
            },
            required: [],
            description: 'Query criteria to match nodes',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum candidates to return. Default: 10',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['query'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const query = args.query as BlockQuery;
      const maxResults = getNumberArg(args, 'maxResults');

      try {
        const result = await server.sendBridgeRequest<TargetResolution>({
          type: 'structure.resolveTargets',
          query,
          maxResults,
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to resolve targets: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // get_section - Get section by heading
  server.registerTool(
    {
      name: 'get_section',
      description:
        'Get a section of the document by its heading. Returns the heading and all content ' +
        'until the next heading of equal or higher level. Use includeNested to also get subsections.',
      inputSchema: {
        type: 'object',
        properties: {
          heading: {
            oneOf: [
              { type: 'string', description: 'Heading text to match (case-insensitive)' },
              {
                type: 'object',
                properties: {
                  level: { type: 'number', description: 'Heading level (1-6)' },
                  index: { type: 'number', description: 'Index among headings of this level (0-based)' },
                },
                required: ['level', 'index'],
                description: 'Match by level and index',
              },
            ],
            description: 'How to identify the section heading',
          },
          includeNested: {
            type: 'boolean',
            description: 'Include subsections in response. Default: false',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['heading'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const heading = args.heading as string | { level: number; index: number };
      const includeNested = args.includeNested as boolean | undefined;

      try {
        const result = await server.sendBridgeRequest<SectionInfo>({
          type: 'structure.getSection',
          heading,
          includeNested,
          windowId,
        });

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get section: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
