/**
 * Suggestions composite tool — manage AI-generated edit suggestions.
 */

import { VMarkMcpServer, getWindowIdArg, requireStringArg } from '../server.js';
import type { SuggestionListResult } from '../bridge/types.js';

export function registerSuggestionsTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'suggestions',
      description:
        'Manage AI-generated edit suggestions pending user approval.\n\n' +
        'Actions:\n' +
        '- list: List all pending suggestions (id, type, position, content)\n' +
        '- accept: Accept a suggestion by suggestionId (applies it)\n' +
        '- reject: Reject a suggestion by suggestionId (discards it)\n' +
        '- accept_all: Accept all pending suggestions at once\n' +
        '- reject_all: Reject all pending suggestions at once',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'accept', 'reject', 'accept_all', 'reject_all'],
          },
          suggestionId: {
            type: 'string',
            description: 'Suggestion ID (for accept, reject).',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const action = args.action as string;
      const windowId = getWindowIdArg(args);

      switch (action) {
        case 'list':
          return handleList(server, windowId);
        case 'accept':
          return handleAccept(server, windowId, args);
        case 'reject':
          return handleReject(server, windowId, args);
        case 'accept_all':
          return handleAcceptAll(server, windowId);
        case 'reject_all':
          return handleRejectAll(server, windowId);
        default:
          return VMarkMcpServer.errorResult(`Unknown suggestions action: ${action}`);
      }
    }
  );
}

async function handleList(server: VMarkMcpServer, windowId: string) {
  try {
    const result = await server.sendBridgeRequest<SuggestionListResult>({
      type: 'suggestion.list',
      windowId,
    });

    if (result.count === 0) {
      return VMarkMcpServer.successResult('No pending suggestions');
    }
    return VMarkMcpServer.successResult(
      `Found ${result.count} pending suggestion(s):\n` +
        JSON.stringify(result.suggestions, null, 2)
    );
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to list suggestions: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleAccept(
  server: VMarkMcpServer,
  windowId: string,
  args: Record<string, unknown>
) {
  try {
    const suggestionId = requireStringArg(args, 'suggestionId');
    await server.sendBridgeRequest<{ message: string; suggestionId: string }>({
      type: 'suggestion.accept',
      suggestionId,
      windowId,
    });
    return VMarkMcpServer.successResult(`Suggestion ${suggestionId} accepted and applied`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to accept suggestion: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleReject(
  server: VMarkMcpServer,
  windowId: string,
  args: Record<string, unknown>
) {
  try {
    const suggestionId = requireStringArg(args, 'suggestionId');
    await server.sendBridgeRequest<{ message: string; suggestionId: string }>({
      type: 'suggestion.reject',
      suggestionId,
      windowId,
    });
    return VMarkMcpServer.successResult(`Suggestion ${suggestionId} rejected`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to reject suggestion: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleAcceptAll(server: VMarkMcpServer, windowId: string) {
  try {
    const result = await server.sendBridgeRequest<{ message: string; count: number }>({
      type: 'suggestion.acceptAll',
      windowId,
    });
    return VMarkMcpServer.successResult(`Accepted ${result.count} suggestion(s)`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to accept all suggestions: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleRejectAll(server: VMarkMcpServer, windowId: string) {
  try {
    const result = await server.sendBridgeRequest<{ message: string; count: number }>({
      type: 'suggestion.rejectAll',
      windowId,
    });
    return VMarkMcpServer.successResult(`Rejected ${result.count} suggestion(s)`);
  } catch (error) {
    return VMarkMcpServer.errorResult(
      `Failed to reject all suggestions: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
