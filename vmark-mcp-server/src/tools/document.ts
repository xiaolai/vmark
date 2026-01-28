/**
 * Document tools - Read and write document content.
 */

import { VMarkMcpServer, resolveWindowId, validateNonNegativeInteger } from '../server.js';
import type { SearchResult, ReplaceResult, EditResult } from '../bridge/types.js';

/**
 * Register all document tools on the server.
 */
export function registerDocumentTools(server: VMarkMcpServer): void {
  // document_get_content - Get the full document content
  server.registerTool(
    {
      name: 'document_get_content',
      description:
        'Get the full content of the current document as markdown text. ' +
        'Returns the entire document content that can be used for analysis, ' +
        'processing, or modification.',
      inputSchema: {
        type: 'object',
        properties: {
          windowId: {
            type: 'string',
            description:
              'Optional window identifier. Use "focused" for the active window ' +
              'or a specific window label. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);

      try {
        const content = await server.sendBridgeRequest<string>({
          type: 'document.getContent',
          windowId,
        });

        return VMarkMcpServer.successResult(content);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get document content: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // document_set_content - Only allowed on empty documents
  // This prevents AI from accidentally overwriting user content.
  server.registerTool(
    {
      name: 'document_set_content',
      description:
        'Set the full document content. Only works when the document is empty ' +
        '(no existing content to overwrite). For non-empty documents, use ' +
        'document_insert_at_cursor, document_replace, or selection_replace instead.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The new document content in markdown format.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['content'],
      },
    },
    async (args) => {
      const content = args.content as string;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (typeof content !== 'string') {
        return VMarkMcpServer.errorResult('content must be a string');
      }

      try {
        const result = await server.sendBridgeRequest<{ message: string }>({
          type: 'document.setContent',
          content,
          windowId,
        });

        return VMarkMcpServer.successResult(result.message);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to set document content: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // document_insert_at_cursor - Insert text at the current cursor position
  server.registerTool(
    {
      name: 'document_insert_at_cursor',
      description:
        'Insert text at the current cursor position. ' +
        'The cursor will be moved to the end of the inserted text. ' +
        'If there is a selection, the text is inserted at the selection start.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to insert at the cursor position.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['text'],
      },
    },
    async (args) => {
      const text = args.text as string;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (typeof text !== 'string') {
        return VMarkMcpServer.errorResult('text must be a string');
      }

      try {
        const result = await server.sendBridgeRequest<EditResult>({
          type: 'document.insertAtCursor',
          text,
          windowId,
        });

        // Return structured result including suggestionId if edit was staged
        return VMarkMcpServer.successJsonResult({
          message: result.message,
          position: result.position,
          suggestionId: result.suggestionId,
          applied: !result.suggestionId, // Applied if no suggestionId (auto-approved)
        });
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert at cursor: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // document_insert_at_position - Insert text at a specific position
  server.registerTool(
    {
      name: 'document_insert_at_position',
      description:
        'Insert text at a specific character position in the document. ' +
        'Position 0 is the start of the document.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to insert.',
          },
          position: {
            type: 'number',
            description: 'Character position (0-indexed) to insert at.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['text', 'position'],
      },
    },
    async (args) => {
      const text = args.text as string;
      const position = args.position as number;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (typeof text !== 'string') {
        return VMarkMcpServer.errorResult('text must be a string');
      }
      const positionError = validateNonNegativeInteger(position, 'position');
      if (positionError) {
        return VMarkMcpServer.errorResult(positionError);
      }

      try {
        const result = await server.sendBridgeRequest<EditResult>({
          type: 'document.insertAtPosition',
          text,
          position,
          windowId,
        });

        // Return structured result including suggestionId if edit was staged
        return VMarkMcpServer.successJsonResult({
          message: result.message,
          position: result.position,
          suggestionId: result.suggestionId,
          applied: !result.suggestionId,
        });
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert at position: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // document_search - Search for text in the document
  server.registerTool(
    {
      name: 'document_search',
      description:
        'Search for text in the document. Returns all matches with their ' +
        'positions and line numbers. Supports case-sensitive and case-insensitive search.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The text to search for.',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether the search is case-sensitive. Defaults to false.',
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
      const query = args.query as string;
      const caseSensitive = (args.caseSensitive as boolean) ?? false;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (typeof query !== 'string' || query.length === 0) {
        return VMarkMcpServer.errorResult('query must be a non-empty string');
      }

      try {
        const result = await server.sendBridgeRequest<SearchResult>({
          type: 'document.search',
          query,
          caseSensitive,
          windowId,
        });

        return VMarkMcpServer.successJsonResult(result);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to search document: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // document_replace - Replace text in the document
  server.registerTool(
    {
      name: 'document_replace',
      description:
        'Replace occurrences of search text with replacement text. ' +
        'Can replace the first occurrence or all occurrences.',
      inputSchema: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'The text to search for.',
          },
          replace: {
            type: 'string',
            description: 'The replacement text.',
          },
          all: {
            type: 'boolean',
            description: 'Replace all occurrences. Defaults to false (first only).',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['search', 'replace'],
      },
    },
    async (args) => {
      const search = args.search as string;
      const replace = args.replace as string;
      const all = (args.all as boolean) ?? false;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (typeof search !== 'string' || search.length === 0) {
        return VMarkMcpServer.errorResult('search must be a non-empty string');
      }
      if (typeof replace !== 'string') {
        return VMarkMcpServer.errorResult('replace must be a string');
      }

      try {
        const result = await server.sendBridgeRequest<ReplaceResult>({
          type: 'document.replace',
          search,
          replace,
          all,
          windowId,
        });

        const message =
          result.message ??
          (result.count === 0
            ? 'No matches found'
            : `Replaced ${result.count} occurrence${result.count > 1 ? 's' : ''}`);

        // Return structured result including suggestionIds if edits were staged
        return VMarkMcpServer.successJsonResult({
          count: result.count,
          message,
          suggestionIds: result.suggestionIds,
          applied: !result.suggestionIds || result.suggestionIds.length === 0,
        });
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to replace text: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
