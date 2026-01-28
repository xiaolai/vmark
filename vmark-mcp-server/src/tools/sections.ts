/**
 * Section tools - Higher-level section operations.
 *
 * These tools provide:
 * - update_section: Replace section content
 * - insert_section: Add new section
 * - move_section: Reorder sections
 */

import { VMarkMcpServer, resolveWindowId, requireStringArg, getStringArg } from '../server.js';
import type {
  BatchEditResult,
  OperationMode,
} from '../bridge/types.js';

/**
 * Section target specification.
 */
interface SectionTarget {
  /** Match by heading text (case-insensitive) */
  heading?: string;
  /** Match by level and index */
  byIndex?: { level: number; index: number };
  /** Match by section ID */
  sectionId?: string;
}

/**
 * Register all section tools on the server.
 */
export function registerSectionTools(server: VMarkMcpServer): void {
  // update_section - Replace section content
  server.registerTool(
    {
      name: 'update_section',
      description:
        'Replace the content of a section (everything between its heading and the next heading of ' +
        'equal or higher level). The heading itself is preserved unless explicitly included in newContent.',
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
              heading: {
                type: 'string',
                description: 'Match section by heading text (case-insensitive)',
              },
              byIndex: {
                type: 'object',
                properties: {
                  level: { type: 'number', description: 'Heading level (1-6)' },
                  index: { type: 'number', description: 'Index among headings of this level (0-based)' },
                },
                required: ['level', 'index'],
              },
              sectionId: {
                type: 'string',
                description: 'Match by section ID from get_section response',
              },
            },
            description: 'How to identify the target section',
          },
          newContent: {
            type: 'string',
            description: 'New markdown content for the section body (heading excluded)',
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
        required: ['baseRevision', 'target', 'newContent'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const target = args.target as SectionTarget;
      const newContent = requireStringArg(args, 'newContent');
      const mode = (args.mode as OperationMode) ?? 'apply';

      if (!target || (!target.heading && !target.byIndex && !target.sectionId)) {
        return VMarkMcpServer.errorResult('target must specify heading, byIndex, or sectionId');
      }

      try {
        const result = await server.sendBridgeRequest<BatchEditResult>({
          type: 'section.update',
          baseRevision,
          target,
          newContent,
          mode,
          windowId,
        } as any);

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to update section: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // insert_section - Add new section
  server.registerTool(
    {
      name: 'insert_section',
      description:
        'Insert a new section after an existing section or at the end of the document. ' +
        'Creates a new heading with the specified content below it.',
      inputSchema: {
        type: 'object',
        properties: {
          baseRevision: {
            type: 'string',
            description: 'The document revision this edit is based on.',
          },
          after: {
            type: 'object',
            properties: {
              heading: {
                type: 'string',
                description: 'Insert after section with this heading text',
              },
              byIndex: {
                type: 'object',
                properties: {
                  level: { type: 'number' },
                  index: { type: 'number' },
                },
                required: ['level', 'index'],
              },
              sectionId: {
                type: 'string',
                description: 'Insert after section with this ID',
              },
            },
            description: 'Where to insert. Omit to insert at end of document.',
          },
          heading: {
            type: 'object',
            properties: {
              level: {
                type: 'number',
                description: 'Heading level (1-6)',
                minimum: 1,
                maximum: 6,
              },
              text: {
                type: 'string',
                description: 'Heading text',
              },
            },
            required: ['level', 'text'],
            description: 'The new section heading',
          },
          content: {
            type: 'string',
            description: 'Section body content (markdown)',
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
        required: ['baseRevision', 'heading'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const after = args.after as SectionTarget | undefined;
      const heading = args.heading as { level: number; text: string };
      const content = getStringArg(args, 'content') ?? '';
      const mode = (args.mode as OperationMode) ?? 'apply';

      if (!heading || !heading.level || !heading.text) {
        return VMarkMcpServer.errorResult('heading must include level and text');
      }

      if (heading.level < 1 || heading.level > 6) {
        return VMarkMcpServer.errorResult('heading.level must be between 1 and 6');
      }

      try {
        const result = await server.sendBridgeRequest<BatchEditResult>({
          type: 'section.insert',
          baseRevision,
          after,
          heading,
          content,
          mode,
          windowId,
        } as any);

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to insert section: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // move_section - Reorder sections
  server.registerTool(
    {
      name: 'move_section',
      description:
        'Move a section (heading and all content until next same-level heading) to a new position. ' +
        'Subsections move with the parent section.',
      inputSchema: {
        type: 'object',
        properties: {
          baseRevision: {
            type: 'string',
            description: 'The document revision this edit is based on.',
          },
          section: {
            type: 'object',
            properties: {
              heading: {
                type: 'string',
                description: 'Match section by heading text',
              },
              byIndex: {
                type: 'object',
                properties: {
                  level: { type: 'number' },
                  index: { type: 'number' },
                },
                required: ['level', 'index'],
              },
              sectionId: {
                type: 'string',
              },
            },
            description: 'The section to move',
          },
          after: {
            type: 'object',
            properties: {
              heading: {
                type: 'string',
              },
              byIndex: {
                type: 'object',
                properties: {
                  level: { type: 'number' },
                  index: { type: 'number' },
                },
                required: ['level', 'index'],
              },
              sectionId: {
                type: 'string',
              },
            },
            description: 'Move after this section. Omit to move to document start.',
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
        required: ['baseRevision', 'section'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const section = args.section as SectionTarget;
      const after = args.after as SectionTarget | undefined;
      const mode = (args.mode as OperationMode) ?? 'apply';

      if (!section || (!section.heading && !section.byIndex && !section.sectionId)) {
        return VMarkMcpServer.errorResult('section must specify heading, byIndex, or sectionId');
      }

      try {
        const result = await server.sendBridgeRequest<BatchEditResult>({
          type: 'section.move',
          baseRevision,
          section,
          after,
          mode,
          windowId,
        } as any);

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to move section: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
