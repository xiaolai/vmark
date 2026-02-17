/**
 * VMark-specific tools - Math, Mermaid, SVG, Wiki links, CJK formatting.
 */

import {
  VMarkMcpServer,
  requireStringArg,
  getStringArg,
  getWindowIdArg,
} from '../server.js';

/**
 * Register all VMark-specific tools on the server.
 */
export function registerVMarkTools(server: VMarkMcpServer): void {
  // insert_math_inline - Insert inline math
  server.registerTool(
    {
      name: 'insert_math_inline',
      description:
        'Insert inline LaTeX math at the cursor position. ' +
        'The math will be rendered inline with the surrounding text. ' +
        'Example: $E = mc^2$ for inline equations.',
      inputSchema: {
        type: 'object',
        properties: {
          latex: {
            type: 'string',
            description: 'The LaTeX math expression (without $ delimiters).',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['latex'],
      },
    },
    async (args) => {
      try {
        const latex = requireStringArg(args, 'latex');
        const windowId = getWindowIdArg(args);

        await server.sendBridgeRequest<null>({
          type: 'vmark.insertMathInline',
          latex,
          windowId,
        });

        return VMarkMcpServer.successResult(`Inserted inline math: ${latex}`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert inline math: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // insert_math_block - Insert block math
  server.registerTool(
    {
      name: 'insert_math_block',
      description:
        'Insert a block-level LaTeX math equation. ' +
        'The math will be displayed on its own line, centered. ' +
        'Example: $$\\int_0^\\infty e^{-x^2} dx$$ for display equations.',
      inputSchema: {
        type: 'object',
        properties: {
          latex: {
            type: 'string',
            description: 'The LaTeX math expression (without $$ delimiters).',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['latex'],
      },
    },
    async (args) => {
      try {
        const latex = requireStringArg(args, 'latex');
        const windowId = getWindowIdArg(args);
        await server.sendBridgeRequest<null>({
          type: 'vmark.insertMathBlock',
          latex,
          windowId,
        });

        return VMarkMcpServer.successResult(`Inserted block math equation`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert block math: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // insert_mermaid - Insert Mermaid diagram
  server.registerTool(
    {
      name: 'insert_mermaid',
      description:
        'Insert a Mermaid diagram at the cursor position. ' +
        'Supports flowcharts, sequence diagrams, class diagrams, etc. ' +
        'The diagram code will be rendered as a visual diagram.',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The Mermaid diagram code.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['code'],
      },
    },
    async (args) => {
      try {
        const code = requireStringArg(args, 'code');
        const windowId = getWindowIdArg(args);

        await server.sendBridgeRequest<null>({
          type: 'vmark.insertMermaid',
          code,
          windowId,
        });

        return VMarkMcpServer.successResult('Inserted Mermaid diagram');
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert Mermaid diagram: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // insert_markmap - Insert Markmap mindmap
  server.registerTool(
    {
      name: 'insert_markmap',
      description:
        'Insert a Markmap mindmap at the cursor position. ' +
        'Uses standard Markdown headings (# H1, ## H2, etc.) to define the tree. ' +
        'Lists, bold, links, and code in nodes are preserved.',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Markdown with headings defining the mindmap tree.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['code'],
      },
    },
    async (args) => {
      try {
        const code = requireStringArg(args, 'code');
        const windowId = getWindowIdArg(args);

        await server.sendBridgeRequest<null>({
          type: 'vmark.insertMarkmap',
          code,
          windowId,
        });

        return VMarkMcpServer.successResult('Inserted Markmap mindmap');
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert Markmap mindmap: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // insert_svg - Insert SVG graphic
  server.registerTool(
    {
      name: 'insert_svg',
      description:
        'Insert an SVG graphic at the cursor position. ' +
        'The SVG code will be rendered as an inline graphic with pan, zoom, and PNG export. ' +
        'Use this for charts, illustrations, icons, or any visual that does not fit Mermaid grammar.',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The SVG markup (must be valid XML with an <svg> root element).',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['code'],
      },
    },
    async (args) => {
      try {
        const code = requireStringArg(args, 'code');
        const windowId = getWindowIdArg(args);

        await server.sendBridgeRequest<null>({
          type: 'vmark.insertSvg',
          code,
          windowId,
        });

        return VMarkMcpServer.successResult('Inserted SVG graphic');
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert SVG graphic: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // insert_wiki_link - Insert wiki-style link
  server.registerTool(
    {
      name: 'insert_wiki_link',
      description:
        'Insert a wiki-style link [[target]] or [[target|display text]]. ' +
        'Wiki links connect documents within the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'The target document or heading (e.g., "My Document" or "My Document#Section").',
          },
          displayText: {
            type: 'string',
            description: 'Optional display text. If omitted, the target is shown.',
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
      try {
        const target = requireStringArg(args, 'target');
        const displayText = getStringArg(args, 'displayText');
        const windowId = getWindowIdArg(args);
        await server.sendBridgeRequest<null>({
          type: 'vmark.insertWikiLink',
          target,
          displayText,
          windowId,
        });

        const linkText = displayText ? `[[${target}|${displayText}]]` : `[[${target}]]`;
        return VMarkMcpServer.successResult(`Inserted wiki link: ${linkText}`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert wiki link: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // cjk_punctuation_convert - Convert CJK punctuation
  server.registerTool(
    {
      name: 'cjk_punctuation_convert',
      description:
        'Convert punctuation between half-width and full-width forms. ' +
        'Useful for CJK (Chinese, Japanese, Korean) text formatting.',
      inputSchema: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['to-fullwidth', 'to-halfwidth'],
            description: 'Conversion direction: to-fullwidth or to-halfwidth.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['direction'],
      },
    },
    async (args) => {
      const direction = requireStringArg(args, 'direction');
      const windowId = getWindowIdArg(args);

      if (direction !== 'to-fullwidth' && direction !== 'to-halfwidth') {
        return VMarkMcpServer.errorResult(
          'direction must be "to-fullwidth" or "to-halfwidth"'
        );
      }

      try {
        await server.sendBridgeRequest<null>({
          type: 'vmark.cjkPunctuationConvert',
          direction,
          windowId,
        });

        return VMarkMcpServer.successResult(`Converted punctuation ${direction}`);
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to convert punctuation: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // cjk_spacing_fix - Fix spacing around CJK text
  server.registerTool(
    {
      name: 'cjk_spacing_fix',
      description:
        'Add or remove spacing between CJK and Latin characters. ' +
        'Improves readability of mixed-language text.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'remove'],
            description: 'Whether to add or remove spacing.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['action'],
      },
    },
    async (args) => {
      const action = requireStringArg(args, 'action');
      const windowId = getWindowIdArg(args);

      if (action !== 'add' && action !== 'remove') {
        return VMarkMcpServer.errorResult('action must be "add" or "remove"');
      }

      try {
        await server.sendBridgeRequest<null>({
          type: 'vmark.cjkSpacingFix',
          action,
          windowId,
        });

        return VMarkMcpServer.successResult(
          action === 'add' ? 'Added CJK spacing' : 'Removed CJK spacing'
        );
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to fix CJK spacing: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
