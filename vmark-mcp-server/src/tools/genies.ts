/**
 * Genie tools — List, read, and invoke AI genies.
 *
 * These tools allow AI assistants to discover available genies,
 * read their templates, and invoke them against editor content.
 */

import { VMarkMcpServer, resolveWindowId, requireStringArg, getStringArg } from '../server.js';

interface GenieEntry {
  name: string;
  path: string;
  source: string;
  category: string | null;
}

interface GenieContent {
  metadata: {
    name: string;
    description: string;
    scope: string;
    category: string | null;
    model: string | null;
  };
  template: string;
}

/**
 * Register all genie tools on the server.
 */
export function registerGenieTools(server: VMarkMcpServer): void {
  // list_genies — List available AI genies
  server.registerTool(
    {
      name: 'list_genies',
      description:
        'List all available AI genies from global and workspace directories. ' +
        'Returns genie names, categories, scopes, and file paths.',
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
        const result = await server.sendBridgeRequest<{ genies: GenieEntry[] }>({
          type: 'genies.list',
          windowId,
        });

        if (!result.genies || result.genies.length === 0) {
          return VMarkMcpServer.successResult('No genies found');
        }

        return VMarkMcpServer.successResult(
          `Found ${result.genies.length} genie(s):\n` +
            JSON.stringify(result.genies, null, 2)
        );
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to list genies: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // read_genie — Read a specific genie's template
  server.registerTool(
    {
      name: 'read_genie',
      description:
        'Read a specific AI genie file and return its metadata and template. ' +
        'Use list_genies first to discover available genies and their file paths.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The file path of the genie to read.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['path'],
      },
    },
    async (args) => {
      const path = requireStringArg(args, 'path');
      const windowId = resolveWindowId(args.windowId as string | undefined);

      try {
        const result = await server.sendBridgeRequest<GenieContent>({
          type: 'genies.read',
          windowId,
          path,
        });

        if (!result.metadata) {
          return VMarkMcpServer.errorResult('Invalid response: missing genie metadata');
        }

        return VMarkMcpServer.successResult(
          `Genie: ${result.metadata.name}\n` +
            `Description: ${result.metadata.description}\n` +
            `Scope: ${result.metadata.scope}\n` +
            `Category: ${result.metadata.category ?? 'none'}\n\n` +
            `Template:\n${result.template}`
        );
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to read genie: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // invoke_genie — Run a genie against current editor content
  server.registerTool(
    {
      name: 'invoke_genie',
      description:
        'Invoke an AI genie against the current editor content. ' +
        'The genie template will be filled with content based on the scope ' +
        '(selection, block, or document) and sent to the active AI provider.',
      inputSchema: {
        type: 'object',
        properties: {
          geniePath: {
            type: 'string',
            description: 'File path of the genie to invoke.',
          },
          scope: {
            type: 'string',
            enum: ['selection', 'block', 'document'],
            description: 'Content scope: selection, block, or document.',
          },
          windowId: {
            type: 'string',
            description: 'Optional window identifier. Defaults to focused window.',
          },
        },
        required: ['geniePath'],
      },
    },
    async (args) => {
      const geniePath = requireStringArg(args, 'geniePath');
      const scope = getStringArg(args, 'scope') ?? 'selection';
      const windowId = resolveWindowId(args.windowId as string | undefined);

      // Validate scope
      const validScopes = ['selection', 'block', 'document'];
      if (!validScopes.includes(scope)) {
        return VMarkMcpServer.errorResult(
          `Invalid scope "${scope}". Must be one of: ${validScopes.join(', ')}`
        );
      }

      try {
        const result = await server.sendBridgeRequest<{ status: string }>({
          type: 'genies.invoke',
          windowId,
          geniePath,
          scope,
        });

        return VMarkMcpServer.successResult(
          `Genie invoked: ${result.status}`
        );
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to invoke genie: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
