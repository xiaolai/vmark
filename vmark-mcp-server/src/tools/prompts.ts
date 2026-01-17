/**
 * AI Prompt tools - Writing assistance and translation.
 */

import { VMarkMcpServer, resolveWindowId } from '../server.js';
import type { WritingStyle, SummaryLength } from '../bridge/types.js';

/**
 * Valid writing improvement styles.
 */
const VALID_STYLES: readonly WritingStyle[] = ['formal', 'casual', 'concise', 'elaborate', 'academic'];

function isValidStyle(style: string): style is WritingStyle {
  return VALID_STYLES.includes(style as WritingStyle);
}

/**
 * Register all AI prompt tools on the server.
 */
export function registerPromptTools(server: VMarkMcpServer): void {
  // improve_writing - Improve selected text
  server.registerTool(
    {
      name: 'improve_writing',
      description:
        'Improve the selected text using AI. ' +
        'Can adjust style, fix grammar, improve clarity, etc. ' +
        'The improved text replaces the selection.',
      inputSchema: {
        type: 'object',
        properties: {
          style: {
            type: 'string',
            enum: [...VALID_STYLES],
            description: 'Target writing style: formal, casual, concise, elaborate, academic.',
          },
          instructions: {
            type: 'string',
            description: 'Additional instructions for improvement.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const styleArg = args.style as string | undefined;
      const instructions = args.instructions as string | undefined;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (styleArg && !isValidStyle(styleArg)) {
        return VMarkMcpServer.errorResult(
          `Invalid style: ${styleArg}. Valid styles: ${VALID_STYLES.join(', ')}`
        );
      }

      const style: WritingStyle | undefined = styleArg && isValidStyle(styleArg) ? styleArg : undefined;

      try {
        const result = await server.sendBridgeRequest<{ improved: string }>({
          type: 'ai.improveWriting',
          style,
          instructions,
          windowId,
        });

        return VMarkMcpServer.successResult(`Writing improved. Preview: ${result.improved.slice(0, 100)}...`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to improve writing: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // fix_grammar - Fix grammar in selected text
  server.registerTool(
    {
      name: 'fix_grammar',
      description:
        'Fix grammar and spelling errors in the selected text. ' +
        'Preserves the original meaning and style.',
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
        const result = await server.sendBridgeRequest<{ fixed: string; changes: number }>({
          type: 'ai.fixGrammar',
          windowId,
        });

        return VMarkMcpServer.successResult(
          `Fixed ${result.changes} grammar issue${result.changes !== 1 ? 's' : ''}`
        );
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to fix grammar: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // translate - Translate selected text
  server.registerTool(
    {
      name: 'translate',
      description:
        'Translate the selected text to a different language. ' +
        'The translated text replaces the selection.',
      inputSchema: {
        type: 'object',
        properties: {
          targetLanguage: {
            type: 'string',
            description: 'Target language code (e.g., "en", "zh", "ja", "ko", "es", "fr").',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['targetLanguage'],
      },
    },
    async (args) => {
      const targetLanguage = args.targetLanguage as string;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (typeof targetLanguage !== 'string' || targetLanguage.length === 0) {
        return VMarkMcpServer.errorResult('targetLanguage must be a non-empty string');
      }

      try {
        await server.sendBridgeRequest<{ translated: string }>({
          type: 'ai.translate',
          targetLanguage,
          windowId,
        });

        return VMarkMcpServer.successResult(`Translated to ${targetLanguage}`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to translate: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // summarize - Summarize selected text
  server.registerTool(
    {
      name: 'summarize',
      description:
        'Generate a summary of the selected text. ' +
        'The summary is inserted after the selection.',
      inputSchema: {
        type: 'object',
        properties: {
          length: {
            type: 'string',
            enum: ['brief', 'medium', 'detailed'],
            description: 'Summary length: brief (1-2 sentences), medium (paragraph), detailed (multiple paragraphs).',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const lengthArg = args.length as string | undefined;
      const length: SummaryLength = (lengthArg === 'brief' || lengthArg === 'medium' || lengthArg === 'detailed')
        ? lengthArg
        : 'medium';
      const windowId = resolveWindowId(args.windowId as string | undefined);

      if (lengthArg && lengthArg !== 'brief' && lengthArg !== 'medium' && lengthArg !== 'detailed') {
        return VMarkMcpServer.errorResult('length must be "brief", "medium", or "detailed"');
      }

      try {
        await server.sendBridgeRequest<{ summary: string }>({
          type: 'ai.summarize',
          length,
          windowId,
        });

        return VMarkMcpServer.successResult(`Summary generated (${length})`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to summarize: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // expand - Expand selected text
  server.registerTool(
    {
      name: 'expand',
      description:
        'Expand the selected text with more detail. ' +
        'Adds elaboration, examples, or explanations.',
      inputSchema: {
        type: 'object',
        properties: {
          focus: {
            type: 'string',
            description: 'Optional focus area for expansion (e.g., "examples", "technical details").',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
      },
    },
    async (args) => {
      const focus = args.focus as string | undefined;
      const windowId = resolveWindowId(args.windowId as string | undefined);

      try {
        await server.sendBridgeRequest<{ expanded: string }>({
          type: 'ai.expand',
          focus,
          windowId,
        });

        return VMarkMcpServer.successResult('Text expanded');
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to expand text: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
