/**
 * Smart Insert Tool - Intuitive insertion for common scenarios.
 *
 * Provides a single unified tool for inserting content at common locations:
 * - End of document
 * - Start of document
 * - After a specific paragraph (by index or content match)
 * - After a specific section
 */

import { VMarkMcpServer, resolveWindowId, requireStringArg } from '../server.js';
import type {
  SmartInsertDestination,
  SmartInsertResult,
  OperationMode,
  BridgeRequest,
} from '../bridge/types.js';

/**
 * Parse destination string to SmartInsertDestination.
 */
function parseDestination(dest: unknown): SmartInsertDestination | null {
  if (typeof dest === 'string') {
    if (dest === 'end_of_document' || dest === 'start_of_document') {
      return dest;
    }
    return null;
  }

  if (typeof dest === 'object' && dest !== null) {
    const obj = dest as Record<string, unknown>;

    if ('after_paragraph' in obj && typeof obj.after_paragraph === 'number') {
      if (obj.after_paragraph < 0) return null;
      return { after_paragraph: obj.after_paragraph };
    }

    if ('after_paragraph_containing' in obj && typeof obj.after_paragraph_containing === 'string') {
      return { after_paragraph_containing: obj.after_paragraph_containing };
    }

    if ('after_section' in obj && typeof obj.after_section === 'string') {
      return { after_section: obj.after_section };
    }
  }

  return null;
}

/**
 * Register the smart_insert tool on the server.
 */
export function registerSmartInsertTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'smart_insert',
      description:
        'Insert content at common document locations. Supports end/start of document, ' +
        'after a specific paragraph, or after a section heading. ' +
        'Creates a suggestion for user approval unless auto-approve is enabled.',
      inputSchema: {
        type: 'object',
        properties: {
          baseRevision: {
            type: 'string',
            description: 'The document revision this insert is based on.',
          },
          destination: {
            oneOf: [
              {
                type: 'string',
                enum: ['end_of_document', 'start_of_document'],
                description: 'Insert at document start or end',
              },
              {
                type: 'object',
                properties: {
                  after_paragraph: {
                    type: 'number',
                    description: 'Insert after paragraph at this index (0-indexed)',
                  },
                },
                required: ['after_paragraph'],
              },
              {
                type: 'object',
                properties: {
                  after_paragraph_containing: {
                    type: 'string',
                    description: 'Insert after paragraph containing this text',
                  },
                },
                required: ['after_paragraph_containing'],
              },
              {
                type: 'object',
                properties: {
                  after_section: {
                    type: 'string',
                    description: 'Insert after section with this heading',
                  },
                },
                required: ['after_section'],
              },
            ],
            description: 'Where to insert the content',
          },
          content: {
            type: 'string',
            description: 'The markdown content to insert',
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
        required: ['baseRevision', 'destination', 'content'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const content = requireStringArg(args, 'content');
      const mode = (args.mode as OperationMode) ?? 'suggest';

      const destination = parseDestination(args.destination);
      if (!destination) {
        return VMarkMcpServer.errorResult(
          'Invalid destination. Use "end_of_document", "start_of_document", ' +
            '{ after_paragraph: <index> }, { after_paragraph_containing: "<text>" }, ' +
            'or { after_section: "<heading>" }'
        );
      }

      try {
        const request: BridgeRequest = {
          type: 'smartInsert',
          baseRevision,
          destination,
          content,
          mode,
          windowId,
        };
        const result = await server.sendBridgeRequest<SmartInsertResult>(request);

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert content: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
