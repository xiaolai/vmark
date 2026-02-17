/**
 * Document tools - Read and write document content.
 */

import {
  VMarkMcpServer,
  validateNonNegativeInteger,
  requireStringArg,
  requireStringArgAllowEmpty,
  getWindowIdArg,
  requireNumberArg,
  getBooleanArg,
} from '../server.js';
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
      const windowId = getWindowIdArg(args);

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
        'document_insert_at_cursor, apply_diff, or selection_replace instead.',
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
      try {
        const content = requireStringArgAllowEmpty(args, 'content');
        const windowId = getWindowIdArg(args);

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
      try {
        const text = requireStringArgAllowEmpty(args, 'text');
        const windowId = getWindowIdArg(args);
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
      try {
        const text = requireStringArgAllowEmpty(args, 'text');
        const position = requireNumberArg(args, 'position');
        const windowId = getWindowIdArg(args);
        const positionError = validateNonNegativeInteger(position, 'position');
        if (positionError) {
          return VMarkMcpServer.errorResult(positionError);
        }
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
      try {
        const query = requireStringArg(args, 'query');
        const caseSensitive = getBooleanArg(args, 'caseSensitive') ?? false;
        const windowId = getWindowIdArg(args);
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

  // document_replace_in_source - Replace text at the markdown source level
  server.registerTool(
    {
      name: 'document_replace_in_source',
      description:
        'Replace text at the markdown source level, bypassing ProseMirror node boundaries. ' +
        'Use this when `apply_diff` returns "No matches found" because the search text ' +
        'spans formatting boundaries (e.g. partially bold text). ' +
        'Serializes the document to markdown, performs string find/replace, then re-parses. ' +
        'IMPORTANT: The search string must match the raw markdown source, including any ' +
        'syntax markers like ** for bold, _ for italic, []() for links, etc. ' +
        'Supports the suggestion/approval flow.',
      inputSchema: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'The text to search for in the markdown source.',
          },
          replace: {
            type: 'string',
            description: 'The replacement text (markdown supported).',
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
      try {
        const search = requireStringArg(args, 'search');
        const replace = requireStringArgAllowEmpty(args, 'replace');
        const all = getBooleanArg(args, 'all') ?? false;
        const windowId = getWindowIdArg(args);
        const result = await server.sendBridgeRequest<ReplaceResult>({
          type: 'document.replaceInSource',
          search,
          replace,
          all,
          windowId,
        });

        const message =
          result.message ??
          (result.count === 0
            ? 'No matches found'
            : `Replaced ${result.count} occurrence${result.count > 1 ? 's' : ''} in source`);

        return VMarkMcpServer.successJsonResult({
          count: result.count,
          message,
          suggestionIds: result.suggestionIds,
          applied: !result.suggestionIds || result.suggestionIds.length === 0,
        });
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to replace in source: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
