/**
 * Selection tools - Read and manipulate text selection.
 */

import {
  VMarkMcpServer,
  validateNonNegativeInteger,
  requireStringArgAllowEmpty,
  requireNumberArg,
  getNumberArg,
  getWindowIdArg,
} from '../server.js';
import type { Selection, CursorContext, EditResult } from '../bridge/types.js';

/**
 * Register all selection tools on the server.
 */
export function registerSelectionTools(server: VMarkMcpServer): void {
  // selection_get - Get the current selection
  server.registerTool(
    {
      name: 'selection_get',
      description:
        'Get the current text selection. Returns the selected text, ' +
        'its range (from/to positions), and whether the selection is empty (cursor only).',
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
      const windowId = getWindowIdArg(args);

      try {
        const selection = await server.sendBridgeRequest<Selection>({
          type: 'selection.get',
          windowId,
        });

        return VMarkMcpServer.successJsonResult(selection);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get selection: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // selection_set - Set the selection range
  server.registerTool(
    {
      name: 'selection_set',
      description:
        'Set the selection range in the document. ' +
        'Use the same value for from and to to position the cursor without selecting text.',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'number',
            description: 'Start position of the selection (0-indexed, inclusive).',
          },
          to: {
            type: 'number',
            description: 'End position of the selection (0-indexed, exclusive).',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['from', 'to'],
      },
    },
    async (args) => {
      try {
        const from = requireNumberArg(args, 'from');
        const to = requireNumberArg(args, 'to');
        const windowId = getWindowIdArg(args);

        const fromError = validateNonNegativeInteger(from, 'from');
        if (fromError) {
          return VMarkMcpServer.errorResult(fromError);
        }
        const toError = validateNonNegativeInteger(to, 'to');
        if (toError) {
          return VMarkMcpServer.errorResult(toError);
        }
        if (from > to) {
          return VMarkMcpServer.errorResult('from cannot be greater than to');
        }

        await server.sendBridgeRequest<null>({
          type: 'selection.set',
          from,
          to,
          windowId,
        });

        const message =
          from === to
            ? `Cursor positioned at ${from}`
            : `Selected range ${from}-${to} (${to - from} characters)`;

        return VMarkMcpServer.successResult(message);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to set selection: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // selection_replace - Replace the selected text
  server.registerTool(
    {
      name: 'selection_replace',
      description:
        'Replace the currently selected text with new text. ' +
        'If no text is selected, inserts at cursor position. ' +
        'The cursor will be positioned at the end of the inserted text.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to replace the selection with.',
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
          type: 'selection.replace',
          text,
          windowId,
        });

        // Return structured result including suggestionId if edit was staged
        return VMarkMcpServer.successJsonResult({
          message: result.message,
          range: result.range,
          originalContent: result.originalContent,
          suggestionId: result.suggestionId,
          applied: !result.suggestionId,
        });
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to replace selection: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // cursor_get_context - Get text around the cursor
  server.registerTool(
    {
      name: 'cursor_get_context',
      description:
        'Get the text surrounding the cursor position. ' +
        'Returns lines before and after the cursor, the current line, ' +
        'and the current paragraph. Useful for AI to understand editing context.',
      inputSchema: {
        type: 'object',
        properties: {
          linesBefore: {
            type: 'number',
            description: 'Number of lines to include before the cursor. Defaults to 3.',
          },
          linesAfter: {
            type: 'number',
            description: 'Number of lines to include after the cursor. Defaults to 3.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const linesBefore = getNumberArg(args, 'linesBefore') ?? 3;
      const linesAfter = getNumberArg(args, 'linesAfter') ?? 3;
      const windowId = getWindowIdArg(args);

      const linesBeforeError = validateNonNegativeInteger(linesBefore, 'linesBefore');
      if (linesBeforeError) {
        return VMarkMcpServer.errorResult(linesBeforeError);
      }
      const linesAfterError = validateNonNegativeInteger(linesAfter, 'linesAfter');
      if (linesAfterError) {
        return VMarkMcpServer.errorResult(linesAfterError);
      }

      try {
        const context = await server.sendBridgeRequest<CursorContext>({
          type: 'cursor.getContext',
          linesBefore,
          linesAfter,
          windowId,
        });

        return VMarkMcpServer.successJsonResult(context);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to get cursor context: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // cursor_set_position - Set cursor position
  server.registerTool(
    {
      name: 'cursor_set_position',
      description:
        'Set the cursor position in the document. ' +
        'This clears any existing selection.',
      inputSchema: {
        type: 'object',
        properties: {
          position: {
            type: 'number',
            description: 'Character position (0-indexed) to place the cursor.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['position'],
      },
    },
    async (args) => {
      try {
        const position = requireNumberArg(args, 'position');
        const windowId = getWindowIdArg(args);

        const positionError = validateNonNegativeInteger(position, 'position');
        if (positionError) {
          return VMarkMcpServer.errorResult(positionError);
        }
        await server.sendBridgeRequest<null>({
          type: 'cursor.setPosition',
          position,
          windowId,
        });

        return VMarkMcpServer.successResult(`Cursor positioned at ${position}`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to set cursor position: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
