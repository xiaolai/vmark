/**
 * Batch operation tools - Table and list batch operations.
 *
 * These tools provide:
 * - table_modify: Batch table operations
 * - list_modify: Batch list operations
 */

import { VMarkMcpServer, resolveWindowId, requireStringArg } from '../server.js';
import type {
  BatchEditResult,
  OperationMode,
  TableTarget,
  TableOperation,
  ListTarget,
  ListOperation,
  BridgeRequest,
} from '../bridge/types.js';

/**
 * Register all batch operation tools on the server.
 */
export function registerBatchOpTools(server: VMarkMcpServer): void {
  // table_modify - Batch table operations
  server.registerTool(
    {
      name: 'table_modify',
      description:
        'Apply multiple operations to a table in a single atomic transaction. ' +
        'Operations include adding/deleting rows and columns, updating cells, and setting header rows.',
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
              tableId: {
                type: 'string',
                description: 'Match table by ID from AST',
              },
              afterHeading: {
                type: 'string',
                description: 'Match first table under this heading',
              },
              tableIndex: {
                type: 'number',
                description: 'Match by document order (0-based)',
              },
            },
            description: 'How to identify the target table',
          },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              oneOf: [
                {
                  properties: {
                    action: { const: 'add_row' },
                    at: { type: 'number', description: 'Row index to insert at' },
                    cells: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Cell contents for new row',
                    },
                  },
                  required: ['action', 'at', 'cells'],
                },
                {
                  properties: {
                    action: { const: 'delete_row' },
                    at: { type: 'number', description: 'Row index to delete' },
                  },
                  required: ['action', 'at'],
                },
                {
                  properties: {
                    action: { const: 'add_column' },
                    at: { type: 'number', description: 'Column index to insert at' },
                    header: { type: 'string', description: 'Header cell content' },
                    cells: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Cell contents for each row',
                    },
                  },
                  required: ['action', 'at', 'header', 'cells'],
                },
                {
                  properties: {
                    action: { const: 'delete_column' },
                    at: { type: 'number', description: 'Column index to delete' },
                  },
                  required: ['action', 'at'],
                },
                {
                  properties: {
                    action: { const: 'update_cell' },
                    row: { type: 'number', description: 'Row index (0-based)' },
                    col: { type: 'number', description: 'Column index (0-based)' },
                    content: { type: 'string', description: 'New cell content' },
                  },
                  required: ['action', 'row', 'col', 'content'],
                },
                {
                  properties: {
                    action: { const: 'set_header' },
                    row: { type: 'number', description: 'Row index' },
                    isHeader: { type: 'boolean', description: 'Whether row is header' },
                  },
                  required: ['action', 'row', 'isHeader'],
                },
              ],
            },
            description: 'Array of table operations to apply',
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
        required: ['baseRevision', 'target', 'operations'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const target = args.target as TableTarget;
      const operations = args.operations as TableOperation[];
      const mode = (args.mode as OperationMode) ?? 'apply';

      if (!target || (target.tableId === undefined && target.afterHeading === undefined && target.tableIndex === undefined)) {
        return VMarkMcpServer.errorResult('target must specify tableId, afterHeading, or tableIndex');
      }

      if (!operations || operations.length === 0) {
        return VMarkMcpServer.errorResult('At least one operation is required');
      }

      try {
        const request: BridgeRequest = {
          type: 'table.batchModify',
          baseRevision,
          target,
          operations,
          mode,
          windowId,
        };
        const result = await server.sendBridgeRequest<BatchEditResult>(request);

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to modify table: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // list_modify - Batch list operations
  server.registerTool(
    {
      name: 'list_modify',
      description:
        'Apply multiple operations to a list in a single atomic transaction. ' +
        'Operations include adding/deleting items, updating text, toggling task checks, and reordering.',
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
              listId: {
                type: 'string',
                description: 'Match list by ID from AST',
              },
              selector: {
                type: 'string',
                description: 'CSS-like selector (e.g., "ul:first", "taskList:contains(TODO)")',
              },
              listIndex: {
                type: 'number',
                description: 'Match by document order (0-based)',
              },
            },
            description: 'How to identify the target list',
          },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              oneOf: [
                {
                  properties: {
                    action: { const: 'add_item' },
                    at: { type: 'number', description: 'Index to insert at' },
                    text: { type: 'string', description: 'Item text' },
                    indent: { type: 'number', description: 'Nesting level (0 = top)' },
                  },
                  required: ['action', 'at', 'text'],
                },
                {
                  properties: {
                    action: { const: 'delete_item' },
                    at: { type: 'number', description: 'Index to delete' },
                  },
                  required: ['action', 'at'],
                },
                {
                  properties: {
                    action: { const: 'update_item' },
                    at: { type: 'number', description: 'Index to update' },
                    text: { type: 'string', description: 'New item text' },
                  },
                  required: ['action', 'at', 'text'],
                },
                {
                  properties: {
                    action: { const: 'toggle_check' },
                    at: { type: 'number', description: 'Task item index to toggle' },
                  },
                  required: ['action', 'at'],
                },
                {
                  properties: {
                    action: { const: 'reorder' },
                    order: {
                      type: 'array',
                      items: { type: 'number' },
                      description: 'New order as array of old indices',
                    },
                  },
                  required: ['action', 'order'],
                },
                {
                  properties: {
                    action: { const: 'set_indent' },
                    at: { type: 'number', description: 'Item index' },
                    indent: { type: 'number', description: 'New indent level' },
                  },
                  required: ['action', 'at', 'indent'],
                },
              ],
            },
            description: 'Array of list operations to apply',
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
        required: ['baseRevision', 'target', 'operations'],
      },
    },
    async (args) => {
      const windowId = resolveWindowId(args.windowId as string | undefined);
      const baseRevision = requireStringArg(args, 'baseRevision');
      const target = args.target as ListTarget;
      const operations = args.operations as ListOperation[];
      const mode = (args.mode as OperationMode) ?? 'apply';

      if (!target || (target.listId === undefined && target.selector === undefined && target.listIndex === undefined)) {
        return VMarkMcpServer.errorResult('target must specify listId, selector, or listIndex');
      }

      if (!operations || operations.length === 0) {
        return VMarkMcpServer.errorResult('At least one operation is required');
      }

      try {
        const request: BridgeRequest = {
          type: 'list.batchModify',
          baseRevision,
          target,
          operations,
          mode,
          windowId,
        };
        const result = await server.sendBridgeRequest<BatchEditResult>(request);

        return VMarkMcpServer.successResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return VMarkMcpServer.errorResult(
          `Failed to modify list: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
